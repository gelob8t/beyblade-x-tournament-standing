// Import tournament results from Challonge. Pure parsing/shaping helpers
// here (unit-tested); the actual fetch — and the "paste the JSON" fallback
// for when the browser blocks the cross-origin request — lives in app.js.
//
// Challonge API v1 docs: https://api.challonge.com/v1
// Community/org tournaments (played at https://<sub>.challonge.com/<slug>)
// are addressed via the API as "<sub>-<slug>".

/** Parse a pasted Challonge URL or bare slug into the API tournament id. */
export function parseChallongeInput(input) {
  const s = String(input || "").trim();
  if (!s) return null;

  let host = "";
  let path = s;
  const m = s.match(/^https?:\/\/([^/]+)\/?(.*)$/i);
  if (m) { host = m[1].replace(/^www\./i, "").toLowerCase(); path = m[2]; }

  const slugPart = path.replace(/^\/+/, "").split(/[/?#]/)[0];
  if (!slugPart) return null;

  if (host && host !== "challonge.com" && host.endsWith(".challonge.com")) {
    const sub = host.slice(0, -".challonge.com".length);
    return `${sub}-${slugPart}`;
  }
  return slugPart;
}

/** The Challonge API URL to fetch (or to open directly, as a CORS fallback). */
export function apiUrl(idOrSlug, apiKey = "") {
  const params = new URLSearchParams({ include_participants: "1", include_matches: "1" });
  if (apiKey) params.set("api_key", apiKey);
  return `https://api.challonge.com/v1/tournaments/${encodeURIComponent(idOrSlug)}.json?${params}`;
}

/** Normalise the raw Challonge API payload into a flat, friendly shape. */
export function normalizeTournament(raw) {
  const t = (raw && raw.tournament) || raw || {};
  const participants = (t.participants || [])
    .map((p) => p.participant || p)
    .map((p) => ({
      id: p.id,
      name: p.display_name || p.name || `Player ${p.id}`,
      finalRank: p.final_rank ?? null,
      seed: p.seed ?? null,
    }));
  const matches = (t.matches || [])
    .map((m) => m.match || m)
    .map((m) => ({
      id: m.id,
      round: m.round ?? null,
      player1Id: m.player1_id,
      player2Id: m.player2_id,
      winnerId: m.winner_id ?? null,
      loserId: m.loser_id ?? null,
      scoresCsv: m.scores_csv || "",
      state: m.state || "",
      completedAt: m.completed_at || null,
    }));
  return {
    name: t.name || "Challonge tournament",
    url: t.full_challonge_url ? `https://${t.full_challonge_url}` : (t.url || ""),
    type: t.tournament_type || "",
    startedAt: t.started_at || t.created_at || null,
    completedAt: t.completed_at || null,
    participants,
    matches,
  };
}

/** This participant's completed matches, oldest round first, opponent resolved. */
export function matchResultsFor(normalized, participantId) {
  const pid = String(participantId);
  const byId = new Map((normalized.participants || []).map((p) => [String(p.id), p]));
  return (normalized.matches || [])
    .filter((m) => m.state === "complete" && (String(m.player1Id) === pid || String(m.player2Id) === pid))
    .map((m) => {
      const oppId = String(m.player1Id) === pid ? m.player2Id : m.player1Id;
      return { m, oppId };
    })
    .filter(({ oppId }) => oppId != null) // skip byes
    .sort((a, b) =>
      (a.m.round ?? 0) - (b.m.round ?? 0) ||
      new Date(a.m.completedAt || 0) - new Date(b.m.completedAt || 0))
    .map(({ m, oppId }) => {
      const opp = byId.get(String(oppId));
      return {
        matchId: m.id,
        round: m.round,
        opponent: opp ? opp.name : "Unknown",
        result: String(m.winnerId) === pid ? "W" : "L",
        score: m.scoresCsv || "",
        date: m.completedAt ? String(m.completedAt).slice(0, 10) : null,
      };
    });
}

/** Build {tournament, matches} rows ready to hand to store.create()/createMany(). */
export function buildImportPlan(normalized, participantId) {
  const me = (normalized.participants || []).find((p) => String(p.id) === String(participantId));
  const results = matchResultsFor(normalized, participantId);
  const wins = results.filter((r) => r.result === "W").length;
  const losses = results.filter((r) => r.result === "L").length;
  const fallbackDate = String(normalized.completedAt || normalized.startedAt || "").slice(0, 10) || null;

  return {
    tournament: {
      name: normalized.name,
      date: fallbackDate,
      location: "",
      format: normalized.type || "",
      placement: me && me.finalRank ? me.finalRank : null,
      wins,
      losses,
      notes: normalized.url ? `Imported from Challonge: ${normalized.url}` : "Imported from Challonge.",
    },
    matches: results.map((r) => ({
      date: r.date || fallbackDate,
      opponent: r.opponent,
      myDeck: "",
      opponentDeck: "",
      games: [],
      result: r.result,
      notes: r.score ? `Challonge score: ${r.score}` : "",
    })),
  };
}
