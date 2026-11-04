import test from "node:test";
import assert from "node:assert/strict";

globalThis.HTMLElement = class {};
globalThis.window = {};
globalThis.customElements = {get() {}, define() {}};
const {VisibleRefresher, departures, mobileDevice, cardLanguage, countdown, errorMessage, NyssetuleeCard, NyssetuleeCardEditor, validPoint} = await import("../custom_components/nyssetulee/frontend/nyssetulee-card.js");

// Synthetic points generated at test time, never route defaults or real addresses.
const point = name => ({name, lat:59 + Math.random() * 12, lon:19 + Math.random() * 14});
const A = point("Place A"), B = point("Place B");

test("Finnish follows the HA user language; all other languages use English", () => {
  for (const language of ["fi", "fi-FI", "FI-fi", "fi_FI"]) {
    assert.equal(cardLanguage({locale:{language}}), "fi");
  }
  for (const language of ["en", "sv", "de", "fil"]) {
    assert.equal(cardLanguage({locale:{language}}), "en");
  }
  assert.equal(cardLanguage({language:"fi"}), "fi");
  assert.equal(cardLanguage({locale:{language:"en"}, language:"fi"}), "en");
  assert.equal(cardLanguage(), "en");
});

test("countdowns show days, hours and minutes without zero components", () => {
  for (const [minutes, en, fi] of [
    [0, "Due", "Nyt"], [-1, "Due", "Nyt"],
    [0.1, "in 1 min", "1 min kuluttua"],
    [45, "in 45 min", "45 min kuluttua"],
    [59, "in 59 min", "59 min kuluttua"],
    [60, "in 1 h", "1 h kuluttua"],
    [65, "in 1 h 5 min", "1 h 5 min kuluttua"],
    [1439, "in 23 h 59 min", "23 h 59 min kuluttua"],
    [1440, "in 1 d", "1 vrk kuluttua"],
    [1505, "in 1 d 1 h 5 min", "1 vrk 1 h 5 min kuluttua"],
    [2885, "in 2 d 5 min", "2 vrk 5 min kuluttua"],
  ]) {
    assert.equal(countdown(minutes), en);
    assert.equal(countdown(minutes, "fi"), fi);
  }
});

test("known service errors and HTTP errors are translated without hiding diagnostics", () => {
  const message = "Request limit reached. Try again later.";
  assert.match(errorMessage({message}, "fi"), /Pyyntöjen enimmäismäärä/);
  assert.equal(errorMessage({message}, "en"), message);
  assert.equal(errorMessage("Timetable service returned HTTP 503.", "fi"), "Aikataulupalvelu palautti HTTP-virheen 503.");
  assert.match(errorMessage({message:"unknown_command"}, "fi"), /Aikatauluja ei voitu ladata.*unknown_command/);
});

test("rendered card switches language with HA without fetching and preserves custom titles", () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {addEventListener() {}, setAttribute() {}});
    return elements.get(id);
  };
  const card = Object.create(NyssetuleeCard.prototype);
  card.shadowRoot = {getElementById:element, querySelector:() => ({addEventListener(){}})};
  card._config = {};
  card._origin = A;
  card._destination = B;
  card._refresher = {interval:300000};
  const now = Date.now();
  const data = {updated:new Date(now).toISOString(), routing_errors:[{}], journeys:[{legs:[{
    mode:"BUS", line:"90", departure:new Date(now + 65 * 60000).toISOString(), from:{name:"Test stop"}, departure_realtime:true,
  }]}]};
  card._data = data;
  card._hass = {locale:{language:"en"}};
  card._render();
  assert.match(card.shadowRoot.innerHTML, /Bus departures/);
  assert.match(element("results").innerHTML, /in 1 h 5 min/);
  card.hass = {locale:{language:"fi"}};
  assert.match(card.shadowRoot.innerHTML, /Bussien lähdöt/);
  assert.match(card.shadowRoot.innerHTML, /Päivitä aikataulut/);
  assert.match(card.shadowRoot.innerHTML, /Lähtöosoite/);
  assert.match(card.shadowRoot.innerHTML, /Bussien lähtöajat nousupysäkillä/);
  assert.match(card.shadowRoot.innerHTML, /Matkatiedot: Digitransit\./);
  assert.equal(element("refresh").textContent, "↻ Päivitä");
  assert.match(element("results").innerHTML, /1 h 5 min kuluttua/);
  assert.match(element("results").innerHTML, /Reaaliaikainen ennuste/);
  assert.match(element("results").innerHTML, /Päivitetty/);
  assert.equal((element("results").innerHTML.match(/<h3>/g) || []).length, 1);
  assert.doesNotMatch(element("results").innerHTML, /Place B →/);
  assert.match(element("results").innerHTML, /reititysvaroituksista/);
  card._loading = true;
  card._updateResults();
  assert.equal(element("refresh").textContent, "Päivitetään…");
  card._config.title = "Omat bussit";
  card.hass = {locale:{language:"sv"}};
  assert.match(card.shadowRoot.innerHTML, /Omat bussit/);
  assert.match(card.shadowRoot.innerHTML, /Origin address/);
  assert.match(card.shadowRoot.innerHTML, /Journey data: Digitransit\./);
  assert.equal(element("refresh").textContent, "Refreshing…");
  assert.match(element("results").innerHTML, /in 1 h 5 min/);
  card._data = {updated:data.updated, journeys:[]};
  card.hass = {locale:{language:"fi"}};
  assert.match(element("results").innerHTML, /Tulevia lähtöjä ei löytynyt/);
});

