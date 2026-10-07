// Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FORMATS, formatOf, validateDeck, comboStats, deckPoints,
  encodeDeck, decodeDeck, randomizeDeck, ratchetIntegrated,
} from "../js/decks.js";

const PARTS = {
  Blade: [
    { name: "Dran Sword", role: "Attack", points: 4, stats: { atk: 50, def: 20 } },
    { name: "Knight Shield", role: "Defense", points: 3, stats: { atk: 10, def: 60 } },
    { name: "Hells Scythe", role: "Balance", points: 3 },
    { name: "Wizard Rod", role: "Stamina", points: 5 },
    { name: "Shark Edge", role: "Attack", points: 2 },
    { name: "Mystery", role: "" },
    { name: "Glory Valkyrie", role: "Attack", points: 4, ratchetIntegrated: true },
  ],
  Ratchet: [
    { name: "3-60", points: 2, stats: { def: 5 } },
    { name: "4-60", points: 1 },
    { name: "5-60", points: 1 },
    { name: "9-60", points: 3 },
  ],
  Bit: [
    { name: "Flat", role: "Attack", points: 3, stats: { atk: 30, xd: 40 } },
    { name: "Needle", role: "Defense", points: 1 },
    { name: "Orb", role: "Balance", points: 2 },
    { name: "Ball", role: "Stamina", points: 2 },
    { name: "Rush", role: "Attack", points: 2 },
  ],
};
const lookup = (type, name) => PARTS[type].find((p) => p.name.toLowerCase() === String(name).toLowerCase()) || null;
const deck = (format, ...rows) => ({ name: "t", format, combos: rows.map(([blade, ratchet, bit]) => ({ blade, ratchet, bit })) });

test("formatOf falls back to Standard for unknown keys", () => {
  assert.equal(formatOf("nope").key, "standard");
  assert.equal(formatOf("dab").label, "D.A.B");
  assert.ok(FORMATS.every((f) => f.key && f.label && f.desc));
});

test("Standard: a clean deck passes", () => {
  const r = validateDeck(deck("standard", ["Dran Sword", "3-60", "Flat"], ["Knight Shield", "4-60", "Needle"]), lookup);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test("Standard: repeated parts are flagged case-insensitively", () => {
  const r = validateDeck(deck("standard", ["Dran Sword", "3-60", "Flat"], ["dran sword", "4-60", "Rush"]), lookup);
  assert.equal(r.ok, false);
  assert.ok(r.dupes.has("Blade|dran sword"));
  assert.match(r.errors.join(" "), /Repeated part/);
});

test("missing parts are an error", () => {
  const r = validateDeck(deck("standard", ["Dran Sword", "", "Flat"]), lookup);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /missing a part/);
});

test("B.A.D: needs Attack, Defense and Balance among blades and bits", () => {
  const good = deck("bad", ["Dran Sword", "3-60", "Needle"], ["Knight Shield", "4-60", "Orb"], ["Hells Scythe", "5-60", "Flat"]);
  assert.equal(validateDeck(good, lookup).ok, true);
  const bad = deck("bad", ["Dran Sword", "3-60", "Flat"], ["Shark Edge", "4-60", "Rush"], ["Knight Shield", "5-60", "Needle"]);
  const r = validateDeck(bad, lookup);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /Balance blade/);
  assert.match(r.errors.join(" "), /Balance bit/);
});

test("B.A.D / D.A.B require exactly 3 beys", () => {
  const r = validateDeck(deck("dab", ["Dran Sword", "3-60", "Flat"]), lookup);
  assert.match(r.errors.join(" "), /exactly 3/);
});

test("D.A.B: each pair must match and cover D, A, B", () => {
  const good = deck("dab", ["Dran Sword", "3-60", "Flat"], ["Knight Shield", "4-60", "Needle"], ["Hells Scythe", "5-60", "Orb"]);
  assert.equal(validateDeck(good, lookup).ok, true);
  const mismatch = deck("dab", ["Dran Sword", "3-60", "Needle"], ["Knight Shield", "4-60", "Flat"], ["Hells Scythe", "5-60", "Orb"]);
  assert.match(validateDeck(mismatch, lookup).errors.join(" "), /must match/);
  const twoAttack = deck("dab", ["Dran Sword", "3-60", "Flat"], ["Shark Edge", "4-60", "Rush"], ["Hells Scythe", "5-60", "Orb"]);
  assert.match(validateDeck(twoAttack, lookup).errors.join(" "), /missing Defense/);
});

test("All Attack: non-Attack blades or bits fail; unknown roles only warn", () => {
  const r = validateDeck(deck("all-attack", ["Dran Sword", "3-60", "Ball"]), lookup);
  assert.match(r.errors.join(" "), /Ball is a Stamina bit/);
  const u = validateDeck(deck("all-attack", ["Mystery", "3-60", "Flat"]), lookup);
  assert.equal(u.ok, true);
  assert.match(u.warnings.join(" "), /Role not known for Mystery/);
});

