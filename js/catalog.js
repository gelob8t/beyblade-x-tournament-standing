// Beyblade X parts catalog — a static, community-maintained list in
// data/parts.json.  Used by the Collection "Browse catalog" picker and to
// feed name autocomplete.  No Firebase here: just a cached fetch + pure
// filtering helpers (so the filter can be unit-tested).

const ROLE_COLORS = {
  Attack: "#ff6a3d",
  Stamina: "#37c6e8",
  Defense: "#ffc93e",
  Balance: "#a98bff",
};

let cache = null;

/** Load and normalise data/parts.json.  Returns a flat `parts` array too. */
export async function loadCatalog() {
  if (cache) return cache;
  const res = await fetch("./data/parts.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("Couldn't load the parts catalog.");
  const raw = await res.json();
  const tag = (list, type) =>
    (Array.isArray(list) ? list : []).map((p) => ({
      type,
      name: String(p.name || "").trim(),
      system: p.system || "",
      role: p.role || "",
      spin: p.spin || "",
      height: p.height ?? null,
      peaks: p.peaks ?? null,
      note: p.note || "",
      image: p.image || "",
    })).filter((p) => p.name);
  const parts = [
    ...tag(raw.blades, "Blade"),
    ...tag(raw.ratchets, "Ratchet"),
    ...tag(raw.bits, "Bit"),
  ];
  cache = {
    updated: raw.updated || "",
    note: raw.note || "",
    roleColors: { ...ROLE_COLORS, ...(raw.roleColors || {}) },
    blades: parts.filter((p) => p.type === "Blade"),
    ratchets: parts.filter((p) => p.type === "Ratchet"),
    bits: parts.filter((p) => p.type === "Bit"),
    parts,
  };
  return cache;
}

export function roleColor(role, catalog) {
  const map = (catalog && catalog.roleColors) || ROLE_COLORS;
  return map[role] || "#8aa0bf";
}

/** Does a catalog part match the active filters?  Pure — safe to unit-test. */
export function matchesPartQuery(part, { q = "", type = "", role = "", system = "" } = {}) {
  if (!part) return false;
  if (type && part.type !== type) return false;
  if (role && part.role !== role) return false;
  if (system && part.system !== system) return false;
  const needle = q.trim().toLowerCase();
  if (needle) {
    const hay = `${part.name} ${part.system} ${part.role} ${part.spin} ${part.note}`.toLowerCase();
    if (!needle.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

const TYPE_ORDER = { Blade: 0, Ratchet: 1, Bit: 2 };

/** Filter + sort a catalog list for display (Blade → Ratchet → Bit, then name). */
export function queryCatalog(parts, filters = {}) {
  return (parts || [])
    .filter((p) => matchesPartQuery(p, filters))
    .sort((a, b) =>
      (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }));
}
