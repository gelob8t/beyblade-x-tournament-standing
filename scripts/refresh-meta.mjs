// Weekly job: read community combo votes from Firestore and regenerate the
// `combos` section (and the timestamp) of data/meta.json. The hand-curated
// blades / ratchets / bits stay untouched — edit those by PR.
//
// Runs in CI from .github/workflows/meta.yml with a service-account key in
// the GCP_SA_KEY secret (role: Cloud Datastore Viewer). Run locally with:
//   GCP_SA_KEY="$(cat key.json)" node scripts/refresh-meta.mjs
import fs from "node:fs";
import path from "node:path";
import { consensus, comboKey } from "../js/stats.js";

const KEY = process.env.GCP_SA_KEY;
if (!KEY) {
  console.log("GCP_SA_KEY not set — skipping weekly meta refresh.");
  console.log("Add a service-account key (Cloud Datastore Viewer) as the GCP_SA_KEY repo secret to enable it.");
  process.exit(0);
}

const { default: admin } = await import("firebase-admin");
const cred = JSON.parse(KEY);
admin.initializeApp({ credential: admin.credential.cert(cred), projectId: cred.project_id });
const db = admin.firestore();

const FILE = path.join(import.meta.dirname, "..", "data", "meta.json");
const meta = JSON.parse(fs.readFileSync(FILE, "utf8"));

// tier of every combo in the file we're about to replace, for trend arrows
const prevTier = {};
for (const c of meta.combos || []) prevTier[comboKey(c.blade, c.ratchet, c.bit)] = c.tier || null;

const MIN_VOTES = 3; // below this a combo keeps its editor tier
const TIER_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };

// start from the editor's seed combos so the list is never empty
const seed = new Map();
for (const c of meta.combos || []) {
  seed.set(comboKey(c.blade, c.ratchet, c.bit), {
    blade: c.blade, ratchet: c.ratchet, bit: c.bit, role: c.role || "",
    editorTier: c.tier || null, editorNote: c.note || "",
  });
}

const snap = await db.collection("metaCombos").get();
let voted = 0;
for (const doc of snap.docs) {
  const d = doc.data();
  const key = doc.id;
  const cons = consensus(d.tally || {}, d.count || 0);
  const existing = seed.get(key) || {
    blade: d.blade, ratchet: d.ratchet, bit: d.bit, role: d.role || "",
    editorTier: null, editorNote: "",
  };
  existing.votes = cons.count;
  existing.score = cons.score;
  existing.communityTier = cons.count >= MIN_VOTES ? cons.letter : null;
  seed.set(key, existing);
  if (cons.count > 0) voted++;
}

const combos = [...seed.entries()]
  .map(([key, c]) => {
    const tier = c.communityTier || c.editorTier || "B";
    const trend =
      !(key in prevTier) ? "new"
      : prevTier[key] == null || tier === prevTier[key] ? "same"
      : (TIER_RANK[tier] ?? 9) < (TIER_RANK[prevTier[key]] ?? 9) ? "up" : "down";
    return {
      blade: c.blade, ratchet: c.ratchet, bit: c.bit,
      role: c.role || "",
      tier,
      votes: c.votes || 0,
      score: c.score || 0,
      trend,
      note: c.editorNote || "",
    };
  })
  .sort((a, b) => (b.score || 0) - (a.score || 0) || (TIER_RANK[a.tier] - TIER_RANK[b.tier]) || b.votes - a.votes)
  .slice(0, 40);

const now = new Date();
const weekStart = new Date(now);
weekStart.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7)); // Monday
meta.combos = combos;
meta.updated = weekStart.toISOString().slice(0, 10);
meta.refreshedAt = now.toISOString();
meta.communityVotes = voted;

fs.writeFileSync(FILE, JSON.stringify(meta, null, 2) + "\n");
console.log(`Refreshed data/meta.json — ${combos.length} combos, ${voted} with community votes, week of ${meta.updated}.`);
