// Dependency-free Home Assistant card; the backend never polls on its own.
export function validPoint(point) {
  return Boolean(point && Number.isFinite(point.lat) && Number.isFinite(point.lon) &&
    point.lat >= 59 && point.lat <= 71 && point.lon >= 19 && point.lon <= 33);
}

export function cardLanguage(hass) {
  return /^fi(?:-|_|$)/i.test(hass?.locale?.language || hass?.language || "en") ? "fi" : "en";
}

const TEXT = {
  en: {
    title: "Bus departures", refresh: "Refresh", refreshLabel: "Refresh timetables",
    refreshing: "Refreshing…", from: "From", to: "To", origin: "Origin address",
    destination: "Destination address", live: "● Live prediction", scheduled: "Scheduled",
    loading: "Loading departures…", waiting: "Waiting to load departures.",
    noResponse: "No timetable response.", empty: "No upcoming departures returned.",
    updated: "Updated", stale: "Older data", noUpdate: "Update time unavailable",
    warnings: "Some journeys may be missing: the service reported routing warnings.",
    searching: "Searching…", noAddresses: "No addresses found.",
    footer: "Bus departure times at the boarding stop. Refreshes only while this card is visible.",
    error: "Could not load timetables. Check that the Nyssetulee integration is installed.",
    coordinates: "Origin and destination need valid Finland lat/lon coordinates.",
    interval: "refresh_interval must be at least 60 seconds.", due: "Due",
    chooseRoute: "Select an origin and destination to see departures.",
    titleLabel: "Title (optional)", editorHelp: "Choose an address suggestion for each end of the route, then save the card.",
  },
  fi: {
    title: "Bussien lähdöt", refresh: "Päivitä", refreshLabel: "Päivitä aikataulut",
    refreshing: "Päivitetään…", from: "Mistä", to: "Minne", origin: "Lähtöosoite",
    destination: "Määränpään osoite", live: "● Reaaliaikainen ennuste", scheduled: "Aikataulun mukaan",
    loading: "Ladataan lähtöjä…", waiting: "Odotetaan lähtöjen lataamista.",
    noResponse: "Aikataulupalvelu ei vastannut.", empty: "Tulevia lähtöjä ei löytynyt.",
    updated: "Päivitetty", stale: "Vanhempia tietoja", noUpdate: "Päivitysaika ei ole saatavilla",
    warnings: "Osa matkoista saattaa puuttua: palvelu ilmoitti reititysvaroituksista.",
    searching: "Haetaan…", noAddresses: "Osoitteita ei löytynyt.",
    footer: "Bussien lähtöajat nousupysäkillä. Aikataulut päivittyvät vain tämän kortin ollessa näkyvissä.",
    error: "Aikatauluja ei voitu ladata. Tarkista, että Nyssetulee-integraatio on asennettu.",
    coordinates: "Lähtöpaikalla ja määränpäällä on oltava kelvolliset koordinaatit Suomessa.",
    interval: "refresh_interval-arvon on oltava vähintään 60 sekuntia.", due: "Nyt",
    chooseRoute: "Valitse lähtöpaikka ja määränpää nähdäksesi lähdöt.",
    titleLabel: "Otsikko (valinnainen)", editorHelp: "Valitse osoitehaun ehdotus reitin molempiin päihin ja tallenna kortti.",
  },
};

export function countdown(minutes, language = "en") {
  const fi = language === "fi";
  let remaining = Math.max(0, Math.ceil(minutes));
  if (!remaining) return TEXT[fi ? "fi" : "en"].due;
  const parts = [];
  for (const [size, unit] of [[1440, fi ? "vrk" : "d"], [60, "h"], [1, "min"]]) {
    const count = Math.floor(remaining / size);
    if (count) parts.push(`${count} ${unit}`);
    remaining %= size;
  }
  const duration = parts.join(" ");
  return fi ? `${duration} kuluttua` : `in ${duration}`;
}

const ERROR_FI = {
  "Select a valid origin and destination.": "Valitse kelvollinen lähtöpaikka ja määränpää.",
  "Select an origin and destination in Finland.": "Valitse lähtöpaikka ja määränpää Suomesta.",
  "Request limit reached. Try again later.": "Pyyntöjen enimmäismäärä täyttyi. Yritä myöhemmin uudelleen.",
  "Service access denied. Check the integration's API key or owner token.": "Pääsy palveluun estettiin. Tarkista integraation API-avain tai omistajan tunniste.",
  "Could not reach or read the timetable service.": "Yhteys aikataulupalveluun tai vastauksen lukeminen epäonnistui.",
  "Enter between 2 and 120 characters.": "Kirjoita 2–120 merkkiä.",
  "Unexpected address lookup response.": "Osoitehaun vastaus oli odottamaton.",
  "Unexpected timetable response.": "Aikataulupalvelun vastaus oli odottamaton.",
};

