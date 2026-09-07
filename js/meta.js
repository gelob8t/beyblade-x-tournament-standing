// Beyblade X meta: a curated starting tier list (data/meta.json) plus a
// community layer where signed-in users rate combos S–D and the app
// aggregates the votes.  Shared collection:
//   metaCombos/{key}            { blade, ratchet, bit, role, addedBy,
//                                 addedByName, tally:{S,A,B,C,D}, count }
//   metaCombos/{key}/votes/{uid} { tier, at }
import {
  db,
  auth,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
} from "./firebase.js";
import { TIERS, comboKey, consensus } from "./stats.js";

export { TIERS, comboKey, consensus };

function uid() {
  if (!auth || !auth.currentUser) throw new Error("Not signed in");
  return auth.currentUser.uid;
}

let curatedCache = null;
export async function loadCurated() {
  if (curatedCache) return curatedCache;
  const res = await fetch("./data/meta.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("Couldn't load the meta list.");
  curatedCache = await res.json();
  return curatedCache;
}

/** Community combos, most-voted first. */
export async function listCombos(max = 150) {
  const snap = await getDocs(query(collection(db, "metaCombos"), orderBy("count", "desc"), limit(max)));
  return snap.docs.map((d) => ({ key: d.id, ...d.data() }));
}

export async function myVote(key) {
  const snap = await getDoc(doc(db, "metaCombos", key, "votes", uid()));
  return snap.exists() ? snap.data().tier : null;
}

/** Cast (or change) this user's S–D vote for a combo, creating it if new. */
export async function castVote(combo, tier) {
  if (!TIERS.includes(tier)) throw new Error("Bad tier");
  const me = uid();
  const name = (auth.currentUser && auth.currentUser.displayName) || "Blader";
  const key = comboKey(combo.blade, combo.ratchet, combo.bit);
  const cRef = doc(db, "metaCombos", key);
  const vRef = doc(db, "metaCombos", key, "votes", me);

  await runTransaction(db, async (tx) => {
    const [cSnap, vSnap] = await Promise.all([tx.get(cRef), tx.get(vRef)]);
    const prev = vSnap.exists() ? vSnap.data().tier : null;
    if (prev === tier) return; // no change

    const base = cSnap.exists()
      ? cSnap.data()
      : {
          blade: combo.blade, ratchet: combo.ratchet, bit: combo.bit,
          role: combo.role || "", addedBy: me, addedByName: name,
          tally: { S: 0, A: 0, B: 0, C: 0, D: 0 }, count: 0,
        };
    const tally = { S: 0, A: 0, B: 0, C: 0, D: 0, ...base.tally };
    if (prev) tally[prev] = Math.max(0, (tally[prev] || 0) - 1);
    tally[tier] = (tally[tier] || 0) + 1;
    const count = TIERS.reduce((s, t) => s + tally[t], 0);

    tx.set(cRef, { ...base, tally, count, updatedAt: serverTimestamp() }, { merge: true });
    tx.set(vRef, { tier, at: serverTimestamp() });
  });
  return key;
}

/** Add a combo to the community list without voting yet. */
export async function addCombo(combo) {
  const me = uid();
  const name = (auth.currentUser && auth.currentUser.displayName) || "Blader";
  const key = comboKey(combo.blade, combo.ratchet, combo.bit);
  const cRef = doc(db, "metaCombos", key);
  const snap = await getDoc(cRef);
  if (snap.exists()) return key;
  await setDoc(cRef, {
    blade: combo.blade.trim(),
    ratchet: combo.ratchet.trim(),
    bit: combo.bit.trim(),
    role: combo.role || "",
    addedBy: me,
    addedByName: name,
    tally: { S: 0, A: 0, B: 0, C: 0, D: 0 },
    count: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return key;
}