test("separate cards request only their configured direction and keep independent results", async () => {
  const calls = [];
  const makeCard = (origin, destination) => {
    const card = Object.create(NyssetuleeCard.prototype);
    card._origin = origin;
    card._destination = destination;
    card._revision = 1;
    card._refresher = {};
    card._updateResults = () => {};
    card._hass = {callWS:async message => {
      calls.push(message);
      return {journeys:[], marker:message.origin.name, retry_after:message.origin === A ? 120 : 0};
    }};
    return card;
  };
  const a = makeCard(A, B);
  const c = point("Place C");
  const b = makeCard(c, A);
  await Promise.all([a._fetch(), b._fetch()]);
  assert.deepEqual(calls, [
    {type:"nyssetulee/journey", origin:A, destination:B},
    {type:"nyssetulee/journey", origin:c, destination:A},
  ]);
  assert.equal(a._data.marker, A.name);
  assert.equal(b._data.marker, c.name);
  assert.ok(a._refresher.notBefore > Date.now());
  assert.equal(b._refresher.notBefore, undefined);
});

class Timers {
  tasks = new Map();
  id = 0;
  setTimeout(fn, delay) { const id = ++this.id; this.tasks.set(id, {fn, delay}); return id; }
  clearTimeout(id) { this.tasks.delete(id); }
  fire() { const [id, task] = this.tasks.entries().next().value; this.tasks.delete(id); task.fn(); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));

for (const interval of [60000, 300000]) {
  test(`no hidden polling, immediate opening refresh, ${interval / 1000}s interval`, async () => {
    const timers = new Timers();
    let calls = 0;
    const poller = new VisibleRefresher(async () => { calls++; }, interval, timers);
    assert.equal(calls, 0);
    await poller.refresh();
    assert.equal(calls, 0);
    poller.setActive(true);
    await flush();
    assert.equal(calls, 1);
    assert.equal([...timers.tasks.values()][0].delay, interval);
    timers.fire();
    await flush();
    assert.equal(calls, 2);
    poller.setActive(false);
    assert.equal(timers.tasks.size, 0);
    await poller.refresh();
    assert.equal(calls, 2);
    poller.setActive(true);
    await flush();
    assert.equal(calls, 3);
    poller.setActive(true);
    assert.equal(calls, 3);
  });
}

test("manual refresh is immediate and does not accumulate timers", async () => {
  const timers = new Timers();
  let calls = 0;
  const poller = new VisibleRefresher(async () => { calls++; }, 300000, timers);
  poller.setActive(true);
  await flush();
  await poller.refresh();
  assert.equal(calls, 2);
  assert.equal(timers.tasks.size, 1);
});

test("in-flight request never overlaps, and hiding prevents follow-up", async () => {
  const timers = new Timers();
  let release, calls = 0;
  const poller = new VisibleRefresher(() => { calls++; return new Promise(resolve => { release = resolve; }); }, 60000, timers);
  poller.setActive(true);
  await poller.refresh();
  assert.equal(calls, 1);
  poller.setActive(false);
  release();
  await flush();
  assert.equal(calls, 1);
  assert.equal(timers.tasks.size, 0);
});

test("returning during an in-flight request queues a fresh result", async () => {
  const timers = new Timers();
  let release, calls = 0;
  const poller = new VisibleRefresher(() => {
    calls++;
    return calls === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  }, 60000, timers);
  poller.setActive(true);
  poller.setActive(false);
  poller.setActive(true);
  assert.equal(calls, 1);
  release();
  await flush();
  assert.equal(calls, 2);
  assert.equal(timers.tasks.size, 1);
});

test("Retry-After stops automatic and manual requests until permitted", async () => {
  const timers = new Timers();
  let calls = 0;
  const poller = new VisibleRefresher(async () => { calls++; }, 60000, timers);
  poller.notBefore = Date.now() + 600000;
  poller.setActive(true);
  await poller.refresh();
  assert.equal(calls, 0);
  assert.ok([...timers.tasks.values()][0].delay > 590000);
});

test("mobile defaults include Android and iPad desktop mode", () => {
  assert.equal(mobileDevice({userAgent:"Android", platform:"Linux", maxTouchPoints:1}), true);
  assert.equal(mobileDevice({userAgent:"Desktop Safari", platform:"MacIntel", maxTouchPoints:5}), true);
  assert.equal(mobileDevice({userAgent:"Desktop Chrome", platform:"Win32", maxTouchPoints:0}), false);
});

