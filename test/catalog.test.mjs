// Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesPartQuery, queryCatalog, roleColor, slugify, applyPartStats } from "../js/catalog.js";

const PARTS = [
  { type: "Blade", name: "Dran Sword", system: "BX", role: "Attack", spin: "Right", note: "original attacker" },
  { type: "Blade", name: "Wizard Rod", system: "UX", role: "Stamina", spin: "Left", note: "life after death" },
  { type: "Ratchet", name: "3-60", system: "", role: "", spin: "", note: "attack standard" },
  { type: "Bit", name: "Ball", system: "", role: "Stamina", spin: "", note: "benchmark" },
];

test("matchesPartQuery: type filter", () => {
  assert.equal(matchesPartQuery(PARTS[0], { type: "Blade" }), true);
  assert.equal(matchesPartQuery(PARTS[0], { type: "Bit" }), false);
});

test("matchesPartQuery: role and system filters", () => {
  assert.equal(matchesPartQuery(PARTS[1], { role: "Stamina", system: "UX" }), true);
  assert.equal(matchesPartQuery(PARTS[1], { role: "Attack" }), false);
  assert.equal(matchesPartQuery(PARTS[1], { system: "BX" }), false);
});

test("matchesPartQuery: multi-word search hits name and note, order-independent", () => {
  assert.equal(matchesPartQuery(PARTS[0], { q: "dran" }), true);
  assert.equal(matchesPartQuery(PARTS[0], { q: "sword dran" }), true);
  assert.equal(matchesPartQuery(PARTS[0], { q: "original" }), true);
  assert.equal(matchesPartQuery(PARTS[0], { q: "stamina" }), false);
});

test("matchesPartQuery: empty filters match everything", () => {
  assert.equal(PARTS.every((p) => matchesPartQuery(p, {})), true);
});

test("queryCatalog: filters then sorts Blade -> Ratchet -> Bit, then name", () => {
  const out = queryCatalog(PARTS, {});
  assert.deepEqual(out.map((p) => p.name), ["Dran Sword", "Wizard Rod", "3-60", "Ball"]);
  const blades = queryCatalog(PARTS, { type: "Blade" });
  assert.deepEqual(blades.map((p) => p.name), ["Dran Sword", "Wizard Rod"]);
});

test("roleColor: known role, unknown role, custom map", () => {
  assert.equal(roleColor("Attack"), "#ff6a3d");
  assert.equal(roleColor("Nonsense"), "#8aa0bf");
  assert.equal(roleColor("Attack", { roleColors: { Attack: "#000000" } }), "#000000");
});

test("slugify: file-name-safe part slugs", () => {
  assert.equal(slugify("Dran Sword"), "dran-sword");
  assert.equal(slugify("3-60"), "3-60");
  assert.equal(slugify("M (Metal) variants"), "m-metal-variants");
  assert.equal(slugify("  Under  Flat  "), "under-flat");
  assert.equal(slugify(""), "");
});

test("applyPartStats: attaches numeric points/stats by type + name, ignoring case", () => {
  const parts = [
    { type: "Blade", name: "Dran Sword" },
    { type: "Bit", name: "Dran Sword" },
    { type: "Ratchet", name: "3-60" },
  ];
  applyPartStats(parts, {
    Blade: { "dran sword": { points: 4, atk: 60, def: null, sta: "x" } },
    Ratchet: { "3-60": { points: null, atk: null } },
  });
  assert.equal(parts[0].points, 4);
  assert.deepEqual(parts[0].stats, { atk: 60 });
  assert.equal(parts[1].points, null); // same name, different type
  assert.equal(parts[1].stats, null);
  assert.equal(parts[2].stats, null); // all null -> no stats
});

test("applyPartStats: tolerates a missing stats file", () => {
  const parts = [{ type: "Blade", name: "Dran Sword" }];
  applyPartStats(parts, null);
  assert.equal(parts[0].points, null);
  assert.equal(parts[0].stats, null);
});
