"""On-demand HTTP client. No scheduled polling."""
import asyncio
import math
from collections import OrderedDict
from copy import deepcopy
from time import monotonic

import aiohttp


class NysseError(Exception):
    """A safe error that can be shown in the card."""

    def __init__(self, message, retry_after=0):
        super().__init__(message)
        self.retry_after = retry_after


def coordinates(point):
    """Accept only usable coordinates in the service's Finland coverage."""
    try:
        lat, lon = float(point["lat"]), float(point["lon"])
    except (KeyError, TypeError, ValueError) as exc:
        raise NysseError("Select a valid origin and destination.") from exc
    if not all(map(math.isfinite, (lat, lon))) or not (59 <= lat <= 71 and 19 <= lon <= 33):
        raise NysseError("Select an origin and destination in Finland.")
    return lat, lon


class NysseClient:
    def __init__(self, session, base_url, headers=None, cache_seconds=300, clock=monotonic):
        self.cache_seconds = cache_seconds
        self._clock = clock
        self._cache = OrderedDict()
        self._inflight = {}
        self.session = session
        self.base_url = base_url.rstrip("/")
        self.headers = {"Accept": "application/json", "User-Agent": "HomeAssistant-Nyssetulee/0.1", **(headers or {})}

    async def get(self, path, params):
        try:
            async with self.session.get(
                self.base_url + path, params=params, headers=self.headers,
                timeout=aiohttp.ClientTimeout(total=25), allow_redirects=False,
            ) as response:
                if response.status == 429:
                    retry = response.headers.get("Retry-After", "60")
                    raise NysseError("Request limit reached. Try again later.", int(retry) if retry.isdigit() else 60)
                if response.status in (401, 403):
                    raise NysseError("Service access denied. Check the integration's API key or owner token.")
                if response.status != 200:
                    raise NysseError(f"Timetable service returned HTTP {response.status}.")
                return await response.json()
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as exc:
            raise NysseError("Could not reach or read the timetable service.") from exc

    async def places(self, query):
        if not isinstance(query, str) or not 2 <= len(query.strip()) <= 120:
            raise NysseError("Enter between 2 and 120 characters.")
        data = await self.get("/api/places", {"q": query.strip()})
        if not isinstance(data, list):
            raise NysseError("Unexpected address lookup response.")
        return data

    async def journeys(self, origin, destination, force_refresh=False):
        key = (*coordinates(origin), *coordinates(destination))
        now = self._clock()
        for cached_key, (expires, _) in list(self._cache.items()):
            if expires <= now:
                self._cache.pop(cached_key, None)
        if force_refresh:
            self._cache.pop(key, None)
        elif key in self._cache:
            self._cache.move_to_end(key)
            return deepcopy(self._cache[key][1])

        # Share an in-flight request, including a manual refresh already underway.
        if key not in self._inflight:
            task = asyncio.create_task(self._load_journeys(key, force_refresh))
            self._inflight[key] = task

            def completed(done):
                if self._inflight.get(key) is done:
                    self._inflight.pop(key, None)
                if not done.cancelled():
                    done.exception()  # Retrieve failures even if every waiter left.

            task.add_done_callback(completed)
        # Closing one dashboard must not cancel other clients' shared request.
        return deepcopy(await asyncio.shield(self._inflight[key]))

    async def _load_journeys(self, key, force_refresh=False):
        a_lat, a_lon, b_lat, b_lon = key
        params = {"a_lat":a_lat, "a_lon":a_lon, "b_lat":b_lat, "b_lon":b_lon}
        if force_refresh:
            params["force_refresh"] = "true"
        data = await self.get("/api/journeys", params)
        if not isinstance(data, dict) or not isinstance(data.get("journeys"), list):
            raise NysseError("Unexpected timetable response.")
        # Never prolong empty, failed or incomplete routing results.
        if (self.cache_seconds > 0 and data["journeys"] and not data.get("error")
                and not data.get("routing_errors") and data.get("search_complete") is not False):
            remaining = data.get("cache_remaining_seconds", self.cache_seconds)
            lifetime = min(self.cache_seconds, max(0, remaining)) if isinstance(remaining, (int, float)) and math.isfinite(remaining) else self.cache_seconds
            self._cache[key] = (self._clock() + lifetime, deepcopy(data))
            self._cache.move_to_end(key)
            while len(self._cache) > 128:
                self._cache.popitem(last=False)
        return data

    async def both_directions(self, origin, destination):
        coordinates(origin)
        coordinates(destination)

        async def direction(a, b):
            try:
                return await self.journeys(a, b)
            except NysseError as exc:
                return {"error": str(exc), "retry_after": exc.retry_after}

        outward, inward = await asyncio.gather(direction(origin, destination), direction(destination, origin))
        return {"outward": outward, "inward": inward}
