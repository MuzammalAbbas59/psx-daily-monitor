"use strict";
// localStorage persistence, stored as JSON. Every access is wrapped in try/catch so the
// board still works when storage is blocked or full (private window, quota, etc.).
//
// What is persisted:
//   psx-prefs-v3         UI settings: crude direction, search, source filter, sort.
//   psx-observations-v3  Today's observed quotes (for CSV export), restored after a reload.
//   psx-hot-dismissed-v3 Dismissed symbols (handled in app.js, same key as the original file).
//
// Momentum history is NOT restored: the signal logic only trusts history from the current
// connection (epoch), so a reload starts fresh exactly as before.
const Storage = (() => {
  const PREFS_KEY = "psx-prefs-v3",
    OBS_KEY = "psx-observations-v3";
  const read = (key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };
  // Observations are stored as compact arrays to fit more rows in the ~5 MB quota.
  const FIELDS = [
    "symbol",
    "time",
    "pct",
    "epoch",
    "price",
    "volume",
    "quoteTime",
    "state",
  ];
  return {
    loadPrefs: () => read(PREFS_KEY) || {},
    savePrefs: (prefs) => write(PREFS_KEY, prefs),
    // Returns { rows, maxEpoch } for the given Pakistan trading date, or empty if none.
    loadObservations(date) {
      const data = read(OBS_KEY);
      if (!data || data.date !== date || !Array.isArray(data.rows))
        return { rows: [], maxEpoch: 0 };
      const rows = data.rows
        .filter((r) => Array.isArray(r) && r.length === FIELDS.length)
        .map((r) => Object.fromEntries(FIELDS.map((f, i) => [f, r[i]])));
      return {
        rows,
        maxEpoch: rows.reduce((m, r) => Math.max(m, Number(r.epoch) || 0), 0),
      };
    },
    // Saves as many of the newest rows as fit; the in-memory list is never touched.
    saveObservations(date, observations) {
      let rows = observations.map((o) => FIELDS.map((f) => o[f] ?? null));
      while (!write(OBS_KEY, { date, rows }) && rows.length)
        rows = rows.slice(Math.floor(rows.length / 2));
    },
  };
})();
