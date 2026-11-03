// Deck builder logic — formats, rule checks, stat/point totals, share links
// and the randomizer. Pure functions only (no DOM, no Firebase) so they're
// unit-tested in test/decks.test.mjs.
//
// A deck is { name, format, combos: [{ blade, ratchet, bit, mode? }] } —
// `mode` only matters for a blade with modes (e.g. Hells Nether Normal/Low).
// A CX build swaps the whole blade for its parts:
//   { cx: true, lockChip, mainBlade, overBlade?, assistBlade, ratchet, bit }
// and takes its blade role from the Main Blade.
// `lookup(type, name)` returns the catalog part ({ role, points, stats }) or
// null for a part that isn't in the catalog.

export const PART_KEYS = [["blade", "Blade"], ["ratchet", "Ratchet"], ["bit", "Bit"]];

// the blade parts of a CX build, in display order; the Over Blade is optional
export const CX_KEYS = [["lockChip", "Lock Chip"], ["mainBlade", "Main Blade"], ["overBlade", "Over Blade"], ["assistBlade", "Assist Blade"]];
export const CX_OPTIONAL = ["overBlade"];

/** True when the combo is a CX build (blade made from parts). */
export function isCx(combo) {
  return !!(combo && (combo.cx || CX_KEYS.some(([k]) => combo[k])));
}

/** The [key, type] slots a combo uses: a whole blade, or the CX blade parts. */
export function comboKeys(combo) {
  return isCx(combo) ? [...CX_KEYS, ["ratchet", "Ratchet"], ["bit", "Bit"]] : PART_KEYS;
}

/** [type, name] of the part that sets the combo's blade role. */
export function bladePart(combo) {
  return isCx(combo) ? ["Main Blade", combo.mainBlade || ""] : ["Blade", (combo && combo.blade) || ""];
}

/** A clean copy of a combo with only the fields its kind uses. */
export function cleanCombo(c, mode) {
  c = c || {};
  const s = (v) => String(v || "").trim();
  if (isCx(c)) {
    const out = { blade: "", ratchet: s(c.ratchet), bit: s(c.bit), cx: true };
    for (const [k] of CX_KEYS) out[k] = s(c[k]);
    return out;
  }
  const m = mode === undefined ? c.mode : mode;
  return { blade: s(c.blade), ratchet: s(c.ratchet), bit: s(c.bit), ...(m ? { mode: m } : {}) };
}

/** Is every required slot of the combo filled? */
export function comboComplete(c, lookup) {
  if (!c || !c.bit) return false;
  if (isCx(c)) return !!c.ratchet && CX_KEYS.every(([k]) => CX_OPTIONAL.includes(k) || c[k]);
  return !!(c.blade && (c.ratchet || ratchetIntegrated(c, lookup)));
}

export const STAT_KEYS = [
  ["atk", "Attack"],
  ["def", "Defense"],
  ["sta", "Stamina"],
  ["xd", "Xtreme Dash"],
  ["br", "Burst Res."],
];

// `roles` rules apply to blades and bits; ratchets have no role.
export const FORMATS = [
  { key: "standard", label: "Standard", desc: "No repeating parts across the deck." },
  { key: "limited", label: "Limited", desc: "No repeating parts, and the deck's total points must fit the budget.", limited: true },
  { key: "bad", label: "B.A.D", desc: "3 beys. The deck needs at least one Attack, one Defense and one Balance blade, and the same for bits.", size: 3, rule: "bad" },
  { key: "dab", label: "D.A.B", desc: "3 beys. Each combo pairs a blade and bit of the same type, and the deck covers Defense, Attack and Balance.", size: 3, rule: "dab" },
  { key: "bad-limited", label: "B.A.D Limited", desc: "B.A.D rules with a point budget.", size: 3, rule: "bad", limited: true },
  { key: "dab-limited", label: "D.A.B Limited", desc: "D.A.B rules with a point budget.", size: 3, rule: "dab", limited: true },
  { key: "all-attack", label: "All Attack", desc: "Every blade and bit must be Attack type.", rule: "all-attack" },
];

export const MIN_BEYS = 1;
export const MAX_BEYS = 5;
const BAD_ROLES = ["Attack", "Defense", "Balance"];