export function errorMessage(error, language = "en") {
  const message = typeof error === "string" ? error : error?.message;
  if (!message) return TEXT[language].error;
  if (language !== "fi") return message;
  const http = /^Timetable service returned HTTP (\d+)\.$/.exec(message);
  return ERROR_FI[message] || (http ? `Aikataulupalvelu palautti HTTP-virheen ${http[1]}.` : `${TEXT.fi.error} (${message})`);
}

export function mobileDevice(nav = navigator) {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
}

export function departures(data, now = Date.now(), limit = 4) {
  const seen = new Set();
  return (data?.journeys || []).map(journey => {
    const leg = (journey.legs || []).find(item => item.transit || ["BUS", "TRAM", "RAIL"].includes(item.mode));
    if (!leg || !Number.isFinite(Date.parse(leg.departure))) return null;
    return {...leg, time: Date.parse(leg.departure), live: leg.departure_realtime === true};
  }).filter(leg => {
    if (!leg || leg.time < now) return false;
    const key = JSON.stringify([leg.line, leg.from?.name, leg.to?.name, leg.departure]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.time - b.time).slice(0, limit);
}

// One timer and one request at a time. Re-entry always queues a fresh request.
export class VisibleRefresher {
  constructor(fetchData, interval, timers = globalThis) {
    this.fetchData = fetchData;
    this.interval = interval;
    this.timers = timers;
    this.active = false;
    this.busy = false;
    this.pending = false;
    this.pendingForce = false;
    this.notBefore = 0;
  }
  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    this.timers.clearTimeout(this.timer);
    this.pending = false;
    this.pendingForce = false;
    if (active) void this.refresh();
  }
  async refresh(force = false) {
    if (!this.active) return;
    this.timers.clearTimeout(this.timer);
    if (this.busy) { this.pending = true; this.pendingForce ||= force; return; }
    if (Date.now() < this.notBefore) { this.schedule(); return; }
    this.busy = true;
    try { await this.fetchData(force); }
    finally {
      this.busy = false;
      if (this.active && this.pending) {
        const pendingForce = this.pendingForce;
        this.pending = false;
        this.pendingForce = false;
        void this.refresh(pendingForce);
      } else this.schedule();
    }
  }
  schedule() {
    if (!this.active) return;
    this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => void this.refresh(),
      Math.max(this.interval, this.notBefore - Date.now()));
  }
}

const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, char =>
  ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[char]));

