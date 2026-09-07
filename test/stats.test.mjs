// Run: node --test  (or: node test/stats.test.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  finishPts, matchScore, matchResult, ordinal, groupRecord, streaks,
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
