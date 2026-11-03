// Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FORMATS, formatOf, validateDeck, comboStats, deckPoints,
  encodeDeck, decodeDeck, randomizeDeck, ratchetIntegrated, comboMode,
  isCx, isMetal, comboKeys, cleanCombo, comboComplete,
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
    { name: "Hells Nether", role: "Balance", ratchetIntegrated: true, modes: ["Normal", "Low"],
      stats: { atk: 50, def: 50, sta: 30 },
      modeStats: { Normal: { atk: 50, def: 50, sta: 30 }, Low: { atk: 70, def: 45, sta: 15 } } },
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
  "Lock Chip": [{ name: "Dran", points: 1 }, { name: "Pegasus", points: 1 }, { name: "Knight", points: 1 }],
  "Main Blade": [
    { name: "Brave", role: "Attack", points: 3, stats: { atk: 40, def: 10 } },
    { name: "Arc", role: "Defense", points: 2 },
    { name: "Wheel", role: "Balance", points: 2 },
  ],
  "Over Blade": [{ name: "Break", points: 1, stats: { atk: 5 } }],
  "Metal Blade": [{ name: "Blitz", role: "Attack", points: 4, stats: { atk: 60 } }, { name: "Fortress", role: "Defense", points: 3 }],
  "Assist Blade": [{ name: "Slash", points: 1, stats: { atk: 5, def: 5 } }, { name: "Round", points: 1 }, { name: "Heavy", points: 1 }],
};
const cx = (lockChip, mainBlade, assistBlade, ratchet, bit, overBlade = "") =>
  ({ blade: "", ratchet, bit, cx: true, lockChip, mainBlade, overBlade, assistBlade });
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

test("blade modes: default mode, per-mode stats, unknown mode falls back", () => {
  const c = { blade: "Hells Nether", ratchet: "", bit: "Flat" };
  assert.equal(comboMode(c, lookup), "Normal");
  assert.equal(comboMode({ ...c, mode: "Low" }, lookup), "Low");
  assert.equal(comboMode({ ...c, mode: "Turbo" }, lookup), "Normal");
  assert.equal(comboMode({ blade: "Dran Sword" }, lookup), "");
  assert.deepEqual(comboStats(c, lookup), { atk: 80, def: 50, sta: 30, xd: 40, br: 0 });
  assert.deepEqual(comboStats({ ...c, mode: "Low" }, lookup), { atk: 100, def: 45, sta: 15, xd: 40, br: 0 });
});

test("share links keep the blade mode, and old links without one still decode", () => {
  const d = { name: "m", format: "standard", combos: [{ blade: "Hells Nether", ratchet: "", bit: "Flat", mode: "Low" }, { blade: "Dran Sword", ratchet: "3-60", bit: "Rush" }] };
  const back = decodeDeck(encodeDeck(d));
  assert.equal(back.combos[0].mode, "Low");
  assert.equal("mode" in back.combos[1], false);
});

test("randomizeDeck picks a mode for a blade with modes", () => {
  const pool = { ...PARTS, Blade: [PARTS.Blade.find((b) => b.modes)] };
  const seen = new Set();
  for (let i = 1; i < 30; i++) seen.add(randomizeDeck({ format: "standard", combos: [{}] }, pool, { rng: seeded(i) }).combos[0].mode);
  assert.deepEqual([...seen].sort(), ["Low", "Normal"]);
});

// ---- CX builds (Lock Chip + Main Blade + optional Over Blade + Assist Blade)

test("isCx / comboKeys: a CX build uses the blade-part slots", () => {
  assert.equal(isCx({ blade: "Dran Sword" }), false);
  assert.equal(isCx({ cx: true }), true);
  assert.equal(isCx({ mainBlade: "Brave" }), true);
  assert.deepEqual(comboKeys({ cx: true }).map(([k]) => k), ["lockChip", "mainBlade", "overBlade", "assistBlade", "ratchet", "bit"]);
  assert.deepEqual(comboKeys({ blade: "x" }).map(([k]) => k), ["blade", "ratchet", "bit"]);
});

test("CX build: complete without an Over Blade, incomplete without an Assist Blade", () => {
  assert.equal(comboComplete(cx("Dran", "Brave", "Slash", "3-60", "Flat"), lookup), true);
  assert.equal(comboComplete(cx("Dran", "Brave", "", "3-60", "Flat"), lookup), false);
  const d = { name: "t", format: "standard", combos: [cx("Dran", "Brave", "", "3-60", "Flat")] };
  assert.match(validateDeck(d, lookup).errors.join(" "), /missing a part/);
});

test("CX build: stats and points add every part, Over Blade included", () => {
  const c = cx("Dran", "Brave", "Slash", "3-60", "Flat", "Break");
  assert.deepEqual(comboStats(c, lookup), { atk: 40 + 5 + 5 + 30, def: 10 + 5 + 5, sta: 0, xd: 40, br: 0 });
  assert.equal(deckPoints([c], lookup).total, 1 + 3 + 1 + 1 + 2 + 3);
});

test("CX build: the Main Blade sets the blade role for B.A.D / D.A.B / All Attack", () => {
  const dab = { name: "t", format: "dab", combos: [
    cx("Dran", "Brave", "Slash", "3-60", "Flat"),
    cx("Knight", "Arc", "Round", "4-60", "Needle"),
    { blade: "Hells Scythe", ratchet: "5-60", bit: "Orb" },
  ] };
  assert.equal(validateDeck(dab, lookup).ok, true);
  const aa = { name: "t", format: "all-attack", combos: [cx("Dran", "Arc", "Slash", "3-60", "Flat")] };
  assert.match(validateDeck(aa, lookup).errors.join(" "), /Arc is a Defense main blade/);
});

