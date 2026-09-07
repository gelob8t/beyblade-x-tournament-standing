// Friends — shared, cross-user data (lives outside users/{uid}).
//   playerCards/{uid}        public card: name, photo, region, team, record
//   friendCodes/{CODE}       { uid }  — add-by-code lookup
//   friendRequests/{id}      { from, to, fromName, fromPhoto }  (exists = pending)
//   friendships/{pairKey}    { uids: [a,b] }   pairKey = sorted uids joined "_"
import {
  db,
  auth,
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from "./firebase.js";

function uid() {
  if (!auth || !auth.currentUser) throw new Error("Not signed in");
  return auth.currentUser.uid;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(n = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

export function pairKey(a, b) {
  return [a, b].sort().join("_");
}

/** Make sure this user has a friend code; returns it. */
export async function ensureFriendCode(existing) {
  if (existing) return existing;
  const code = genCode();
  await setDoc(doc(db, "friendCodes", code), { uid: uid(), createdAt: serverTimestamp() });
  return code;
}

export async function publishCard(card) {
  await setDoc(
    doc(db, "playerCards", uid()),
    { ...card, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function getCard(u) {
  const snap = await getDoc(doc(db, "playerCards", u));
  return snap.exists() ? { uid: u, ...snap.data() } : null;
}

export async function listFriends() {
  const snap = await getDocs(
    query(collection(db, "friendships"), where("uids", "array-contains", uid()))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listIncoming() {
  const snap = await getDocs(query(collection(db, "friendRequests"), where("to", "==", uid())));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listOutgoing() {
  const snap = await getDocs(query(collection(db, "friendRequests"), where("from", "==", uid())));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function sendRequest(rawCode, me) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) throw new Error("Enter a friend code.");
  const cs = await getDoc(doc(db, "friendCodes", code));
  if (!cs.exists()) throw new Error("That friend code doesn't exist.");
  const target = cs.data().uid;
  if (target === uid()) throw new Error("That's your own friend code.");

  const fs = await getDoc(doc(db, "friendships", pairKey(uid(), target)));
  if (fs.exists()) throw new Error("You're already friends.");

  const [out, inc] = await Promise.all([listOutgoing(), listIncoming()]);
  if (out.some((r) => r.to === target)) throw new Error("You already sent them a request.");
  if (inc.some((r) => r.from === target)) throw new Error("They already sent you a request — accept it below.");

  await addDoc(collection(db, "friendRequests"), {
    from: uid(),
    to: target,
    fromName: (me && me.name) || "Blader",
    fromPhoto: (me && me.photo) || "",
    createdAt: serverTimestamp(),
  });
}

export async function acceptRequest(req) {
  await setDoc(doc(db, "friendships", pairKey(req.from, req.to)), {
    uids: [req.from, req.to].sort(),
    createdAt: serverTimestamp(),
  });
  await deleteDoc(doc(db, "friendRequests", req.id));
}

export async function dropRequest(reqId) {
  await deleteDoc(doc(db, "friendRequests", reqId));
}

export async function removeFriend(otherUid) {
  await deleteDoc(doc(db, "friendships", pairKey(uid(), otherUid)));
}

// ---- activity feed ----

/** Append an activity item to this user's own feed. */
export async function addActivity(item) {
  await addDoc(collection(db, "activity", uid(), "items"), {
    ...item,
    createdAt: serverTimestamp(),
  });
}

/** Read a friend's recent activity items (newest first). Throws if not
 *  allowed — caller should skip that friend. */
export async function listActivity(ownerUid, max = 8) {
  const snap = await getDocs(
    query(collection(db, "activity", ownerUid, "items"), orderBy("createdAt", "desc"), limit(max))
  );
  return snap.docs.map((d) => ({ id: d.id, ownerUid, ...d.data() }));
}
