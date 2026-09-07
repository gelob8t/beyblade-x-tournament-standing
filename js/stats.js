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

// ---- meta / combo tier list ------------------------------------------------

export const TIERS = ["S", "A", "B", "C", "D"];
const TIER_WEIGHT = { S: 5, A: 4, B: 3, C: 2, D: 1 };

/** Stable key for a Blade/Ratchet/Bit combo. */
export function comboKey(blade, ratchet, bit) {
  return [blade, ratchet, bit]
    .map((s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .join("__")
    .slice(0, 200);
}

/** Turn an S–D vote tally into an average score + consensus letter. */
export function consensus(tally = {}, count = 0) {
  const n = count || TIERS.reduce((s, t) => s + (tally[t] || 0), 0);
  if (!n) return { score: 0, letter: null, count: 0 };
  const score = TIERS.reduce((s, t) => s + (tally[t] || 0) * TIER_WEIGHT[t], 0) / n;
  const letter =
    score >= 4.5 ? "S" : score >= 3.5 ? "A" : score >= 2.5 ? "B" : score >= 1.5 ? "C" : "D";
  return { score: Math.round(score * 10) / 10, letter, count: n };
}

function achv(id, icon, name, desc, done, have, need) {
  const a = { id, icon, name, desc, done: !!done };
  if (need && !done && have != null) a.progress = { have: Math.max(0, Math.min(have, need)), need };
  return a;
}

/**
 * Derive the achievement list from a user's data.
 * @param {{matches?:array, tournaments?:array, beys?:array, decks?:array,
 *          friendsCount?:number, hasTeam?:boolean}} d
 */
export function achievements(d = {}) {
  const matches = d.matches || [];
  const tournaments = d.tournaments || [];
  const beys = d.beys || [];
  const decks = d.decks || [];

  const played = matches.filter((m) => matchResult(m) !== "—");
  const wins = played.filter((m) => matchResult(m) === "W").length;
  const winRate = played.length ? wins / played.length : 0;
  const chron = [...played].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const { longestWin } = streaks(chron);

  const fin = {};
  for (const m of matches) for (const g of m.games || []) {
    if (g.winner === "me") fin[g.finish] = (fin[g.finish] || 0) + 1;
  }
  const distinctFinishes = ["Spin", "Over", "Burst", "Xtreme"].filter((k) => fin[k] > 0).length;

  const placements = tournaments.map((t) => Number(t.placement)).filter((n) => n > 0);

  return [
    achv("first-match", "🎬", "First blood", "Log your first match", played.length >= 1, played.length, 1),
    achv("ten-matches", "🔟", "Getting serious", "Log 10 matches", matches.length >= 10, matches.length, 10),
    achv("fifty-matches", "5️⃣0️⃣", "Grinder", "Log 50 matches", matches.length >= 50, matches.length, 50),
    achv("hundred", "💯", "Centurion", "Log 100 matches", matches.length >= 100, matches.length, 100),
    achv("first-tournament", "🏟️", "Tournament debut", "Log your first tournament", tournaments.length >= 1, tournaments.length, 1),
    achv("podium", "🥉", "On the podium", "Finish top 3 in a tournament", placements.some((p) => p <= 3)),
    achv("win-tournament", "🏆", "Winner's circle", "Finish 1st in a tournament", placements.some((p) => p === 1)),
    achv("streak5", "🔥", "Hot streak", "Win 5 matches in a row", longestWin >= 5, longestWin, 5),
    achv("streak10", "⚡", "On fire", "Win 10 matches in a row", longestWin >= 10, longestWin, 10),
    achv("winrate", "📈", "Above the curve", "Hold a 60%+ win rate over 20+ matches", played.length >= 20 && winRate >= 0.6),
    achv("xtreme1", "🚀", "Xtreme", "Score your first Xtreme Finish", (fin.Xtreme || 0) >= 1),
    achv("spin10", "🌀", "Spin doctor", "Score 10 Spin Finishes", (fin.Spin || 0) >= 10, fin.Spin || 0, 10),
    achv("burst10", "💥", "Burst artist", "Score 10 Burst Finishes", (fin.Burst || 0) >= 10, fin.Burst || 0, 10),
    achv("all-finishes", "🎯", "Full kit", "Score all four finish types", distinctFinishes >= 4, distinctFinishes, 4),
    achv("collector", "🧰", "Collector", "Own 15 parts", beys.length >= 15, beys.length, 15),
    achv("deck1", "🃏", "Deck builder", "Build your first deck", decks.length >= 1, decks.length, 1),
    achv("deck3", "🗂️", "Three decks deep", "Build 3 decks", decks.length >= 3, decks.length, 3),
    achv("friend", "🤝", "Made a friend", "Add your first friend", (d.friendsCount || 0) >= 1),
    achv("team", "👥", "Team player", "Join or create a team", !!d.hasTeam),
  ];
}
