# Changelog

## 0.8.1 - 2026-11-04

- Share successful route results for 60 seconds across HA cards/devices and coalesce simultaneous identical requests.
- Keep countdown updates local, preserve original timestamps, and isolate route directions and credential instances.
- Manual refresh bypasses the HA cache; failed, empty or incomplete results are not cached. Add a bounded configurable cache without background polling.

## 0.8.0 - 2026-11-04

- Initial standalone HACS package, bundling the integration and automatically loaded card.
- Independent one-way cards with address selection and a visual editor for saving each route.
- Empty route fields, with no default addresses or coordinates and no requests until both places are selected.
- Finnish/English text and minute/hour/day countdowns.
- Visible-only refresh, immediate opening/manual refresh, and rate-limit retry handling.
- Clean standalone source history and synthetic-only test fixtures.
