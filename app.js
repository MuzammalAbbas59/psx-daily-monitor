"use strict";
const CONFIG = window.PSX_CONFIG;
const OURS = CONFIG.ours,
  BROKER = CONFIG.broker,
  SYMBOLS = [...new Set([...OURS, ...BROKER, ...CONFIG.extra])],
  allowed = new Set(SYMBOLS),
  quotes = new Map(),
  history = new Map(),
  observations = [];
const $ = (id) => document.getElementById(id),
  fmtTime = (t) =>
    Number.isFinite(t)
      ? new Date(t).toLocaleTimeString("en-GB", { timeZone: "Asia/Karachi" })
      : "—";
const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Karachi",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
function pkt(t = Date.now()) {
  const p = Object.fromEntries(
    partsFmt.formatToParts(t).map((x) => [x.type, x.value]),
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    day: p.weekday,
    min: Number(p.hour) * 60 + Number(p.minute),
  };
}
function windowOpen(t = Date.now()) {
  const p = pkt(t);
  return (
    !["Sat", "Sun"].includes(p.day) &&
    p.min >= (p.day === "Fri" ? 545 : 560) &&
    p.min <= 960
  );
}
const num = (x) =>
    x === null || x === undefined || x === ""
      ? null
      : Number.isFinite(Number(x))
        ? Number(x)
        : null,
  timestamp = (x) => {
    const n = num(x);
    return n === null ? null : n < 1e12 ? n * 1000 : n;
  };
function normalize(x, stream = false) {
  const price = num(stream ? x.c : x.price),
    ch = num(stream ? x.ch : x.change),
    raw = num(stream ? x.pch : x.changePercent),
    prev = price !== null && ch !== null && price - ch > 0 ? price - ch : null;
  return {
    symbol: String(stream ? x.s : x.symbol).toUpperCase(),
    price,
    pct: prev !== null ? (100 * ch) / prev : raw === null ? null : raw * 100,
    prev,
    volume: num(stream ? x.v : x.volume),
    bid: num(stream ? x.bp : x.bid),
    ask: num(stream ? x.ap : x.ask),
    bv: num(stream ? x.bv : x.bidVol),
    av: num(stream ? x.av : x.askVol),
    high: num(stream ? x.h : x.high),
    low: num(stream ? x.l : x.low),
    open: num(x.open),
    cap: num(x.upperCircuit ?? x.upperLimit),
    state: x.st || "—",
    ts: timestamp(stream ? x.t : x.timestamp),
    received: Date.now(),
    source: stream ? "stream" : "snapshot",
  };
}
let socket = null,
  retry = null,
  backoff = 1000,
  lastStream = null,
  connected = false,
  epoch = 0,
  day = pkt().date,
  sortKey = "pct",
  ascending = false,
  dirty = true,
  loadId = 0;
