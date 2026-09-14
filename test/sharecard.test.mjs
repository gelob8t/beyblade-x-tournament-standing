// Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCardData, shareText } from "../js/sharecard.js";

const G = (winner) => ({ winner, finish: "Spin" });

const MATCHES = [
  { date: "2026-01-01", myDeck: "Sword Rush", result: "W", games: [G("me"), G("me")] },
  { date: "2026-01-05", myDeck: "Sword Rush", result: "W", games: [G("me"), G("opp")] },
  { date: "2026-01-10", myDeck: "Sword Rush", result: "L", games: [G("opp"), G("opp")] },
  { date: "2026-01-15", myDeck: "Shield Wall", result: "L" },
  { date: "2026-01-20", games: [] }, // unrated ("—", tied 0-0) — excluded from played
];

const TOURNAMENTS = [{ placement: 3 }, { placement: 1 }, { placement: null }];
const ACHV = [{ id: "a", done: true }, { id: "b", done: true }, { id: "c", done: false }];

test("buildCardData: match + game records, best placement, top deck, streak, achievements", () => {
  const d = buildCardData({ matches: MATCHES, tournaments: TOURNAMENTS, achv: ACHV, profile: { bladerName: "Bird", region: "Cebu" }, team: null });
  assert.equal(d.name, "Bird");
  assert.equal(d.region, "Cebu");
  assert.equal(d.matches.played, 4); // the games:[] match is unrated, excluded
  assert.equal(d.matches.wins, 2);
  assert.equal(d.matches.losses, 2);
  assert.equal(d.matches.rate, 0.5);
  assert.equal(d.games.w, 3);
  assert.equal(d.games.l, 3);
  assert.equal(d.bestPlacement, 1);
  assert.equal(d.tournaments, 3);
  assert.deepEqual(d.topDeck, { name: "Sword Rush", w: 2, l: 1 });
  assert.equal(d.achv.done, 2);
  assert.equal(d.achv.total, 3);
});

test("buildCardData: decksCount reflects the decks list, independent of match history", () => {
  const d = buildCardData({ matches: MATCHES, decks: [{ name: "Sword Rush" }, { name: "Shield Wall" }, { name: "Bench" }] });
  assert.equal(d.decksCount, 3);
  assert.equal(buildCardData({}).decksCount, 0);
});

test("buildCardData: streak reflects the most recent run", () => {
  const d = buildCardData({ matches: MATCHES });
  // chronological results: W, W, L, L -> current streak is 2 losses
  assert.deepEqual(d.streak, { current: 2, type: "loss" });
});

test("buildCardData: team tag, no matches, no team", () => {
  const d = buildCardData({ team: { tag: "AFH", name: "Ashfall Hunters" } });
  assert.deepEqual(d.team, { tag: "AFH", name: "Ashfall Hunters" });
  assert.equal(d.matches.played, 0);
  assert.equal(d.matches.rate, 0);
  assert.equal(d.games.rate, 0);
  assert.equal(d.bestPlacement, null);
  assert.equal(d.topDeck, null);
  assert.equal(d.streak, null);

  const d2 = buildCardData({});
  assert.equal(d2.team, null);
  assert.equal(d2.name, "Blader");
});

test("buildCardData: 'Unspecified' deck (matches with no myDeck) never becomes the top deck", () => {
  const noDeckMatches = [{ date: "2026-01-01", result: "W" }, { date: "2026-01-02", result: "W" }];
  const d = buildCardData({ matches: noDeckMatches });
  assert.equal(d.topDeck, null);
});

test("shareText: includes win rate, best finish and a notable streak", () => {
  const d = buildCardData({ matches: MATCHES, tournaments: TOURNAMENTS });
  const t = shareText(d);
  assert.match(t, /50% match win rate \(2-2\)/);
  assert.match(t, /best finish: 1st/);
});

test("shareText: omits streak mention below 3 in a row", () => {
  const d = buildCardData({ matches: MATCHES }); // current streak is only 2
  assert.doesNotMatch(shareText(d), /streak/);
});
