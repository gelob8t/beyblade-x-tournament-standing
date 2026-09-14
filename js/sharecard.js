// Pure data-shaping for the "share my stats" card. No DOM/canvas here (that
// lives in app.js, which isn't unit-testable the same way) — just turning
// raw state into the numbers the card and share text need.
import { matchResult, groupRecord, streaks, ordinal } from "./stats.js";

/**
 * @param {{matches?:array, tournaments?:array, achv?:array,
 *          profile?:object, team?:object|null}} input
 */
export function buildCardData({ matches = [], tournaments = [], achv = [], profile = {}, team = null } = {}) {
  const played = matches.filter((m) => matchResult(m) !== "—");
  const wins = played.filter((m) => matchResult(m) === "W").length;
  const losses = played.length - wins;

  let gW = 0, gL = 0;
  for (const m of matches) for (const g of m.games || []) {
    if (g.winner === "me") gW++; else gL++;
  }

  const placements = tournaments.map((t) => Number(t.placement)).filter((n) => Number.isFinite(n) && n > 0);
  const bestPlacement = placements.length ? Math.min(...placements) : null;

  const topDeckRow = groupRecord(played, (m) => (m.myDeck || "").trim() || "Unspecified", 1)[0] || null;
  const topDeck = topDeckRow && topDeckRow.name !== "Unspecified" ? topDeckRow : null;

  const chron = [...played].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const { current, type } = streaks(chron);

  return {
    name: profile.bladerName || "Blader",
    team: team ? { tag: team.tag || "", name: team.name || "" } : null,
    region: profile.region || "",
    matches: { played: played.length, wins, losses, rate: played.length ? wins / played.length : 0 },
    games: { w: gW, l: gL, rate: (gW + gL) ? gW / (gW + gL) : 0 },
    tournaments: tournaments.length,
    bestPlacement,
    topDeck: topDeck ? { name: topDeck.name, w: topDeck.w, l: topDeck.l } : null,
    streak: current > 0 ? { current, type } : null,
    achv: { done: achv.filter((a) => a.done).length, total: achv.length },
  };
}

/** One-line text summary for the Web Share API / social intent links. */
export function shareText(data) {
  const pct = Math.round((data.matches.rate || 0) * 100);
  const bits = [`${pct}% match win rate (${data.matches.wins}-${data.matches.losses})`];
  if (data.bestPlacement) bits.push(`best finish: ${ordinal(data.bestPlacement)}`);
  if (data.streak && data.streak.current >= 3) bits.push(`on a ${data.streak.current}-${data.streak.type} streak`);
  return `My Beyblade X Journey — ${bits.join(", ")}.`;
}