export class NyssetuleeCard extends HTMLElement {
  static getConfigElement() { return document.createElement("nyssetulee-card-editor"); }
  static getStubConfig() { return {}; }
  constructor() {
    super();
    this.attachShadow({mode: "open"});
    this._visible = false;
    this._pageActive = true;
    this._revision = 0;
    this._searchRevisions = {origin: 0, destination: 0};
    this._searchTimers = {};
    this._visibility = () => this._syncVisibility();
    this._pageHide = () => { this._pageActive = false; this._syncVisibility(); };
    this._pageShow = () => { this._pageActive = true; this._syncVisibility(); };
  }
  setConfig(config) {
    for (const point of [config.origin, config.destination].filter(Boolean)) {
      if (!validPoint(point)) {
        throw new Error(this._text.coordinates);
      }
    }
    const interval = config.refresh_interval ?? (mobileDevice() ? 60 : 300);
    if (!Number.isFinite(interval) || interval < 60) throw new Error(this._text.interval);
    this._refresher?.setActive(false);
    this._config = config;
    this._origin = config.origin ? {...config.origin} : null;
    this._destination = config.destination ? {...config.destination} : null;
    this._revision++;
    this._data = null;
    this._error = null;
    this._refresher = new VisibleRefresher(force => this._fetch(force), interval * 1000);
    this._render();
    this._syncVisibility();
  }
  set hass(value) {
    const old = this._hass;
    this._hass = value;
    if (this._config && cardLanguage(old) !== cardLanguage(value)) this._render();
    if (!old) this._syncVisibility();
  }
  get _text() { return TEXT[cardLanguage(this._hass)]; }
  get _hasRoute() { return validPoint(this._origin) && validPoint(this._destination); }
  getCardSize() { return 5; }
  getGridOptions() { return {columns: 12, min_columns: 6, rows: 6, min_rows: 4}; }
  connectedCallback() {
    this._pageActive = true;
    document.addEventListener("visibilitychange", this._visibility);
    window.addEventListener("pagehide", this._pageHide);
    window.addEventListener("pageshow", this._pageShow);
    this._observer = new IntersectionObserver(entries => {
      this._visible = entries.some(entry => entry.isIntersecting);
      this._syncVisibility();
    });
    this._observer.observe(this);
  }
  disconnectedCallback() {
    this._visible = false;
    this._observer?.disconnect();
    document.removeEventListener("visibilitychange", this._visibility);
    window.removeEventListener("pagehide", this._pageHide);
    window.removeEventListener("pageshow", this._pageShow);
    this._syncVisibility();
  }
  _syncVisibility() {
    const active = Boolean(this.isConnected && this._visible && this._pageActive &&
      document.visibilityState === "visible" && this._hass);
    if (!active) {
      for (const key of ["origin", "destination"]) {
        clearTimeout(this._searchTimers[key]);
        this._searchRevisions[key]++;
      }
    }
    this._active = active;
    this._refresher?.setActive(active && this._hasRoute);
    clearTimeout(this._clockTimer);
    if (active && this._hasRoute) this._clockTimer = setTimeout(() => {
      this._updateResults();
      this._syncVisibility();
    }, 60000);
  }
  async _fetch(force = false) {
    if (!this._hasRoute || !this._hass) return;
    const revision = this._revision;
    this._loading = true;
    this._updateResults();
    try {
      const result = await this._hass.callWS({type: "nyssetulee/journey", origin: this._origin, destination: this._destination, ...(force ? {force_refresh:true} : {})});
      if (revision !== this._revision) return;
      this._data = result;
      this._error = null;
      const retry = result.retry_after || 0;
      if (retry) this._refresher.notBefore = Date.now() + retry * 1000;
    } catch (error) {
      if (revision === this._revision) { this._data = null; this._error = error; }
    } finally {
      if (revision === this._revision) { this._loading = false; this._updateResults(); }
    }
  }
  _render() {
    const t = this._text;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        ha-card { overflow:hidden; padding:20px; color:var(--primary-text-color); }
        header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        h2 { margin:0; font-size:22px; font-weight:600; }
        .brand { color:var(--secondary-text-color); font-size:12px; letter-spacing:.08em; text-transform:uppercase; margin-bottom:5px; }
        button,input { font:inherit; }
        button { cursor:pointer; color:var(--primary-text-color); background:var(--secondary-background-color, #eee); border:0; border-radius:10px; padding:10px 12px; }
        button:focus-visible,input:focus-visible { outline:2px solid var(--primary-color); outline-offset:2px; }
        button:disabled { opacity:.55; cursor:wait; }
        .places { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:20px 0 12px; }
        label { display:block; color:var(--secondary-text-color); font-size:12px; }
        input { box-sizing:border-box; width:100%; min-width:0; margin-top:6px; padding:11px; border:1px solid var(--divider-color,#ccc); border-radius:10px; background:var(--card-background-color); color:var(--primary-text-color); }
        .suggestions button { display:block; text-align:left; width:100%; margin-top:5px; }
        .suggestions { font-size:13px; }
        h3 { font-size:15px; margin:22px 0 8px; }
        .row { display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid var(--divider-color,#ddd); }
        .line { background:var(--primary-color,#007c54); color:var(--text-primary-color,#fff); font-weight:700; min-width:36px; padding:8px 5px; text-align:center; border-radius:9px; }
        .stop { flex:1; min-width:0; font-size:14px; }
        .status,.meta { color:var(--secondary-text-color); font-size:12px; margin-top:4px; }
        .live { color:var(--success-color,#198754); }
        .time { text-align:right; font-size:21px; font-weight:600; white-space:nowrap; }
        .countdown { font-size:12px; font-weight:400; color:var(--secondary-text-color); }
        .error { padding:12px; background:var(--secondary-background-color); border-radius:8px; }
        footer { margin-top:18px; color:var(--secondary-text-color); font-size:12px; }
        @media(max-width:480px) { .places { grid-template-columns:1fr; } ha-card { padding:16px; } }
      </style>
      <ha-card>
        <header><div><div class="brand">Nyssetulee</div><h2>${escapeHTML(this._config.title || t.title)}</h2></div><button id="refresh" aria-label="${t.refreshLabel}">↻ ${t.refresh}</button></header>
        <div class="places">
          ${["origin", "destination"].map(key => `<div><label>${key === "origin" ? t.from : t.to}<input id="${key}" autocomplete="off" maxlength="120" aria-label="${t[key]}" aria-controls="${key}-suggestions"></label><div id="${key}-suggestions" class="suggestions" aria-live="polite"></div></div>`).join("")}
        </div>
        <div id="results" aria-live="polite"></div>
        <footer>${t.footer}</footer>
      </ha-card>`;
    for (const key of ["origin", "destination"]) {
      const input = this.shadowRoot.getElementById(key);
      input.value = this[`_${key}`]?.name || "";
      input.addEventListener("input", () => this._search(key, input.value));
      input.addEventListener("keydown", event => {
        if (event.key === "Escape") this.shadowRoot.getElementById(`${key}-suggestions`).replaceChildren();
      });
    }
    this.shadowRoot.getElementById("refresh").addEventListener("click", () => this._refresher.refresh(true));
    this._updateResults();
  }
  _updateResults() {
    const t = this._text;
    const language = cardLanguage(this._hass);
    const target = this.shadowRoot.getElementById("results");
    if (!target) return;
    const button = this.shadowRoot.getElementById("refresh");
    button.disabled = Boolean(this._loading || !this._hasRoute);
    button.textContent = this._loading ? t.refreshing : `↻ ${t.refresh}`;
    if (!this._hasRoute) { target.innerHTML = `<p class="meta">${t.chooseRoute}</p>`; return; }
    if (this._error) { target.innerHTML = `<p class="error">${escapeHTML(errorMessage(this._error, language))}</p>`; return; }
    if (!this._data) { target.innerHTML = `<p class="meta">${this._loading ? t.loading : t.waiting}</p>`; return; }
    const format = timestamp => new Intl.DateTimeFormat(language, {hour:"2-digit", minute:"2-digit", hourCycle:"h23", timeZone:"Europe/Helsinki"}).format(new Date(timestamp));
    target.innerHTML = (() => {
      const data = this._data;
      const from = this._origin.name;
      const to = this._destination.name;
      const heading = `<h3>${escapeHTML(from)} → ${escapeHTML(to)}</h3>`;
      if (data?.error) return heading + `<p class="error">${escapeHTML(errorMessage(data.error, language))}</p>`;
      if (!data) return heading + `<p class="error">${t.noResponse}</p>`;
      const rows = departures(data);
      const content = rows.length ? rows.map(leg => {
        const mins = Math.max(0, Math.ceil((leg.time - Date.now()) / 60000));
        return `<div class="row"><span class="line">${escapeHTML(leg.line || leg.mode)}</span><div class="stop">${escapeHTML(leg.from?.name)}<div class="status ${leg.live ? "live" : ""}">${leg.live ? t.live : t.scheduled}</div></div><div class="time">${format(leg.time)}<div class="countdown">${countdown(mins, language)}</div></div></div>`;
      }).join("") : `<p class="meta">${t.empty}</p>`;
      const updated = Date.parse(data.updated);
      const age = Date.now() - updated;
      const meta = Number.isFinite(updated) ? `${t.updated} ${format(updated)}${age > this._refresher.interval + 120000 ? ` · ${t.stale}` : ""}` : t.noUpdate;
      const warnings = data.routing_errors?.length ? `<p class="meta">${t.warnings}</p>` : "";
      return heading + content + `<div class="meta">${meta}</div>` + warnings;
    })();
  }
  _search(key, query) {
    clearTimeout(this._searchTimers[key]);
    const revision = ++this._searchRevisions[key];
    const target = this.shadowRoot.getElementById(`${key}-suggestions`);
    target.replaceChildren();
    if (!this._active || query.trim().length < 2) return;
    this._searchTimers[key] = setTimeout(async () => {
      if (!this._active) return;
      target.textContent = this._text.searching;
      try {
        const places = await this._hass.callWS({type:"nyssetulee/places", query:query.trim()});
        if (revision !== this._searchRevisions[key] || !this._active) return;
        target.replaceChildren();
        if (!places.length) target.textContent = this._text.noAddresses;
        for (const place of places) {
          const button = document.createElement("button");
          button.textContent = place.name;
          button.addEventListener("click", () => this._selectPlace(key, place));
          target.append(button);
        }
      } catch (error) {
        if (revision === this._searchRevisions[key] && this._active) target.textContent = errorMessage(error, cardLanguage(this._hass));
      }
    }, 500);
  }
  _selectPlace(key, place) {
    if (!validPoint(place)) return;
    const wasActive = this._refresher.active;
    this[`_${key}`] = {...place};
    this._revision++;
    this._searchRevisions[key]++;
    this._data = null;
    this._error = null;
    this.shadowRoot.getElementById(key).value = place.name || "";
    this.shadowRoot.getElementById(`${key}-suggestions`).replaceChildren();
    this._updateResults();
    this._syncVisibility();
    if (wasActive) void this._refresher.refresh();
  }
}

export class NyssetuleeCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode:"open"});
    this._timers = {};
    this._revisions = {origin:0, destination:0};
  }
  setConfig(config) {
    this._config = {...config};
    this._render();
  }
  set hass(value) {
    const old = this._hass;
    this._hass = value;
    if (this._config && (!old || cardLanguage(old) !== cardLanguage(value))) this._render();
  }
  disconnectedCallback() { this._cancelSearches(); }
  _cancelSearches() {
    for (const key of ["origin", "destination"]) {
      clearTimeout(this._timers[key]);
      this._revisions[key]++;
    }
  }
  _render() {
    this._cancelSearches();
    const t = TEXT[cardLanguage(this._hass)];
    this.shadowRoot.innerHTML = `<style>
      label {display:block; margin:16px 0; color:var(--primary-text-color);}
      input {box-sizing:border-box; width:100%; margin-top:6px; padding:12px; font:inherit;
        border:1px solid var(--divider-color,#ccc); border-radius:8px;
        color:var(--primary-text-color); background:var(--card-background-color);}
      button {display:block; width:100%; text-align:left; padding:10px; margin:4px 0;
        font:inherit; cursor:pointer; border:0; border-radius:8px;
        color:var(--primary-text-color); background:var(--secondary-background-color,#eee);}
      p,.suggestions {font-size:13px; color:var(--secondary-text-color);}
    </style><p>${t.editorHelp}</p>
    <label>${t.titleLabel}<input id="title" maxlength="120"></label>
    ${["origin", "destination"].map(key => `<label>${t[key]}<input id="${key}" autocomplete="off" maxlength="120" aria-controls="${key}-suggestions"></label><div class="suggestions" id="${key}-suggestions" aria-live="polite"></div>`).join("")}`;
    const title = this.shadowRoot.getElementById("title");
    title.value = this._config.title || "";
    title.addEventListener("change", () => {
      this._config = {...this._config};
      if (title.value.trim()) this._config.title = title.value.trim();
      else delete this._config.title;
      this._emitConfig();
    });
    for (const key of ["origin", "destination"]) {
      const input = this.shadowRoot.getElementById(key);
      input.value = this._config[key]?.name || "";
      input.addEventListener("input", () => this._search(key, input.value));
    }
  }
  _emitConfig() {
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail:{config:{...this._config}}, bubbles:true, composed:true,
    }));
  }
  _selectPlace(key, place) {
    if (!validPoint(place)) return;
    this._revisions[key]++;
    this._config = {...this._config, [key]:{name:place.name || "", lat:place.lat, lon:place.lon}};
    this.shadowRoot.getElementById(key).value = place.name || "";
    this.shadowRoot.getElementById(`${key}-suggestions`).replaceChildren();
    this._emitConfig();
  }
  _search(key, query) {
    clearTimeout(this._timers[key]);
    const revision = ++this._revisions[key];
    const target = this.shadowRoot.getElementById(`${key}-suggestions`);
    target.replaceChildren();
    if (!this._hass || query.trim().length < 2) return;
    this._timers[key] = setTimeout(async () => {
      if (!this.isConnected) return;
      target.textContent = TEXT[cardLanguage(this._hass)].searching;
      try {
        const places = await this._hass.callWS({type:"nyssetulee/places", query:query.trim()});
        if (revision !== this._revisions[key] || !this.isConnected) return;
        target.replaceChildren();
        if (!places.length) target.textContent = TEXT[cardLanguage(this._hass)].noAddresses;
        for (const place of places) {
          const button = document.createElement("button");
          button.textContent = place.name;
          button.addEventListener("click", () => this._selectPlace(key, place));
          target.append(button);
        }
      } catch (error) {
        if (revision === this._revisions[key] && this.isConnected) target.textContent = errorMessage(error, cardLanguage(this._hass));
      }
    }, 500);
  }
}

if (!customElements.get("nyssetulee-card")) customElements.define("nyssetulee-card", NyssetuleeCard);
if (!customElements.get("nyssetulee-card-editor")) customElements.define("nyssetulee-card-editor", NyssetuleeCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({type:"nyssetulee-card", name:"Nyssetulee", description:"Bus departures from origin to destination"});