// Restore today's observations (CSV export only). The epoch counter continues above the
// stored maximum so restored rows never share an epoch with this page's connections.
{
  const saved = Storage.loadObservations(day);
  for (const r of saved.rows) observations.push(r);
  epoch = saved.maxEpoch;
}
function accept(q) {
  if (!allowed.has(q.symbol) || q.price === null || q.price <= 0) return;
  const old = quotes.get(q.symbol);
  if (old && old.ts !== null && q.ts !== null && old.ts > q.ts) return;
  if (
    old &&
    old.source === "stream" &&
    q.source === "snapshot" &&
    (old.ts === null || q.ts === null || old.ts >= q.ts)
  )
    return;
  quotes.set(q.symbol, q);
  dirty = true;
}
function snapshot() {
  const id = ++loadId;
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 12000);
  fetch("https://psxterminal.com/api/market-data?market=REG", {
    signal: ctl.signal,
    cache: "no-store",
  })
    .then((r) => {
      if (!r.ok) throw Error("HTTP " + r.status);
      return r.json();
    })
    .then((j) => {
      if (id !== loadId) return;
      const data = j.data?.REG;
      if (!data || typeof data !== "object")
        throw Error("Unexpected market snapshot");
      Object.values(data).forEach((x) => accept(normalize(x)));
    })
    .catch((e) => {
      if (!connected)
        $("error").textContent =
          "Snapshot unavailable (" +
          e.message +
          "). Waiting for streaming connection; no invented data.";
    })
    .finally(() => clearTimeout(timeout));
}
function connect() {
  clearTimeout(retry);
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  connected = false;
  epoch++;
  $("conn").textContent = "Connecting…";
  $("conn").className = "warn";
  try {
    const ws = new WebSocket("wss://psxterminal.com/");
    socket = ws;
    ws.onopen = () => {
      if (socket !== ws) return;
      backoff = 1000;
      connected = true;
      $("conn").textContent = "Socket connected";
      $("conn").className = "up";
      $("error").textContent =
        "Connected; awaiting current market quotes. Compare provider timestamps with JS Investor.";
      ws.send(
        JSON.stringify({
          type: "subscribe",
          subscriptionType: "marketData",
          params: { marketType: "REG" },
          requestId: "watchlist-reg",
        }),
      );
      snapshot();
    };
    ws.onmessage = (e) => {
      if (socket !== ws) return;
      let j;
      try {
        j = JSON.parse(e.data);
      } catch {
        return;
      }
      if (j.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", timestamp: j.timestamp }));
        return;
      }
      if (j.type === "error") {
        $("error").textContent =
          "Provider error: " + String(j.message || "Unknown");
        return;
      }
      if (j.type === "tickUpdate" && j.market === "REG" && j.tick) {
        const q = normalize(
          { ...j.tick, s: j.tick.s ?? j.symbol, t: j.tick.t ?? j.timestamp },
          true,
        );
        lastStream = Date.now();
        accept(q);
        $("error").textContent =
          "Streaming quotes received. Exchange latency is not independently verified.";
      }
    };
    ws.onerror = () => {
      $("error").textContent =
        "Stream connection error. Retrying automatically after disconnect.";
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      connected = false;
      epoch++;
      $("conn").textContent = "Disconnected · retrying";
      $("conn").className = "warn";
      $("error").textContent =
        "Stream offline. Existing quotes are retained as stale; reconnecting automatically.";
      retry = setTimeout(connect, backoff);
      backoff = Math.min(30000, backoff * 2);
    };
  } catch (e) {
    $("error").textContent = "WebSocket unavailable: " + e.message;
    retry = setTimeout(connect, backoff);
    backoff = Math.min(30000, backoff * 2);
  }
}
function fresh(q, now = Date.now()) {
  return (
    q &&
    q.ts !== null &&
    now - q.ts >= -60000 &&
    now - q.ts <= 90000 &&
    pkt(q.ts).date === pkt(now).date
  );
}
function observe(now = Date.now()) {
  const d = pkt(now).date;
  if (d !== day) {
    day = d;
    history.clear();
    observations.length = 0;
    epoch++;
  }
  if (!connected || !windowOpen(now)) return;
  for (const [s, q] of quotes) {
    if (!fresh(q, now) || q.pct === null || !["PRE", "OPN"].includes(q.state))
      continue;
    const list = history.get(s) || [];
    const item = {
      time: now,
      pct: q.pct,
      epoch,
      price: q.price,
      volume: q.volume,
      quoteTime: q.ts,
      state: q.state,
    };
    list.push(item);
    while (list.length && list[0].time < now - 16 * 60000) list.shift();
    history.set(s, list);
    if (observations.length < 100000) observations.push({ symbol: s, ...item });
  }
}
function past(s, mins, now = Date.now(), state = null) {
  const l = history.get(s) || [],
    target = now - mins * 60000;
  for (let i = l.length - 1; i >= 0; i--) {
    const r = l[i];
    if (r.time <= target)
      return r.epoch === epoch &&
        target - r.time <= 20000 &&
        (!state || r.state === state)
        ? r.pct
        : null;
  }
  return null;
}
const flagged = new Set(CONFIG.flagged),
  cement = new Set(CONFIG.cement),
  refinery = new Set(CONFIG.refinery);
let dismissDate = pkt().date,
  dismissed = new Set();
