"""Expose Nyssetulee to visible dashboard cards, without periodic polling."""
from pathlib import Path

try:
    import probatio as vol
except ImportError:  # Home Assistant versions before the validation-library migration.
    import voluptuous as vol

from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.loader import async_get_integration
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .client import NysseClient, NysseError

DOMAIN = "nyssetulee"
CONFIG_SCHEMA = vol.Schema({
    DOMAIN: vol.Schema({
        vol.Optional("url", default="https://nysse.polii.fi"): cv.url,
        vol.Optional("cache_seconds", default=300): vol.All(vol.Coerce(int), vol.Range(min=0, max=600)),
        vol.Optional("api_key"): cv.string,
        vol.Optional("owner_token"): cv.string,
    })
}, extra=vol.ALLOW_EXTRA)


async def async_setup(hass, config):
    """Register request handlers. Setup does not contact the service."""
    settings = config[DOMAIN]
    headers = {}
    if settings.get("api_key"):
        headers["X-Digitransit-Key"] = settings["api_key"]
    if settings.get("owner_token"):
        headers["X-Nyssetulee-Owner-Token"] = settings["owner_token"]
    hass.data[DOMAIN] = NysseClient(async_get_clientsession(hass), settings["url"], headers, cache_seconds=settings["cache_seconds"])
    integration = await async_get_integration(hass, DOMAIN)
    card_path = Path(__file__).parent / "frontend/nyssetulee-card.js"
    card_url = "/nyssetulee/nyssetulee-card.js"
    await hass.http.async_register_static_paths([
        StaticPathConfig(card_url, str(card_path), False)
    ])
    frontend.add_extra_js_url(hass, f"{card_url}?v={integration.version}")
    websocket_api.async_register_command(hass, ws_journey)
    # Keep the old two-direction command for cards awaiting a browser reload.
    websocket_api.async_register_command(hass, ws_journeys)
    websocket_api.async_register_command(hass, ws_places)
    return True


@websocket_api.websocket_command({
    vol.Required("type"): "nyssetulee/journey",
    vol.Optional("force_refresh", default=False): cv.boolean,
    vol.Required("origin"): dict,
    vol.Required("destination"): dict,
})
@websocket_api.async_response
async def ws_journey(hass, connection, msg):
    """Fetch exactly the selected direction, preserving rate-limit retry hints."""
    try:
        result = await hass.data[DOMAIN].journeys(msg["origin"], msg["destination"], force_refresh=msg["force_refresh"])
    except NysseError as exc:
        result = {"error": str(exc), "retry_after": exc.retry_after}
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({
    vol.Required("type"): "nyssetulee/journeys",
    vol.Required("origin"): dict,
    vol.Required("destination"): dict,
})
@websocket_api.async_response
async def ws_journeys(hass, connection, msg):
    try:
        result = await hass.data[DOMAIN].both_directions(msg["origin"], msg["destination"])
    except NysseError as exc:
        connection.send_error(msg["id"], "nyssetulee_error", str(exc))
    else:
        connection.send_result(msg["id"], result)


@websocket_api.websocket_command({
    vol.Required("type"): "nyssetulee/places",
    vol.Required("query"): vol.All(str, vol.Length(min=2, max=120)),
})
@websocket_api.async_response
async def ws_places(hass, connection, msg):
    try:
        result = await hass.data[DOMAIN].places(msg["query"])
    except NysseError as exc:
        connection.send_error(msg["id"], "nyssetulee_error", str(exc))
    else:
        connection.send_result(msg["id"], result)
