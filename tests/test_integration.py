"""Smoke checks using a real Home Assistant runtime when installed."""
import asyncio
import json
import random
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import Mock, AsyncMock

try:
    from homeassistant.core import HomeAssistant
    from homeassistant import auth, bootstrap, config_entries, loader
    from homeassistant.components import network, frontend
    from aiohttp.test_utils import TestClient, TestServer
    from homeassistant.setup import async_setup_component
except ImportError:
    HomeAssistant = None


@unittest.skipIf(HomeAssistant is None, "Install Home Assistant to run integration smoke checks")
class IntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_setup_registers_commands_without_polling_and_dispatches_on_demand(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(__file__).resolve().parents[1] / "custom_components"
            shutil.copytree(source, Path(directory) / "custom_components")
            sys.path.insert(0, directory)
            hass = HomeAssistant(directory)
            try:
                loader.async_setup(hass)
                hass.config_entries = config_entries.ConfigEntries(hass, {})
                self.assertTrue(await bootstrap.async_load_base_functionality(hass))
                hass.auth = await auth.auth_manager_from_config(hass, [], [])
                await network.async_get_adapters(hass)
                result = await async_setup_component(hass, "nyssetulee", {"nyssetulee": {"url":"https://nysse.polii.fi"}})
                self.assertTrue(result)
                client = hass.data["nyssetulee"]
                self.assertEqual(client.cache_seconds, 300)
                calls = []

                async def both_directions(origin, destination):
                    calls.append((origin, destination))
                    return {"outward":{"journeys":[]}, "inward":{"journeys":[]}}

                client.both_directions = both_directions
                self.assertEqual(calls, [])
                version = json.loads((source / "nyssetulee/manifest.json").read_text())["version"]
                card_url = f"/nyssetulee/nyssetulee-card.js?v={version}"
                urls = hass.data[frontend.DATA_EXTRA_MODULE_URL].urls
                self.assertIn(card_url, urls)
                async with TestClient(TestServer(hass.http.app)) as http:
                    response = await http.get(card_url)
                    self.assertEqual(response.status, 200)
                    script = await response.text()
                    self.assertIn('type: "nyssetulee/journey"', script)
                    self.assertNotIn('type: "nyssetulee/journeys"', script)
                client.journeys = AsyncMock(return_value={"journeys":[], "updated":"example"})
                single_handler, single_schema = hass.data["websocket_api"]["nyssetulee/journey"]
                # Synthetic request coordinates generated only for this test.
                origin = {"lat":random.uniform(59, 71), "lon":random.uniform(19, 33)}
                destination = {"lat":random.uniform(59, 71), "lon":random.uniform(19, 33)}
                single_msg = single_schema({"id":2, "type":"nyssetulee/journey", "origin":origin, "destination":destination})
                single_connection = Mock()
                single_handler(hass, single_connection, single_msg)
                for _ in range(20):
                    await asyncio.sleep(0)
                    if single_connection.send_result.called:
                        break
                single_connection.send_result.assert_called_once_with(2, {"journeys":[], "updated":"example"})
                client.journeys.assert_awaited_once_with(single_msg["origin"], single_msg["destination"], force_refresh=False)
                self.assertEqual(calls, [])  # No reverse-direction call.
                forced_connection = Mock()
                single_handler(hass, forced_connection, {**single_msg, "id":4, "force_refresh":True})
                for _ in range(20):
                    await asyncio.sleep(0)
                    if forced_connection.send_result.called:
                        break
                client.journeys.assert_awaited_with(single_msg["origin"], single_msg["destination"], force_refresh=True)
                from custom_components.nyssetulee.client import NysseError
                client.journeys = AsyncMock(side_effect=NysseError("Request limit reached. Try again later.", 120))
                limited_connection = Mock()
                single_handler(hass, limited_connection, {**single_msg, "id":3})
                for _ in range(20):
                    await asyncio.sleep(0)
                    if limited_connection.send_result.called:
                        break
                limited_connection.send_result.assert_called_once_with(3, {"error":"Request limit reached. Try again later.", "retry_after":120})
                self.assertIn("nyssetulee/places", hass.data["websocket_api"])
                handler, schema = hass.data["websocket_api"]["nyssetulee/journeys"]
                message = schema({"id":1,"type":"nyssetulee/journeys", "origin":origin, "destination":destination})
                connection = Mock()
                handler(hass, connection, message)
                for _ in range(20):
                    await asyncio.sleep(0)
                    if connection.send_result.called:
                        break
                connection.send_result.assert_called_once_with(1, {"outward":{"journeys":[]}, "inward":{"journeys":[]}})
                self.assertEqual(len(calls), 1)
            finally:
                await hass.async_stop()
                sys.path.remove(directory)