export function formatOf(key) {
  return FORMATS.find((f) => f.key === key) || FORMATS[0];
}

const norm = (s) => String(s || "").trim().toLowerCase();

/** True when the combo's blade has a built-in ratchet (no ratchet slot). */
export function ratchetIntegrated(combo, lookup) {
  return !!(combo && !isCx(combo) && combo.blade && lookup("Blade", combo.blade)?.ratchetIntegrated);
}

/** The blade's active mode: the combo's `mode` if valid, else the default (first); "" for no modes. */
export function comboMode(combo, lookup) {
  if (isCx(combo)) return "";
  const modes = (combo && combo.blade && lookup("Blade", combo.blade)?.modes) || [];
  if (!modes.length) return "";
  return modes.includes(combo.mode) ? combo.mode : modes[0];
}

/** Summed stats for one combo, or null when none of its parts has stats. */
export function comboStats(combo, lookup) {
  const out = Object.fromEntries(STAT_KEYS.map(([k]) => [k, 0]));
  let any = false;
  for (const [k, type] of comboKeys(combo)) {
    const part = combo && combo[k] ? lookup(type, combo[k]) : null;
    const mode = k === "blade" ? comboMode(combo, lookup) : "";
    const s = (mode && part?.modeStats?.[mode]) || part?.stats || null;
    if (!s) continue;
    for (const [sk] of STAT_KEYS) {
      if (typeof s[sk] === "number") { out[sk] += s[sk]; any = true; }
    }
  }
  return any ? out : null;
}

/** Total points for the deck; `missing` lists parts with no point value. */
export function deckPoints(combos, lookup) {
  let total = 0;
  const missing = [];
  for (const c of combos || []) {
    for (const [k, type] of comboKeys(c)) {
      if (!c || !c[k]) continue;
      const p = lookup(type, c[k])?.points;
      if (typeof p === "number") total += p;
      else missing.push(c[k]);
    }
  }
  return { total, missing };
}

/**
 * Check a deck against its format. Returns
 *   { ok, errors: [msg], warnings: [msg], dupes: Set("type|name"), points }
 * `errors` break the format; `warnings` are things we can't verify (a part
 * with no role or no point value). `budget` is the Limited point cap.
 */
