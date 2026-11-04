"""On-demand HTTP client. No background tasks or polling."""
import asyncio
import math

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
    def __init__(self, session, base_url, headers=None):
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

    async def journeys(self, origin, destination):
        a_lat, a_lon = coordinates(origin)
        b_lat, b_lon = coordinates(destination)
        data = await self.get("/api/journeys", {"a_lat": a_lat, "a_lon": a_lon, "b_lat": b_lat, "b_lon": b_lon})
        if not isinstance(data, dict) or not isinstance(data.get("journeys"), list):
            raise NysseError("Unexpected timetable response.")
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
