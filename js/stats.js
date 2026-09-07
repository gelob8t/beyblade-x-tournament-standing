// Pure match/stat math — no Firebase, no DOM. Unit-tested in test/stats.test.mjs.

export const FINISHES = [
  { key: "Spin", label: "Spin Finish", pts: 1 },
  { key: "Over", label: "Over Finish", pts: 2 },
  { key: "Burst", label: "Burst Finish", pts: 2 },
  { key: "Xtreme", label: "Xtreme Finish", pts: 3 },
];

export const finishLabel = (k) => FINISHES.find((f) => f.key === k)?.label || k;
export const finishPts = (k) => FINISHES.find((f) => f.key === k)?.pts || 0;

/** Points each side scored in a match, from its games. */
export function matchScore(m) {
  let mine = 0, opp = 0;
  for (const g of m.games || []) {
    if (g.winner === "me") mine += finishPts(g.finish);
    else opp += finishPts(g.finish);
  }
  return { mine, opp };
}

/** "W" | "L" | "—" — manual result wins, else derived from game points. */
export function matchResult(m) {
  if (m.result === "W" || m.result === "L") return m.result;
  const { mine, opp } = matchScore(m);
  if (mine === opp) return "—";
  return mine > opp ? "W" : "L";
}

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Group rated matches by a key, returning W-L records sorted by games played. */
export function groupRecord(matches, keyFn, limit = 12) {
  const g = {};
  for (const m of matches) {
    const key = keyFn(m);
    if (!key) continue;
    g[key] = g[key] || { w: 0, l: 0 };
    if (matchResult(m) === "W") g[key].w++; else g[key].l++;
  }
  return Object.entries(g)
    .map(([name, r]) => ({ name, ...r, total: r.w + r.l, rate: r.w / (r.w + r.l) }))
    .sort((a, b) => b.total - a.total || b.rate - a.rate)
    .slice(0, limit);
}

/** Current streak (+n win / -n loss) and longest win streak, given chronological matches. */
export function streaks(chronMatches) {
  let run = 0, longestW = 0;
  for (const m of chronMatches) {
    const r = matchResult(m);
    if (r === "W") { run = run >= 0 ? run + 1 : 1; longestW = Math.max(longestW, run); }
    else if (r === "L") { run = run <= 0 ? run - 1 : -1; }
  }
  return { current: Math.abs(run), type: run > 0 ? "win" : run < 0 ? "loss" : "", longestWin: longestW };
}