test("departure list sorts predictions, deduplicates, excludes expired and walking-only journeys", () => {
  const now = Date.parse("2026-11-02T17:00:00+02:00");
  const bus = (time, extra = {}) => ({mode:"BUS", transit:true, line:"90", from:{name:"Test stop"}, to:{name:"Station"}, departure:time, ...extra});
  const late = bus("2026-11-02T17:32:00+02:00", {departure_realtime:true});
  const early = bus("2026-11-02T17:20:00+02:00", {realtime:true});
  const data = {journeys:[
    {legs:[{mode:"WALK", departure:"2026-11-02T16:55:00+02:00"}, late]},
    {legs:[early]}, {legs:[late]},
    {legs:[bus("2026-11-02T16:58:00+02:00")]},
    {legs:[{mode:"WALK"}]}, {legs:[bus("invalid")]},
  ]};
  const results = departures(data, now);
  assert.equal(results.length, 2);
  assert.equal(results[0].departure, early.departure);
  assert.equal(results[0].live, false); // Old journey-level flag is insufficient.
  assert.equal(results[1].live, true);
});


test("blank and incomplete routes have no defaults, requests or polling timers", async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {addEventListener() {}, replaceChildren() {}, setAttribute() {}});
    return elements.get(id);
  };
  globalThis.document = {visibilityState:"visible"};
  const card = Object.create(NyssetuleeCard.prototype);
  card.shadowRoot = {getElementById:element, querySelector:() => ({addEventListener(){}})};
  card.isConnected = true;
  card._visible = true;
  card._pageActive = true;
  card._searchTimers = {};
  card._searchRevisions = {origin:0, destination:0};
  card._revision = 0;
  const calls = [];
  card._hass = {locale:{language:"fi"}, callWS:async message => {calls.push(message); return {journeys:[]};}};
  card.setConfig({type:"custom:nyssetulee-card", refresh_interval:300});
  assert.deepEqual(NyssetuleeCard.getStubConfig(), {});
  assert.equal(card._origin, null);
  assert.equal(card._destination, null);
  assert.equal(element("origin").value, "");
  assert.equal(element("destination").value, "");
  assert.equal(element("refresh").disabled, true);
  assert.match(element("results").innerHTML, /Valitse lähtöpaikka ja määränpää/);
  assert.equal(card._refresher.active, false);
  await card._fetch();
  card._selectPlace("origin", A);
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(card._refresher.timer, undefined);
  card._selectPlace("destination", B);
  await flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {type:"nyssetulee/journey", origin:A, destination:B, force_refresh:true});
  card._visible = false;
  card._syncVisibility();
  assert.equal(card._refresher.active, false);
  assert.equal(validPoint(null), false);
  assert.equal(validPoint({name:"A"}), false);
});

test("visual editor emits per-card route config for dashboard persistence", () => {
  const fields = new Map();
  const element = id => {
    if (!fields.has(id)) fields.set(id, {replaceChildren() {}, addEventListener() {}});
    return fields.get(id);
  };
  const editor = Object.create(NyssetuleeCardEditor.prototype);
  editor._timers = {};
  editor._revisions = {origin:0, destination:0};
  editor.shadowRoot = {getElementById:element};
  const events = [];
  editor.dispatchEvent = event => events.push(event);
  editor.setConfig({type:"custom:nyssetulee-card", title:"My route", refresh_interval:300});
  assert.equal(element("origin").value, "");
  assert.equal(element("destination").value, "");
  editor._selectPlace("origin", A);
  editor._selectPlace("destination", B);
  const event = events.at(-1);
  assert.equal(event.type, "config-changed");
  assert.equal(event.bubbles, true);
  assert.equal(event.composed, true);
  assert.deepEqual(event.detail.config, {type:"custom:nyssetulee-card", title:"My route", refresh_interval:300, origin:A, destination:B});
});


test("manual refresh retains its cache-bypass flag when queued behind a request", async () => {
  const timers = new Timers();
  const flags = [];
  let release;
  const poller = new VisibleRefresher(force => {
    flags.push(force);
    return flags.length === 1 ? new Promise(resolve => {release=resolve;}) : Promise.resolve();
  }, 60000, timers);
  poller.active = true;
  void poller.refresh();
  await poller.refresh(true);
  release();
  await flush();
  assert.deepEqual(flags, [false, true]);
  poller.setActive(false);
});

test("manual card fetch asks HA to bypass its cache", async () => {
  const card = Object.create(NyssetuleeCard.prototype);
  card._origin=A; card._destination=B; card._revision=1; card._refresher={};
  card._updateResults=() => {};
  let message;
  card._hass={callWS:async value => {message=value; return {journeys:[]};}};
  await card._fetch(true);
  assert.equal(message.force_refresh, true);
  await card._fetch();
  assert.equal(message.force_refresh, undefined);
});


test("opening/reloading/returning bypass cache while automatic refresh reuses it", async () => {
  const timers = new Timers();
  const flags = [];
  const poller = new VisibleRefresher(async force => {flags.push(force);}, 60000, timers);
  poller.setActive(true);
  await flush();
  timers.fire();
  await flush();
  poller.setActive(false);
  poller.setActive(true);
  await flush();
  assert.deepEqual(flags, [true, false, true]);
  poller.setActive(false);
});
