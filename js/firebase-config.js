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
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};

// Leave this check as-is. It shows a friendly warning until you fill in the config.
export const isConfigured = !Object.values(firebaseConfig).some(
  (v) => typeof v === "string" && v.includes("REPLACE_ME")
);
