// Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseChallongeInput, apiUrl, normalizeTournament, matchResultsFor, buildImportPlan,
} from "../js/challonge.js";

test("parseChallongeInput: full URL, trailing path/query, www, bare slug", () => {
  assert.equal(parseChallongeInput("https://challonge.com/abc123"), "abc123");
  assert.equal(parseChallongeInput("https://www.challonge.com/abc123/"), "abc123");
  assert.equal(parseChallongeInput("https://challonge.com/abc123/final?x=1#frag"), "abc123");
  assert.equal(parseChallongeInput("abc123"), "abc123");
  assert.equal(parseChallongeInput("  abc123  "), "abc123");
  assert.equal(parseChallongeInput(""), null);
  assert.equal(parseChallongeInput(null), null);
});

test("parseChallongeInput: community/org subdomain tournaments prefix the id", () => {
  assert.equal(parseChallongeInput("https://mygroup.challonge.com/abc123"), "mygroup-abc123");
});

test("apiUrl: includes participants+matches, and an api_key when given", () => {
  const u = new URL(apiUrl("abc123"));
  assert.equal(u.pathname, "/v1/tournaments/abc123.json");
  assert.equal(u.searchParams.get("include_participants"), "1");
  assert.equal(u.searchParams.get("include_matches"), "1");
  assert.equal(u.searchParams.has("api_key"), false);
  const withKey = new URL(apiUrl("abc123", "secret"));
  assert.equal(withKey.searchParams.get("api_key"), "secret");
});

const RAW = {
  tournament: {
    name: "Local Store Cup #4",
    full_challonge_url: "challonge.com/abc123",
    tournament_type: "single elimination",
    started_at: "2026-09-01T10:00:00.000-00:00",
    completed_at: "2026-09-01T15:00:00.000-00:00",
    participants: [
      { participant: { id: 1, display_name: "Bird", final_rank: 2, seed: 1 } },
      { participant: { id: 2, display_name: "Kai", final_rank: 1, seed: 2 } },
      { participant: { id: 3, display_name: "Rin", final_rank: 3, seed: 3 } },
    ],
    matches: [
      { match: { id: 10, round: 1, player1_id: 1, player2_id: 3, winner_id: 1, loser_id: 3, scores_csv: "4-1", state: "complete", completed_at: "2026-09-01T11:00:00.000-00:00" } },
      { match: { id: 11, round: 1, player1_id: 2, player2_id: null, winner_id: 2, loser_id: null, scores_csv: "", state: "complete", completed_at: "2026-09-01T11:00:00.000-00:00" } }, // bye
      { match: { id: 12, round: 2, player1_id: 1, player2_id: 2, winner_id: 2, loser_id: 1, scores_csv: "2-4", state: "complete", completed_at: "2026-09-01T14:00:00.000-00:00" } },
      { match: { id: 13, round: 2, player1_id: 3, player2_id: 2, winner_id: null, loser_id: null, scores_csv: "", state: "pending", completed_at: null } },
    ],
  },
};

test("normalizeTournament: shapes participants and matches", () => {
  const n = normalizeTournament(RAW);
  assert.equal(n.name, "Local Store Cup #4");
  assert.equal(n.url, "https://challonge.com/abc123");
  assert.equal(n.type, "single elimination");
  assert.equal(n.participants.length, 3);
  assert.equal(n.matches.length, 4);
  assert.deepEqual(n.participants[0], { id: 1, name: "Bird", finalRank: 2, seed: 1 });
});

test("matchResultsFor: only this player's complete matches, byes skipped, ordered by round", () => {
  const n = normalizeTournament(RAW);
  const results = matchResultsFor(n, 1);
  assert.equal(results.length, 2); // vs Rin (win), vs Kai (loss) — bye and pending excluded
  assert.deepEqual(results.map((r) => r.opponent), ["Rin", "Kai"]);
  assert.deepEqual(results.map((r) => r.result), ["W", "L"]);
  assert.equal(results[0].score, "4-1");
  assert.equal(results[0].date, "2026-09-01");
});

test("matchResultsFor: works for the other participant too", () => {
  const n = normalizeTournament(RAW);
  const results = matchResultsFor(n, 2);
  assert.deepEqual(results.map((r) => r.opponent), ["Bird"]); // bye vs no one skipped, pending excluded
  assert.deepEqual(results.map((r) => r.result), ["W"]);
});

test("buildImportPlan: tournament + match rows, wins/losses, placement, notes", () => {
  const n = normalizeTournament(RAW);
  const plan = buildImportPlan(n, 1);
  assert.equal(plan.tournament.name, "Local Store Cup #4");
  assert.equal(plan.tournament.placement, 2);
  assert.equal(plan.tournament.wins, 1);
  assert.equal(plan.tournament.losses, 1);
  assert.match(plan.tournament.notes, /Imported from Challonge: https:\/\/challonge\.com\/abc123/);
  assert.equal(plan.matches.length, 2);
  assert.deepEqual(plan.matches[0], {
    date: "2026-09-01", opponent: "Rin", myDeck: "", opponentDeck: "", games: [],
    result: "W", notes: "Challonge score: 4-1",
  });
});

test("buildImportPlan: unranked participant -> null placement", () => {
  const n = normalizeTournament(RAW);
  const plan = buildImportPlan(n, 999);
  assert.equal(plan.tournament.placement, null);
  assert.equal(plan.matches.length, 0);
});