test("CX build: repeated lock chips / main blades across the deck are flagged", () => {
  const d = { name: "t", format: "standard", combos: [
    cx("Dran", "Brave", "Slash", "3-60", "Flat"),
    cx("Dran", "Arc", "Round", "4-60", "Needle"),
  ] };
  const r = validateDeck(d, lookup);
  assert.ok(r.dupes.has("Lock Chip|dran"));
  assert.match(r.errors.join(" "), /Repeated part: Dran/);
});

test("CX build: no blade mode or built-in ratchet", () => {
  const c = { ...cx("Dran", "Brave", "Slash", "", "Flat"), blade: "Hells Nether", mode: "Low" };
  assert.equal(ratchetIntegrated(c, lookup), false);
  assert.equal(comboMode(c, lookup), "");
});

test("cleanCombo keeps only the fields the combo's kind uses", () => {
  assert.deepEqual(cleanCombo({ blade: " Dran Sword ", ratchet: "3-60", bit: "Flat", lockChip: "" }),
    { blade: "Dran Sword", ratchet: "3-60", bit: "Flat" });
  assert.deepEqual(cleanCombo({ blade: "Old", mode: "Low", cx: true, mainBlade: "Brave", ratchet: "3-60", bit: "Flat" }),
    { blade: "", ratchet: "3-60", bit: "Flat", cx: true, lockChip: "", mainBlade: "Brave", overBlade: "", assistBlade: "" });
});

test("share links round-trip CX builds next to whole blades", () => {
  const d = { name: "mix", format: "standard", combos: [
    cx("Dran", "Brave", "Slash", "3-60", "Flat", "Break"),
    { blade: "Knight Shield", ratchet: "4-60", bit: "Needle" },
  ] };
  assert.deepEqual(decodeDeck(encodeDeck(d)), d);
});

test("randomizeDeck keeps a CX slot a CX build when the pool has the parts", () => {
  const d = randomizeDeck({ name: "", format: "bad", combos: [{ cx: true }, {}, { cx: true }] }, PARTS, { rng: seeded(3) });
  assert.ok(d);
  assert.equal(isCx(d.combos[0]), true);
  assert.equal(isCx(d.combos[1]), false);
  assert.ok(d.combos[0].lockChip && d.combos[0].mainBlade && d.combos[0].assistBlade);
  assert.equal(validateDeck(d, lookup).ok, true);
  // no CX parts in the pool: falls back to a whole blade
  const noCx = randomizeDeck({ name: "", format: "standard", combos: [{ cx: true }] },
    { Blade: PARTS.Blade, Ratchet: PARTS.Ratchet, Bit: PARTS.Bit }, { rng: seeded(3) });
  assert.equal(isCx(noCx.combos[0]), false);
});

// ---- Metal Blade builds (Lock Chip + Metal Blade + Over Blade? + Assist Blade)
const metal = (lockChip, metalBlade, assistBlade, ratchet, bit, overBlade = "") =>
  ({ blade: "", ratchet, bit, cx: true, metal: true, lockChip, metalBlade, overBlade, assistBlade });

test("Metal Blade build: the Metal Blade takes the Main Blade's slot and role", () => {
  const c = metal("Bahamut", "Blitz", "Slash", "3-60", "Flat");
  assert.equal(isMetal(c), true);
  assert.deepEqual(comboKeys(c).map(([k]) => k), ["lockChip", "metalBlade", "overBlade", "assistBlade", "ratchet", "bit"]);
  assert.equal(comboComplete(c, lookup), true);
  assert.equal(comboComplete({ ...c, assistBlade: "" }, lookup), false);
  assert.deepEqual(comboStats(c, lookup), { atk: 60 + 5 + 30, def: 5 + 5, sta: 0, xd: 40, br: 0 });
  const aa = { name: "t", format: "all-attack", combos: [metal("Dran", "Fortress", "Slash", "3-60", "Flat")] };
  assert.match(validateDeck(aa, lookup).errors.join(" "), /Fortress is a Defense metal blade/);
});

test("Metal Blade build: share links and cleanCombo keep it a Metal build, even when empty", () => {
  const d = { name: "m", format: "standard", combos: [metal("Bahamut", "Blitz", "Slash", "3-60", "Flat", "Break"), metal("", "", "", "", "")] };
  assert.deepEqual(decodeDeck(encodeDeck(d)), d);
  assert.deepEqual(cleanCombo({ cx: true, metal: true, mainBlade: "stale", metalBlade: "Blitz" }),
    { blade: "", ratchet: "", bit: "", cx: true, metal: true, lockChip: "", metalBlade: "Blitz", overBlade: "", assistBlade: "" });
});

test("randomizeDeck keeps a Metal Blade slot a Metal build", () => {
  const d = randomizeDeck({ name: "", format: "standard", combos: [{ cx: true, metal: true }, { cx: true }] }, PARTS, { rng: seeded(5) });
  assert.ok(d);
  assert.equal(isMetal(d.combos[0]), true);
  assert.ok(d.combos[0].metalBlade && !d.combos[0].mainBlade);
  assert.equal(isMetal(d.combos[1]), false);
  assert.ok(d.combos[1].mainBlade);
});
