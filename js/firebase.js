// Firebase initialisation. Uses the modular CDN build so there is no build step.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getFirestore,
  collection,
  collectionGroup,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  writeBatch,
  waitForPendingWrites,
  onSnapshotsInSync,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig, isConfigured } from "./firebase-config.js";

let app = null;
let auth = null;
let db = null;

if (isConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // IndexedDB-backed cache: reads work offline, writes queue and sync later.
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (e) {
    console.warn("persistent cache unavailable, falling back", e);
    db = getFirestore(app);
  }
}

export {
  isConfigured,
  app,
  auth,
  db,
  // auth helpers
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
  // firestore helpers
  collection,
  collectionGroup,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  writeBatch,
  waitForPendingWrites,
  onSnapshotsInSync,
};
