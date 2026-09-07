// Firestore data access, scoped to the signed-in user.
// Layout:  users/{uid}/{collection}/{docId}
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
  serverTimestamp,
} from "./firebase.js";

function uid() {
  if (!auth || !auth.currentUser) throw new Error("Not signed in");
  return auth.currentUser.uid;
}

function col(name) {
  return collection(db, "users", uid(), name);
}

/** Read every document in a user collection, newest first. */
export async function list(name, sortField = "createdAt") {
  const snap = await getDocs(query(col(name), orderBy(sortField, "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Create a document, stamping createdAt/updatedAt. */
export async function create(name, data) {
  const ref = await addDoc(col(name), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** Patch an existing document. */
export async function update(name, id, data) {
  await updateDoc(doc(db, "users", uid(), name, id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

/** Delete a document. */
export async function remove(name, id) {
  await deleteDoc(doc(db, "users", uid(), name, id));
}

/** Read a single document by id; returns null if it doesn't exist. */
export async function getOne(name, id) {
  const snap = await getDoc(doc(db, "users", uid(), name, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Create-or-merge a single document at a known id. */
export async function setOne(name, id, data) {
  await setDoc(
    doc(db, "users", uid(), name, id),
    { ...data, updatedAt: serverTimestamp() },
    { merge: true }
  );
}
