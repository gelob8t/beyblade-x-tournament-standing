// ---------------------------------------------------------------------------
// Firebase configuration
// ---------------------------------------------------------------------------
// 1. Create a free Firebase project at https://console.firebase.google.com/
// 2. Add a "Web app" (</> icon) and copy its config object here.
// 3. In the console, enable:
//      - Authentication -> Sign-in method -> Email/Password
//      - Firestore Database -> Create database (production mode)
// 4. Paste the Firestore rules from firestore.rules into the Rules tab.
//
// These values are NOT secrets — they identify your project to the browser.
// Your data is protected by the Firestore security rules, not by hiding this.
// ---------------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: "AIzaSyCWLCuFOiK8bKH2h6o-Stz17bHFa3PLxoM",
  authDomain: "beybladex-journey.firebaseapp.com",
  projectId: "beybladex-journey",
  storageBucket: "beybladex-journey.firebasestorage.app",
  messagingSenderId: "587875395355",
  appId: "1:587875395355:web:9e40b0489dd773b12995be",
  measurementId: "G-BNEEVBNLL4"
};

// Leave this check as-is. It shows a friendly warning until you fill in the config.
export const isConfigured = !Object.values(firebaseConfig).some(
  (v) => typeof v === "string" && v.includes("REPLACE_ME")
);