function loadDismissals() {
  dismissDate = pkt().date;
  dismissed = new Set();
  try {
    const data = JSON.parse(
      localStorage.getItem("psx-hot-dismissed-v3") || "null",
    );
    if (data?.date === dismissDate && Array.isArray(data.symbols))
      dismissed = new Set(data.symbols.filter((s) => allowed.has(s)));
  } catch {}
}
function saveDismissals() {
  try {
    localStorage.setItem(
      "psx-hot-dismissed-v3",
      JSON.stringify({ date: dismissDate, symbols: [...dismissed] }),
    );
  } catch {}
}
function changeDismiss(s, hide) {
  if (!allowed.has(s)) return;
  if (hide) dismissed.add(s);
  else dismissed.delete(s);
  saveDismissals();
  render();
}
function syncDismissDate(now) {
  if (pkt(now).date !== dismissDate) loadDismissals();
}
loadDismissals();
function rowData(s, now, regularOnly = false) {
  const q = quotes.get(s) || {},
    valid = connected && fresh(q, now),
    pct = q.pct ?? null;
  const r = { ...q, symbol: s, group: group(s), valid, pct };
  for (const m of [1, 3, 5, 10, 15]) {
    r["p" + m] = valid ? past(s, m, now, regularOnly ? "OPN" : null) : null;
    r["d" + m] = r["p" + m] === null || pct === null ? null : pct - r["p" + m];
  }
  r.room = q.cap > 0 && q.price > 0 ? 100 * (q.cap / q.price - 1) : null;
  return r;
}
function hotCandidates(now) {
  if (!connected || !windowOpen(now)) return [];
  const oil = $("crude").value;
  return SYMBOLS.filter(
    (s) =>
      s !== "WTL" &&
      !dismissed.has(s) &&
      !flagged.has(s) &&
      !(oil === "up" && cement.has(s)) &&
      !(oil === "down" && refinery.has(s)),
  )
    .map((s) => rowData(s, now, true))
    .filter(
      (r) =>
        r.valid &&
        r.source === "stream" &&
        r.state === "OPN" &&
        r.d1 !== null &&
        r.d1 >= 0 &&
        r.d3 !== null &&
        r.d3 >= 0.25 &&
        (r.d5 === null || r.d5 > 0) &&
        (r.room === null || r.room > 0.01),
    )
    .sort(
      (a, b) =>
        (b.d5 ?? b.d3) - (a.d5 ?? a.d3) ||
        b.d3 - a.d3 ||
        a.symbol.localeCompare(b.symbol),
    )
    .slice(0, 5);
}
function actionButton(label, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.className = "dismiss-btn";
  b.onclick = fn;
  return b;
}
function renderHot(now) {
  const rows = hotCandidates(now),
    frag = document.createDocumentFragment();
  $("hot-status").textContent = rows.length
    ? rows.length +
      " qualifying momentum candidate(s) · " +
      (rows.some((r) => r.d5 === null)
        ? "3m ranking used where 5m history is not yet available"
        : "ranked by 5m change") +
      " · " +
      ($("crude").value === "unknown"
        ? "crude direction not set"
        : "crude filter applied")
    : "No qualifying fresh signals. At least 3 minutes of regular-session observations are required.";
  if (!rows.length) {
    const tr = document.createElement("tr"),
      td = document.createElement("td");
    td.colSpan = 10;
    td.className = "empty";
    td.textContent = "Waiting for qualifying momentum — no forced picks.";
    tr.append(td);
    frag.append(tr);
  }
  for (const r of rows) {
    const tr = document.createElement("tr");
    for (const k of [
      "symbol",
      "price",
      "pct",
      "d1",
      "d3",
      "d5",
      "d10",
      "room",
      "volume",
      "action",
    ]) {
      const td = document.createElement("td"),
        v = r[k];
      if (k === "action") {
        td.className = "action-cell";
        td.append(
          actionButton("Bought / Dismiss", () => changeDismiss(r.symbol, true)),
        );
      } else if (k === "symbol") {
        const b = document.createElement("b");
        b.textContent = r.symbol;
        td.append(b);
      } else if (["pct", "d1", "d3", "d5", "d10", "room"].includes(k)) {
        td.textContent =
          signed(v) + (v != null && ["pct", "room"].includes(k) ? "%" : "");
        td.className = v > 0 ? "up" : v < 0 ? "down" : "muted";
      } else if (k === "volume") {
        td.textContent = v == null ? "—" : v.toLocaleString("en-PK");
      } else td.textContent = v == null ? "—" : v.toFixed(2);
      tr.append(td);
    }
    frag.append(tr);
  }
  $("hot-rows").replaceChildren(frag);
  const hidden = document.createDocumentFragment(),
    label = document.createElement("span");
  label.className = "small";
  label.textContent = "Dismissed today (" + dismissed.size + "):";
  hidden.append(label);
  for (const s of [...dismissed].sort())
    hidden.append(actionButton("Restore " + s, () => changeDismiss(s, false)));
  if (dismissed.size)
    hidden.append(
      actionButton("Restore all", () => {
        dismissed.clear();
        saveDismissals();
        render();
      }),
    );
  $("dismissed").replaceChildren(hidden);
}
const cols = [
  ["symbol", "Stock"],
  ["group", "Source"],
  ["price", "Price"],
  ["pct", "Now %"],
  ["p5", "5m ago %"],
  ["p10", "10m ago %"],
  ["p15", "15m ago %"],
  ["d5", "5m Δ pp"],
  ["d10", "10m Δ pp"],
  ["volume", "Volume"],
  ["bid", "Bid"],
  ["bv", "Bid qty"],
  ["ask", "Ask"],
  ["av", "Ask qty"],
  ["open", "Open"],
  ["high", "High"],
  ["low", "Low"],
  ["cap", "Official cap"],
  ["state", "State"],
  ["ts", "Quote time PKT"],
  ["action", "Action"],
];
function signed(v) {
  return v === null || v === undefined
    ? "—"
    : (v > 0 ? "+" : "") + v.toFixed(2);
}
function group(s) {
  return s === "WTL"
    ? "WTL"
    : OURS.includes(s) && BROKER.includes(s)
      ? "Both"
      : BROKER.includes(s)
        ? "Broker"
        : "Ours";
}
function render() {
  const now = Date.now();
  syncDismissDate(now);
  renderHot(now);
  $("clock").textContent = fmtTime(now) + " PKT";
  $("last").textContent = fmtTime(lastStream);
  $("count").textContent = quotes.size + " / " + SYMBOLS.length;
  $("session").textContent = windowOpen(now)
    ? "Observation window"
    : "Outside observation window";
  if (connected && lastStream && now - lastStream > 90000) {
    $("conn").textContent = "Connected · no recent ticks";
    $("conn").className = "warn";
  } else if (connected) {
    $("conn").textContent = "Socket connected";
    $("conn").className = "up";
  }
  const query = $("search").value.trim().toUpperCase(),
    filter = $("source").value;
  let rs = SYMBOLS.filter(
    (s) =>
      !dismissed.has(s) &&
      s.includes(query) &&
      (filter === "all" ||
        (filter === "ours" && OURS.includes(s)) ||
        (filter === "broker" && BROKER.includes(s)) ||
        (filter === "wtl" && s === "WTL")),
  ).map((s) => rowData(s, now));
  rs.sort((a, b) => {
    const x = a[sortKey],
      y = b[sortKey];
    if (x == null && y == null) return a.symbol.localeCompare(b.symbol);
    if (x == null) return 1;
    if (y == null) return -1;
    return (
      (typeof x === "string" ? x.localeCompare(y) : x - y) *
      (ascending ? 1 : -1)
    );
  });
  const frag = document.createDocumentFragment();
  for (const r of rs) {
    const tr = document.createElement("tr");
    for (const [k] of cols) {
      const td = document.createElement("td"),
        v = r[k];
      if (k === "action") {
        td.append(actionButton("Dismiss", () => changeDismiss(r.symbol, true)));
      } else if (k === "symbol") {
        const b = document.createElement("b");
        b.textContent = v;
        td.append(b);
      } else if (["pct", "p5", "p10", "p15", "d5", "d10"].includes(k)) {
        td.textContent =
          signed(v) +
          (v != null && ["pct", "p5", "p10", "p15"].includes(k) ? "%" : "");
        td.className = v > 0 ? "up" : v < 0 ? "down" : "muted";
        if (k === "pct" && !r.valid && v != null) td.className = "warn";
      } else if (k === "ts") {
        td.textContent = fmtTime(v) + (v != null && !r.valid ? " · stale" : "");
        td.className = r.valid ? "muted" : "warn";
      } else if (["volume", "bv", "av"].includes(k)) {
        td.textContent = v == null ? "—" : v.toLocaleString("en-PK");
      } else if (typeof v === "number") {
        td.textContent = v.toFixed(2);
      } else {
        td.textContent = v ?? "—";
      }
      tr.append(td);
    }
    frag.append(tr);
  }
  $("rows").replaceChildren(frag);
  dirty = false;
}
for (const [k, label] of cols) {
  const th = document.createElement("th");
  th.textContent = label;
  if (k !== "action")
    th.onclick = () => {
      ascending = sortKey === k ? !ascending : k === "symbol" || k === "group";
      sortKey = k;
      savePrefs();
      render();
    };
  $("headers").append(th);
}
$("sort").onchange = (e) => {
  sortKey = e.target.value;
  ascending = sortKey === "symbol";
  savePrefs();
  render();
};
// Restore saved UI settings, then save them whenever they change.
{
  const prefs = Storage.loadPrefs();
  const setSelect = (id, v) => {
    if ([...$(id).options].some((o) => o.value === v)) $(id).value = v;
  };
  setSelect("crude", prefs.crude);
  setSelect("source", prefs.source);
  if (typeof prefs.search === "string") $("search").value = prefs.search;
  if (
    typeof prefs.sortKey === "string" &&
    cols.some(([k]) => k === prefs.sortKey)
  ) {
    sortKey = prefs.sortKey;
    ascending = !!prefs.ascending;
    setSelect("sort", sortKey);
  }
}
function savePrefs() {
  Storage.savePrefs({
    crude: $("crude").value,
    source: $("source").value,
    search: $("search").value,
    sortKey,
    ascending,
  });
}
$("source").onchange = () => {
  savePrefs();
  render();
};
$("crude").onchange = () => {
  savePrefs();
  render();
};
$("search").oninput = () => {
  savePrefs();
  render();
};
$("reconnect").onclick = () => {
  backoff = 1000;
  connect();
};
$("export").onclick = () => {
  const lines = [
    "symbol,observed_utc,provider_quote_utc,price,daily_change_percent,volume,connection_epoch",
    ...observations.map((r) =>
      [
        r.symbol,
        new Date(r.time).toISOString(),
        new Date(r.quoteTime).toISOString(),
        r.price,
        r.pct,
        r.volume ?? "",
        r.epoch,
      ].join(","),
    ),
  ];
  const url = URL.createObjectURL(
    new Blob([lines.join("\n")], { type: "text/csv" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "psx-observations-" + day + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
render();
snapshot();
connect();
setInterval(() => {
  observe();
  render();
}, 5000);
setInterval(() => {
  if (dirty) render();
}, 1000);
// Persist observations every 30 s and when the tab is hidden or closed.
const saveObservations = () => Storage.saveObservations(day, observations);
setInterval(saveObservations, 30000);
addEventListener("pagehide", saveObservations);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveObservations();
});
// Morning auto-start: a tab left open overnight reloads once at 09:00 PKT on weekdays, so
// each trading day begins with a fresh connection and the latest deployed version.
// (Observation windows, signals and thresholds are unchanged.)
const loadedAt = pkt();
setInterval(() => {
  const p = pkt();
  if (["Sat", "Sun"].includes(p.day) || p.min < 540) return;
  if (loadedAt.date !== p.date || loadedAt.min < 540) {
    saveObservations();
    location.reload();
  }
}, 60000);
