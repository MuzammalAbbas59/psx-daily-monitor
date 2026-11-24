// Watchlist and sector groups. Edit these lists to change what the board tracks.
// The board currently tracks 36 unique symbols (OURS + BROKER + WTL, duplicates removed).
window.PSX_CONFIG = {
  ours: "TPLP TPLL CLVL GCIL FCEPL TPLRF1 TISL YOUW DNCC PASL LIVEN STL BOP MLCF GDL CNERGY MEHT SAIF THCCL".split(
    " ",
  ),
  broker:
    "TSMF TSPL RUPL REDCO FEM FPRM RUBY FTMM ASHT BPL CLVL DNCC PNSC INKL ARMG CWHC FCEPL LEUL PGLC".split(
      " ",
    ),
  // Shown in the main table only, never in the hot panel.
  extra: ["WTL"],
  // Always omitted from the hot panel.
  flagged: ["RUBY", "PASL"],
  // Excluded from the hot panel when crude direction is "Up".
  cement: ["DNCC", "MLCF", "THCCL"],
  // Excluded from the hot panel when crude direction is "Down".
  refinery: ["CNERGY"],
};