export function validateDeck(deck, lookup, { budget = null } = {}) {
  const f = formatOf(deck.format);
  const combos = deck.combos || [];
  const errors = [];
  const warnings = [];

  if (f.size && combos.length !== f.size) errors.push(`${f.label} decks have exactly ${f.size} beys.`);
  const incomplete = combos.filter((c) => !comboComplete(c, lookup)).length;
  if (incomplete) errors.push(`${incomplete} bey${incomplete === 1 ? " is" : "s are"} missing a part.`);
  combos.forEach((c, i) => {
    if (c.ratchet && ratchetIntegrated(c, lookup)) {
      errors.push(`Bey ${i + 1}: ${c.blade} has a built-in ratchet — remove ${c.ratchet}.`);
    }
  });

  // no repeating parts — every format
  const seen = new Map();
  const dupes = new Set();
  for (const c of combos) {
    for (const [k, type] of comboKeys(c)) {
      if (!c[k]) continue;
      const key = type + "|" + norm(c[k]);
      if (seen.has(key)) dupes.add(key);
      seen.set(key, c[k]);
    }
  }
  if (dupes.size) {
    const names = [...dupes].map((d) => seen.get(d));
    errors.push(`Repeated part${names.length === 1 ? "" : "s"}: ${names.join(", ")}.`);
  }

  const roleOf = (type, name) => (name ? lookup(type, name)?.role || "" : "");
  const unknownRole = new Set();
  const noteUnknown = (type, name) => { if (name && !roleOf(type, name)) unknownRole.add(name); };

  // the blade role comes from the whole blade, or a CX build's Main Blade
  const bladeRole = (c) => roleOf(...bladePart(c));
  const bitPart = (c) => ["Bit", c.bit || ""];

  if (f.rule === "bad") {
    for (const [which, partOf] of [["blade", bladePart], ["bit", bitPart]]) {
      combos.forEach((c) => noteUnknown(...partOf(c)));
      const have = new Set(combos.map((c) => roleOf(...partOf(c))).filter(Boolean));
      const missing = BAD_ROLES.filter((r) => !have.has(r));
      if (missing.length) errors.push(`Needs ${missing.map((r) => `a${r === "Attack" ? "n" : ""} ${r}`).join(", ")} ${which}.`);
    }
  } else if (f.rule === "dab") {
    const pairRoles = [];
    combos.forEach((c, i) => {
      noteUnknown(...bladePart(c)); noteUnknown("Bit", c.bit);
      const b = bladeRole(c), t = roleOf("Bit", c.bit);
      if (b && t && b !== t) errors.push(`Bey ${i + 1}: ${b} blade with a ${t} bit — they must match.`);
      else if (b && t && !BAD_ROLES.includes(b)) errors.push(`Bey ${i + 1}: ${b} pairs aren't allowed — use Defense, Attack or Balance.`);
      if (b && b === t) pairRoles.push(b);
    });
    const missing = BAD_ROLES.filter((r) => !pairRoles.includes(r));
    if (combos.length === 3 && pairRoles.length === 3 && missing.length) {
      errors.push(`Needs one Defense, one Attack and one Balance pair (missing ${missing.join(", ")}).`);
    }
  } else if (f.rule === "all-attack") {
    combos.forEach((c, i) => {
      for (const [type, name] of [bladePart(c), bitPart(c)]) {
        noteUnknown(type, name);
        const r = roleOf(type, name);
        if (r && r !== "Attack") errors.push(`Bey ${i + 1}: ${name} is a ${r} ${type.toLowerCase()}, not Attack.`);
      }
    });
  }
  if (unknownRole.size) warnings.push(`Role not known for ${[...unknownRole].join(", ")}, so this can't be fully checked.`);

  const points = deckPoints(combos, lookup);
  if (f.limited) {
    if (budget == null) warnings.push("No point budget is set yet, so Limited can't be checked.");
    else if (points.total > budget) errors.push(`Over budget: ${points.total} of ${budget} points.`);
    if (points.missing.length) warnings.push(`No point value for ${points.missing.join(", ")}.`);
  }

  return { ok: errors.length === 0, errors, warnings, dupes, points };
}

// ---- share links ----------------------------------------------------------
// The deck goes in the URL as base64url(JSON) of a compact shape:
//   { n: name, f: format, c: [[blade, ratchet, bit, mode?], ...] }
// A CX build's row is ["", ratchet, bit, "", { l, m, o?, a }] (lock chip,
// main, over and assist blade), so older links still decode the same.

const MAX_NAME = 60;
const MAX_PART = 40;
const CX_SHORT = { lockChip: "l", mainBlade: "m", overBlade: "o", assistBlade: "a" };

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

export function encodeDeck(deck) {
  const compact = {
    n: String(deck.name || "").slice(0, MAX_NAME),
    f: formatOf(deck.format).key,
    c: (deck.combos || []).slice(0, MAX_BEYS).map((c) => {
      if (isCx(c)) {
        const parts = {};
        for (const [k] of CX_KEYS) if (c[k]) parts[CX_SHORT[k]] = c[k];
        return ["", c.ratchet || "", c.bit || "", "", parts];
      }
      return c.mode ? [c.blade || "", c.ratchet || "", c.bit || "", c.mode] : [c.blade || "", c.ratchet || "", c.bit || ""];
    }),
  };
  return b64urlEncode(JSON.stringify(compact));
}

/** Parse a share-link payload; returns null for anything malformed. */
export function decodeDeck(s) {
  try {
    const o = JSON.parse(b64urlDecode(String(s || "")));
    if (!o || !Array.isArray(o.c)) return null;
    const clip = (v, n) => String(v ?? "").trim().slice(0, n);
    const combos = o.c.slice(0, MAX_BEYS).map((row) => {
      const r = Array.isArray(row) ? row : [];
      const combo = { blade: clip(r[0], MAX_PART), ratchet: clip(r[1], MAX_PART), bit: clip(r[2], MAX_PART) };
      if (r[4] && typeof r[4] === "object") {
        combo.blade = "";
        combo.cx = true;
        for (const [k] of CX_KEYS) combo[k] = clip(r[4][CX_SHORT[k]], MAX_PART);
        return combo;
      }
      if (r[3]) combo.mode = clip(r[3], 20);
      return combo;
    });
    if (!combos.length) return null;
    return { name: clip(o.n, MAX_NAME), format: formatOf(o.f).key, combos };
  } catch {
    return null;
  }
}

