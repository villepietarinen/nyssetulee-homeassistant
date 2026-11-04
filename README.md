# Nyssetulee for Home Assistant

Live/scheduled bus departures from your chosen origin to your destination.
Each card shows **one direction**. Add independent cards in separate dashboard
columns for A → B, B → A, C → A, or other routes supported by the service.

**There are no default addresses or route coordinates.** A new card starts empty
and makes no timetable requests until both places are selected. The public source,
examples and release history contain no personal route configuration.

## Install with HACS

1. HACS → menu → Custom repositories: add
   `https://github.com/villepietarinen/nyssetulee-homeassistant`, category **Integration**.
2. Download **Nyssetulee**. The dashboard card is included.
3. Add this once to `/config/configuration.yaml`:

   ```yaml
   nyssetulee:
     url: https://nysse.polii.fi
     # Optional shared route-cache lifetime (seconds, 0 disables; maximum 300).
     # cache_seconds: 60
     # Optional: choose one credential to avoid the shared public quota.
     # api_key: !secret nyssetulee_digitransit_key
     # owner_token: !secret nyssetulee_owner_token
   ```

4. Restart Home Assistant and fully reload the browser/companion app.
5. Edit your dashboard, add the **Nyssetulee** card, and use its visual editor to
   search and select an origin and destination. Save the card. Those selections
   are stored in your HA dashboard configuration, not in this repository.

No separate JavaScript upload or dashboard resource is needed. The integration
serves and automatically loads its bundled card using a versioned URL.
Minimum tested Home Assistant version: 2026.10.4.

## Two cards side by side

Add one Nyssetulee card to each dashboard section/column. Configure the first
card as A → B and the second as B → A, C → A, or any independent route. Each
card has its own route, results, errors and visible-only refresh timer.

The minimal YAML is intentionally empty of locations:

```yaml
type: custom:nyssetulee-card
```

Select places in the visual card editor to persist them across page reloads.
An optional `title` overrides the translated heading. Advanced YAML supports
`origin` and `destination` objects with `name`, `lat` and `lon`; use your own
values from the address search. No location values are supplied here.

The address fields on the displayed card can temporarily change its route.
For a permanent change, edit and save the card in the dashboard editor.

## Migrate an earlier manual installation

Back up your existing integration and dashboard configuration. Keep the existing
`nyssetulee:` backend configuration. If an earlier card relied on built-in places,
select its route in the new visual editor and save it: built-in places no longer exist.

Install this public repository with HACS. Remove the old dashboard resource
`/local/nyssetulee-card.js?v=1` (or another cache version) from Settings →
Dashboards → Resources, then restart HA and fully reload the app/browser.
Leaving that resource enabled can load the older card first. The old standalone
file in `/config/www` is no longer used after its resource is removed.

## Updates

Install released updates through HACS/Home Assistant's update UI. The integration
and card update together. Restart HA, then reload your browser/app. The card URL
version changes automatically; no individual file uploads or cache-version edits.

## Language and refresh

Finnish HA users get Finnish text; all other languages get English. Language
changes do not fetch new timetables. Countdown examples: `45 min kuluttua`,
`1 h 5 min kuluttua`, `1 vrk 2 h kuluttua`; English: `in 45 min`, `in 1 h 5 min`,
`in 1 d 2 h`. Known errors are translated; unknown diagnostics are retained.

- Opening, reloading, returning, manual refresh or selecting a complete route:
  fetch the configured direction immediately.
- Visible desktop: refresh after five minutes; visible mobile: after one minute.
- Hidden tab/app, card outside the viewport, or removed card: stop refresh timers.
- Empty or incomplete route: no timetable requests or periodic refresh timer.
- Address lookup: debounced and only while the card/editor is visible/connected.

Override device detection with `refresh_interval` in seconds (minimum 60).
Countdown text updates locally once per minute. One refresh makes one journey
request per card. Each open card/client contributes to service usage; rate-limit
responses postpone automatic and manual retries. A request in flight may finish
after a card is hidden. There are no backend polling entities or schedulers.

## Shared request cache

HA reuses successful, nonempty complete-route responses for 60 seconds by default.
Identical routes across cards/devices share this cache and any in-flight request.
Reverse routes and different credentials remain separate. The cache is in memory,
bounded to 128 routes, and retains the original service update timestamp. Empty,
failed and incomplete results are not cached; expired entries are not served.

Countdowns and departure visibility update locally using already loaded data.
The regular visible-card refresh schedule remains unchanged. Manual **Refresh**
bypasses the HA response cache (but still respects rate-limit delays and shares
a request already underway). The upstream service may also cache provider data.
Optional backend YAML `cache_seconds` accepts 0–300 seconds; restart HA after changing it.
No background fetches are introduced.

## Data and privacy

The service is `https://nysse.polii.fi`, using Digitransit/Nysse route data. Address
searches and selected route coordinates are sent through your authenticated HA
backend to that service. Configure credentials in HA secrets; they are never
included in the served JavaScript or card URL. Without a credential the service's
shared quota applies. This is an independent tool, not an official Nysse product.

Only each journey's first boarding is shown. Times use Europe/Helsinki; live labels
require a departure-level estimate and otherwise use scheduled times. This is a
route-planner search, not a complete stop board; walking/routing constraints can
affect results. Website history/radius controls are not yet part of the card.

## Manual fallback

Copy the entire `custom_components/nyssetulee` directory into your HA configuration,
including its `frontend` directory. Add the backend YAML above and restart HA.

## Development and releases

```sh
python -m pip install -r requirements-test.txt
python -m unittest discover -s tests -v
node --test tests/card.test.mjs
python tools/package_homeassistant.py
```

Tests generate synthetic coordinate fixtures at runtime; they are not default
locations. No personal addresses, route fixtures, credentials or private project
history are included. The integration test boots real HA and checks module serving,
single-direction dispatch and retry delays. It does not exercise a physical app.

For a release, update the integration manifest and changelog, tag the tested commit
`v<VERSION>`, and publish a GitHub release. CI checks the version, runs tests, and
attaches a complete manual-install archive. HACS installs from the repository's
root `custom_components/nyssetulee` directory.
