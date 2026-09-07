// Run: node --test  (or: node test/stats.test.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  finishPts, matchScore, matchResult, ordinal, groupRecord, streaks, achievements,
  comboKey, consensus,
} from "../js/stats.js";

const G = (winner, finish) => ({ winner, finish });

test("finishPts", () => {
  assert.equal(finishPts("Spin"), 1);
  assert.equal(finishPts("Burst"), 2);
  assert.equal(finishPts("Xtreme"), 3);
  assert.equal(finishPts("nope"), 0);
});

test("matchScore sums game points per side", () => {
  const m = { games: [G("me", "Xtreme"), G("opp", "Spin"), G("me", "Burst")] };
  assert.deepEqual(matchScore(m), { mine: 5, opp: 1 });
});

test("matchResult: manual result wins over games", () => {
  assert.equal(matchResult({ result: "L", games: [G("me", "Xtreme")] }), "L");
});

test("matchResult: derived from game points", () => {
  assert.equal(matchResult({ games: [G("me", "Xtreme")] }), "W");
  assert.equal(matchResult({ games: [G("opp", "Xtreme"), G("me", "Spin")] }), "L");
});

test("matchResult: tie is a dash", () => {
  assert.equal(matchResult({ games: [G("me", "Spin"), G("opp", "Spin")] }), "—");
  assert.equal(matchResult({ games: [] }), "—");
});

test("ordinal", () => {
  assert.equal(ordinal(1), "1st");
  assert.equal(ordinal(2), "2nd");
  assert.equal(ordinal(3), "3rd");
  assert.equal(ordinal(4), "4th");
  assert.equal(ordinal(11), "11th");
  assert.equal(ordinal(21), "21st");
  assert.equal(ordinal(112), "112th");
});

test("groupRecord tallies W-L and sorts by games", () => {
  const matches = [
    { result: "W", opponent: "Rin" },
    { result: "L", opponent: "Rin" },
    { result: "W", opponent: "Rin" },
    { result: "L", opponent: "Kai" },
  ];
  const rows = groupRecord(matches, (m) => m.opponent);
  assert.equal(rows[0].name, "Rin");
  assert.deepEqual({ w: rows[0].w, l: rows[0].l }, { w: 2, l: 1 });
  assert.equal(rows[1].name, "Kai");
});

test("groupRecord skips empty keys", () => {
  const rows = groupRecord([{ result: "W", d: "" }, { result: "W", d: "A" }], (m) => m.d);
  assert.equal(rows.length, 1);
});

test("streaks: current win streak + longest", () => {
  const chron = [
    { result: "L" }, { result: "W" }, { result: "W" }, { result: "W" },
    { result: "L" }, { result: "W" }, { result: "W" },
  ];
  const s = streaks(chron);
  assert.equal(s.current, 2);
  assert.equal(s.type, "win");
  assert.equal(s.longestWin, 3);
});

test("streaks: current loss streak", () => {
  const s = streaks([{ result: "W" }, { result: "L" }, { result: "L" }]);
  assert.equal(s.current, 2);
  assert.equal(s.type, "loss");
});

test("streaks: unrated matches don't break the run", () => {
  const s = streaks([{ result: "W" }, { games: [] }, { result: "W" }]);
  assert.equal(s.current, 2);
  assert.equal(s.type, "win");
});

test("achievements: empty state has nothing earned", () => {
  const all = achievements({});
  assert.ok(all.length >= 15);
  assert.equal(all.filter((a) => a.done).length, 0);
  assert.ok(all.find((a) => a.id === "first-match").progress);
});

test("achievements: milestones + streak + finishes unlock", () => {
  const matches = [];
  for (let i = 0; i < 12; i++) matches.push({ result: "W", games: [{ winner: "me", finish: "Xtreme" }] });
  const a = achievements({
    matches,
    tournaments: [{ placement: 1 }],
    beys: Array(15).fill({}),
    decks: [{}, {}, {}],
    friendsCount: 2,
    hasTeam: true,
  });
  const done = new Set(a.filter((x) => x.done).map((x) => x.id));
  for (const id of ["first-match", "ten-matches", "first-tournament", "win-tournament", "podium",
    "streak5", "streak10", "xtreme1", "collector", "deck1", "deck3", "friend", "team"]) {
    assert.ok(done.has(id), `expected ${id} unlocked`);
  }
  assert.ok(!done.has("hundred"));
});

test("achievements: full-kit needs all four finish types", () => {
  const games = ["Spin", "Over", "Burst", "Xtreme"].map((f) => ({ winner: "me", finish: f }));
  const a = achievements({ matches: [{ result: "W", games }] });
  assert.ok(a.find((x) => x.id === "all-finishes").done);
});

test("comboKey is stable and normalised", () => {
  assert.equal(comboKey("Dran Buster", "3-60", "Flat"), comboKey(" dran buster ", "3-60", "flat"));
  assert.equal(comboKey("Wizard Rod", "5-70", "Point"), "wizard-rod__5-70__point");
});

test("consensus: empty tally has no letter", () => {
  const c = consensus({}, 0);
  assert.equal(c.letter, null);
  assert.equal(c.count, 0);
});

test("consensus: maps average score to a letter", () => {
  assert.equal(consensus({ S: 3 }, 3).letter, "S");
  assert.equal(consensus({ A: 2, B: 2 }, 4).letter, "A"); // avg 3.5
  assert.equal(consensus({ S: 1, D: 1 }, 2).letter, "B"); // avg 3.0
  assert.equal(consensus({ D: 5 }, 5).letter, "D");
  assert.equal(consensus({ S: 1, A: 1, B: 1 }, 3).count, 3);
});