test("Limited: totals points against the budget", () => {
  const d = deck("limited", ["Dran Sword", "3-60", "Flat"], ["Knight Shield", "4-60", "Needle"]);
  assert.equal(deckPoints(d.combos, lookup).total, 4 + 2 + 3 + 3 + 1 + 1);
  assert.equal(validateDeck(d, lookup, { budget: 14 }).ok, true);
  assert.match(validateDeck(d, lookup, { budget: 10 }).errors.join(" "), /Over budget: 14 of 10/);
  assert.match(validateDeck(d, lookup).warnings.join(" "), /No point budget/);
});

test("Limited: parts without a point value are listed", () => {
  const r = validateDeck(deck("limited", ["Mystery", "3-60", "Flat"]), lookup, { budget: 99 });
  assert.match(r.warnings.join(" "), /No point value for Mystery/);
});

test("comboStats sums the parts that have stats, null when none do", () => {
  assert.deepEqual(comboStats({ blade: "Dran Sword", ratchet: "3-60", bit: "Flat" }, lookup),
    { atk: 80, def: 25, sta: 0, xd: 40, br: 0 });
  assert.equal(comboStats({ blade: "Hells Scythe", ratchet: "4-60", bit: "Orb" }, lookup), null);
});

test("share links round-trip, including non-ASCII names", () => {
  const d = deck("dab", ["Dran Sword", "3-60", "Flat"], ["Knight Shield", "4-60", "Needle"], ["Hells Scythe", "5-60", "Orb"]);
  d.name = "Ñiño's deck ★";
  const s = encodeDeck(d);
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeDeck(s), { name: d.name, format: "dab", combos: d.combos });
});

test("decodeDeck rejects junk and clips oversized input", () => {
  assert.equal(decodeDeck("not-base64!!"), null);
  assert.equal(decodeDeck(""), null);
  const huge = encodeDeck({ name: "x".repeat(500), format: "bogus", combos: Array(9).fill({ blade: "y".repeat(500), ratchet: "", bit: "" }) });
  const d = decodeDeck(huge);
  assert.equal(d.format, "standard");
  assert.ok(d.name.length <= 60);
  assert.ok(d.combos.length <= 5);
  assert.ok(d.combos[0].blade.length <= 40);
});

// deterministic rng for the randomizer
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test("randomizeDeck honours each format", () => {
  for (const format of ["standard", "bad", "dab", "all-attack", "limited"]) {
    const size = format === "all-attack" ? 2 : 3;
    const d = randomizeDeck({ name: "", format, combos: Array(size).fill({}) }, PARTS, { rng: seeded(7), budget: 30 });
    assert.ok(d, `no deck for ${format}`);
    assert.equal(validateDeck(d, lookup, { budget: 30 }).ok, true, format);
  }
});

test("randomizeDeck keeps locked combos and returns null when impossible", () => {
  const start = deck("standard", ["Dran Sword", "3-60", "Flat"], ["", "", ""]);
  const d = randomizeDeck(start, PARTS, { locked: [true, false], rng: seeded(3) });
  assert.deepEqual(d.combos[0], start.combos[0]);
  assert.notEqual(d.combos[1].blade, "Dran Sword");
  // only two Attack bits exist, so three All Attack beys can't be built
  assert.equal(randomizeDeck({ format: "all-attack", combos: [{}, {}, {}] }, PARTS, { rng: seeded(1), tries: 50 }), null);
});

test("ratchet-integrated blades need no ratchet, and can't take one", () => {
  assert.equal(ratchetIntegrated({ blade: "glory valkyrie" }, lookup), true);
  assert.equal(ratchetIntegrated({ blade: "Dran Sword" }, lookup), false);
  const ok = validateDeck(deck("standard", ["Glory Valkyrie", "", "Flat"], ["Knight Shield", "4-60", "Needle"]), lookup);
  assert.equal(ok.ok, true, ok.errors.join(" "));
  const extra = validateDeck(deck("standard", ["Glory Valkyrie", "3-60", "Flat"]), lookup);
  assert.match(extra.errors.join(" "), /Glory Valkyrie has a built-in ratchet — remove 3-60/);
  // a normal blade still needs its ratchet
  assert.match(validateDeck(deck("standard", ["Dran Sword", "", "Flat"]), lookup).errors.join(" "), /missing a part/);
});

test("randomizeDeck leaves the ratchet empty for a ratchet-integrated blade", () => {
  const pool = { ...PARTS, Blade: [PARTS.Blade.find((b) => b.ratchetIntegrated)] };
  const d = randomizeDeck({ format: "standard", combos: [{}] }, pool, { rng: seeded(5) });
  assert.equal(d.combos[0].blade, "Glory Valkyrie");
  assert.equal(d.combos[0].ratchet, "");
});
