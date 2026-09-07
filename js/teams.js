// Shared team data. Lives OUTSIDE users/{uid} so teammates can read each other.
//   teams/{teamId}                     team profile + memberUids + inviteCode
//   teams/{teamId}/members/{uid}       roster row + published stats
//   teams/{teamId}/battles/{id}        team-vs-team battles
//   teams/{teamId}/events/{id}         team tournaments
//   teamCodes/{CODE}                   { teamId }  — invite-code lookup
import {
  db,
  auth,
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
} from "./firebase.js";

function uid() {
  if (!auth || !auth.currentUser) throw new Error("Not signed in");
  return auth.currentUser.uid;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(n = 6) {
  let s = "";
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  for (let i = 0; i < n; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

const teamRef = (id) => doc(db, "teams", id);
const subCol = (id, name) => collection(db, "teams", id, name);

export async function getTeam(teamId) {
  const snap = await getDoc(teamRef(teamId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listMembers(teamId) {
  const snap = await getDocs(subCol(teamId, "members"));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

export async function listBattles(teamId) {
  const snap = await getDocs(query(subCol(teamId, "battles"), orderBy("date", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listEvents(teamId) {
  const snap = await getDocs(query(subCol(teamId, "events"), orderBy("date", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function createTeam(meta, bladerName) {
  const me = uid();
  const code = genCode();
  const ref = await addDoc(collection(db, "teams"), {
    name: meta.name,
    tag: meta.tag || "",
    region: meta.region || "",
    color: meta.color || "#2b7dff",
    bio: meta.bio || "",
    founded: meta.founded || "",
    ownerUid: me,
    memberUids: [me],
    inviteCode: code,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, "teamCodes", code), { teamId: ref.id, createdAt: serverTimestamp() });
  await setDoc(doc(db, "teams", ref.id, "members", me), {
    bladerName: bladerName || "Blader",
    role: "owner",
    joinedAt: serverTimestamp(),
    stats: {},
  });
  return ref.id;
}

export async function joinTeam(rawCode, bladerName) {
  const me = uid();
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) throw new Error("Enter an invite code.");
  const codeSnap = await getDoc(doc(db, "teamCodes", code));
  if (!codeSnap.exists()) throw new Error("That invite code doesn't exist.");
  const teamId = codeSnap.data().teamId;
  const team = await getTeam(teamId);
  if (!team) throw new Error("That team no longer exists.");
  if (!(team.memberUids || []).includes(me)) {
    await updateDoc(teamRef(teamId), { memberUids: arrayUnion(me), updatedAt: serverTimestamp() });
  }
  await setDoc(
    doc(db, "teams", teamId, "members", me),
    { bladerName: bladerName || "Blader", role: "member", joinedAt: serverTimestamp() },
    { merge: true }
  );
  return teamId;
}

export async function leaveTeam(teamId) {
  const me = uid();
  await deleteDoc(doc(db, "teams", teamId, "members", me)).catch(() => {});
  await updateDoc(teamRef(teamId), { memberUids: arrayRemove(me), updatedAt: serverTimestamp() });
}

export async function updateTeam(teamId, data) {
  await updateDoc(teamRef(teamId), { ...data, updatedAt: serverTimestamp() });
}

export async function regenerateCode(teamId, oldCode) {
  const code = genCode();
  await setDoc(doc(db, "teamCodes", code), { teamId, createdAt: serverTimestamp() });
  await updateDoc(teamRef(teamId), { inviteCode: code, updatedAt: serverTimestamp() });
  if (oldCode) await deleteDoc(doc(db, "teamCodes", oldCode)).catch(() => {});
  return code;
}

export async function removeMember(teamId, memberUid) {
  await deleteDoc(doc(db, "teams", teamId, "members", memberUid)).catch(() => {});
  await updateDoc(teamRef(teamId), { memberUids: arrayRemove(memberUid), updatedAt: serverTimestamp() });
}

/** Owner only (enforced by rules): set a member's role to "editor" or "member". */
export async function setMemberRole(teamId, memberUid, role) {
  await updateDoc(doc(db, "teams", teamId, "members", memberUid), {
    role,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteTeam(teamId) {
  const team = await getTeam(teamId);
  for (const sub of ["members", "battles", "events"]) {
    const snap = await getDocs(subCol(teamId, sub));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  }
  if (team && team.inviteCode) await deleteDoc(doc(db, "teamCodes", team.inviteCode)).catch(() => {});
  await deleteDoc(teamRef(teamId));
}

/** Publish the current user's aggregate record so teammates can see it. */
export async function publishStats(teamId, bladerName, stats) {
  await setDoc(
    doc(db, "teams", teamId, "members", uid()),
    { bladerName: bladerName || "Blader", stats, statsUpdatedAt: serverTimestamp() },
    { merge: true }
  );
}

// ---- battles ----
export async function addBattle(teamId, data) {
  await addDoc(subCol(teamId, "battles"), { ...data, createdAt: serverTimestamp() });
}
export async function updateBattle(teamId, id, data) {
  await updateDoc(doc(db, "teams", teamId, "battles", id), { ...data, updatedAt: serverTimestamp() });
}
export async function removeBattle(teamId, id) {
  await deleteDoc(doc(db, "teams", teamId, "battles", id));
}

// ---- events ----
export async function addEvent(teamId, data) {
  await addDoc(subCol(teamId, "events"), { ...data, createdAt: serverTimestamp() });
}
export async function updateEvent(teamId, id, data) {
  await updateDoc(doc(db, "teams", teamId, "events", id), { ...data, updatedAt: serverTimestamp() });
}
export async function removeEvent(teamId, id) {
  await deleteDoc(doc(db, "teams", teamId, "events", id));
}