// ---- randomizer -----------------------------------------------------------

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Fill the unlocked combos with random parts from `pool`
 * ({ Blade: [part], Ratchet: [part], Bit: [part], "Main Blade": [part], ... }),
 * honouring the format. A CX-build slot stays a CX build when the pool has
 * the parts for one (Over Blade added half the time), else gets a whole blade:
 * no repeats, the role rules, and the budget when one is set. `locked[i]`
 * keeps combo i as-is. Tries a few hundred times; returns null if the pool
 * can't satisfy the format.
 */
export function randomizeDeck(deck, pool, { locked = [], budget = null, rng = Math.random, tries = 400 } = {}) {
  const f = formatOf(deck.format);
  const size = f.size || Math.max(MIN_BEYS, Math.min(MAX_BEYS, (deck.combos || []).length || 3));
  const base = Array.from({ length: size }, (_, i) => ({ ...(deck.combos?.[i] || {}) }));
  const lookup = (type, name) => (pool[type] || []).find((p) => norm(p.name) === norm(name)) || null;

  for (let t = 0; t < tries; t++) {
    const used = {};
    const usedOf = (type) => (used[type] ||= new Set());
    base.forEach((c, i) => {
      if (!locked[i]) return;
      for (const [k, type] of comboKeys(c)) if (c[k]) usedOf(type).add(norm(c[k]));
    });

    // roles each unlocked slot must take, for the role-based formats
    const free = base.map((_, i) => i).filter((i) => !locked[i]);
    const slotRole = {};
    if (f.rule === "dab" || f.rule === "bad") {
      const taken = base.filter((_, i) => locked[i]).map((c) => lookup(...bladePart(c))?.role);
      const need = shuffle(BAD_ROLES.filter((r) => !taken.includes(r)), rng);
      free.forEach((i, n) => { if (need[n]) slotRole[i] = need[n]; });
    }

    const out = base.map((c, i) => {
      if (locked[i]) return c;
      const role = slotRole[i];
      // `roled`: this part's role counts for the format (blade / main blade / bit)
      const choose = (type, wantRole, roled = true) => {
        let opts = (pool[type] || []).filter((p) => !usedOf(type).has(norm(p.name)));
        if (roled && f.rule === "all-attack") opts = opts.filter((p) => p.role === "Attack");
        else if (roled && wantRole) opts = opts.filter((p) => p.role === wantRole);
        if (!opts.length) return null;
        const p = pick(opts, rng);
        usedOf(type).add(norm(p.name));
        return p.name;
      };
      const canCx = CX_KEYS.every(([k, type]) => CX_OPTIONAL.includes(k) || (pool[type] || []).length);
      if (isCx(c) && canCx) {
        const lockChip = choose("Lock Chip", null, false) || "";
        const mainBlade = choose("Main Blade", role) || "";
        const overBlade = (pool["Over Blade"] || []).length && rng() < 0.5 ? choose("Over Blade", null, false) || "" : "";
        const assistBlade = choose("Assist Blade", null, false) || "";
        return { blade: "", ratchet: choose("Ratchet", null, false) || "", bit: choose("Bit", role) || "",
          cx: true, lockChip, mainBlade, overBlade, assistBlade };
      }
      const blade = choose("Blade", role);
      const ratchet = blade && lookup("Blade", blade)?.ratchetIntegrated ? "" : choose("Ratchet", null, false);
      const bit = choose("Bit", role);
      const modes = (blade && lookup("Blade", blade)?.modes) || [];
      const out = { blade: blade || "", ratchet: ratchet || "", bit: bit || "" };
      if (modes.length > 1) out.mode = pick(modes, rng);
      return out;
    });

    const candidate = { ...deck, combos: out };
    if (validateDeck(candidate, lookup, { budget }).ok) return candidate;
  }
  return null;
}
