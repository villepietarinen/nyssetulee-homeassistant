import importlib.util
from pathlib import Path
import unittest
import random

import aiohttp
from aiohttp import web

path = Path(__file__).resolve().parents[1] / "custom_components/nyssetulee/client.py"
spec = importlib.util.spec_from_file_location("nysse_http_client", path)
client_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client_module)
NysseClient, NysseError = client_module.NysseClient, client_module.NysseError


class ClientTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.calls = []
        self.fail_outward = False
        self.bad_response = False

        async def handle(request):
            self.calls.append((request.path, dict(request.query), dict(request.headers)))
            if request.path == "/api/places":
                return web.json_response([{"name":"Example place", **self.origin}])
            if self.fail_outward and request.query["a_lat"] == str(self.origin["lat"]):
                return web.Response(status=429, headers={"Retry-After":"120"})
            return web.json_response({"journeys":[], "updated":"2026-11-02T17:00:00+02:00"} if not self.bad_response else [])

        app = web.Application()
        app.router.add_get("/api/places", handle)
        app.router.add_get("/api/journeys", handle)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        self.session = aiohttp.ClientSession()
        self.client = NysseClient(self.session, f"http://127.0.0.1:{port}", {"X-Digitransit-Key":"example-test-key"})
        self.origin = {"lat":random.uniform(59, 71), "lon":random.uniform(19, 33)}
        self.destination = {"lat":random.uniform(59, 71), "lon":random.uniform(19, 33)}

    async def asyncTearDown(self):
        await self.session.close()
        await self.runner.cleanup()

    async def test_only_explicit_requests_contact_service_and_reverse_coordinates(self):
        self.assertEqual(self.calls, [])
        result = await self.client.both_directions(self.origin, self.destination)
        self.assertIn("journeys", result["outward"])
        self.assertIn("journeys", result["inward"])
        self.assertEqual(len(self.calls), 2)
        queries = [call[1] for call in self.calls]
        self.assertIn({"a_lat":str(self.origin["lat"]), "a_lon":str(self.origin["lon"]), "b_lat":str(self.destination["lat"]), "b_lon":str(self.destination["lon"])}, queries)
        self.assertIn({"a_lat":str(self.destination["lat"]), "a_lon":str(self.destination["lon"]), "b_lat":str(self.origin["lat"]), "b_lon":str(self.origin["lon"])}, queries)
        self.assertTrue(all(call[2]["X-Digitransit-Key"] == "example-test-key" for call in self.calls))

    async def test_rate_limit_preserves_other_direction_and_retry_delay(self):
        self.fail_outward = True
        result = await self.client.both_directions(self.origin, self.destination)
        self.assertEqual(result["outward"]["retry_after"], 120)
        self.assertIn("journeys", result["inward"])

    async def test_single_direction_uses_only_requested_coordinates(self):
        result = await self.client.journeys(self.destination, self.origin)
        self.assertIn("journeys", result)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0][1], {"a_lat":str(self.destination["lat"]), "a_lon":str(self.destination["lon"]), "b_lat":str(self.origin["lat"]), "b_lon":str(self.origin["lon"])})

    async def test_address_lookup_uses_existing_endpoint(self):
        result = await self.client.places("Example place")
        self.assertEqual(result[0]["name"], "Example place")
        self.assertEqual(self.calls[0][0:2], ("/api/places", {"q":"Example place"}))

    async def test_invalid_coordinates_never_make_a_request(self):
        for point in ({}, {"lat":float("nan"),"lon":23}, {"lat":0,"lon":0}):
            with self.assertRaises(NysseError):
                await self.client.both_directions(point, self.destination)
        self.assertEqual(self.calls, [])

    async def test_malformed_response_is_not_presented_as_empty_departures(self):
        self.bad_response = True
        result = await self.client.both_directions(self.origin, self.destination)
        self.assertIn("Unexpected timetable response", result["outward"]["error"])
