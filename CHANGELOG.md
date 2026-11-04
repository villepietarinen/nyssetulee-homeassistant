# Changelog

## 0.8.3 - 2026-11-04

- Add Finnish/English Digitransit attribution to the card footer.
- Show compact clickable place names on the card; open inline search only when editing a temporary route. Keep the visual configuration editor unchanged.
- Forward forced refreshes to the timetable service's route cache, keeping reload/manual refresh fresh across both cache layers.
- Respect the service response's remaining cache lifetime instead of extending older upstream results for another full cache period.

## 0.8.2 - 2026-11-04

- Use a five-minute shared route cache by default, configurable up to ten minutes.
- Opening, reloading, returning and manual refresh bypass the HA cache. Automatic refresh can reuse it while the UI updates countdowns locally.

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
