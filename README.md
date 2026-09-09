# Beyblade X Journey 🌀

A single-page web app for recording your **Beyblade X tournament journey** — tournaments,
match results, your parts collection, decks, teams, friends, and deep stats. It's a
static site (no build step) with accounts and cloud storage powered by **Firebase**,
hosted on **GitHub Pages**, and installable as a **PWA** (Add to Home Screen).

## What you can track

| Section | What goes in it |
| --- | --- |
| **Tournaments** | Name, date, location, format, final placement, W–L, notes |
| **Matches** | Opponent, your deck, opponent deck, per-game winner + finish type (Spin / Over / Burst / Xtreme), notes |
| **Collection** | Owned Blades, Ratchets and Bits. **Browse catalog** opens a searchable, filterable picker (by type / role / system) with a generated icon per part — tick several and add them at once. Name fields also autocomplete from the catalog. |
| **Decks** | Named 3-Bey decks with per-slot combos; auto win rate from matches |
| **Dashboard** | Match & game win rate, finish-type breakdown (scored / conceded), win rate by deck, recent form, best placement |
| **Profile** | Profile picture, blader name, region, home store, main Bey, bio; JSON **export** of all your data, and **import / restore** from that file (adds only what's not already there) |
| **Team** | Create or join a team by invite code; shared roster + win-rate leaderboard, team profile, 3v3 team battles, team tournaments |
| **Friends** | Add bladers by friend code; accept/decline requests; friends list showing each friend's record and win rate |
| **Friends activity** | Dashboard feed of friends' recent matches / placements — shown only for friends who set their activity to **Public** (Edit profile → Match activity visibility; default Private) |
| **Live scoring** | Full-screen, big-button mode to score a match at the table — tap who won each game, pick the finish, first to 4 points, save straight to Matches |
| **Achievements** | 19 badges from your data (milestones, streaks, finishes, collection, social); progress bars on locked ones; unlock toast; count shown on your profile card |
| **Meta** | Editor-curated tier list (`data/meta.json`) for blades / ratchets / bits, plus a **self-updating combo list**: users rate combos S–D, a live consensus shows between refreshes, and a **weekly job** (`.github/workflows/meta.yml`, Mondays) re-derives each combo's official tier from the votes with ▲/▼/★ movement. Flags which meta parts you own; one-tap "+ Deck". |

Works **offline** (IndexedDB cache): reads come from the local cache, writes queue
and sync when you reconnect. Deletes are instant with a 6-second **Undo**.
| **Friend profiles** | Tap a friend (list or feed) to open their profile: identity, record, and full match history — history shown only if their activity is Public |

Logged-out visitors get a landing page (features + this week's top combos); the
sign-in card is one click away. Each account's personal journey is private and
syncs across any device you sign in on. Team data (roster, battles, events) is
shared with everyone on that team.

---

## Setup

### 1. Create a Firebase project (free)

1. Go to <https://console.firebase.google.com/> → **Add project**.
2. Once it's created, click the **`</>` (Web)** icon to register a web app. Skip Hosting.
3. Copy the `firebaseConfig` values it shows you.

### 2. Enable Auth and Firestore

- **Build → Authentication → Get started → Sign-in method →** enable **Email/Password**.
- **Build → Firestore Database → Create database →** start in **production mode**, pick a location.
- Open the **Rules** tab, paste the contents of [`firestore.rules`](firestore.rules), and **Publish**.

> **Automate rules** so you never have to paste again: run `npx firebase-tools login:ci`
> locally once, then add the printed token as a repo secret named `FIREBASE_TOKEN`
> (Settings → Secrets and variables → Actions). The deploy workflow then publishes
> `firestore.rules` on every push; without the secret it just prints a reminder.

### 2b. (Optional) Weekly meta refresh

The **Meta** tab's combo tiers are re-derived from community votes every Monday by
[`.github/workflows/meta.yml`](.github/workflows/meta.yml). To enable it:

1. Firebase console → ⚙ **Project settings → Service accounts → Generate new private key** — this downloads a JSON key.
2. That key's service account needs read access to Firestore: in the **Google Cloud console → IAM**, give it the **Cloud Datastore Viewer** role (Firebase usually grants enough by default).
3. Paste the whole JSON as a repo secret named **`GCP_SA_KEY`**.

Without the secret the workflow just logs a skip message; the live community
ratings on the Meta tab still work either way.

### 2c. (Optional) Part images

The **Collection → Browse catalog** picker shows a generated icon per part. To
show real photos instead:

1. Run `npm run parts:slugs` to list every part and its expected file name
   (e.g. `Dran Sword → dran-sword.png`).
2. Put the images somewhere web-accessible — a folder in this repo like
   `assets/parts/`, or an external CDN/bucket URL.
3. In [`data/parts.json`](data/parts.json) set `"imageBase"` to that folder
   (e.g. `"./assets/parts/"`) and `"imageExt"` if it isn't `.png`.

The app builds each URL as `imageBase + slug + imageExt`. For a one-off, put an
explicit `"image": "https://…"` on a single part instead (that wins). Any URL
that fails to load falls back to the generated icon automatically. Only use
images you have the right to host.

### 3. Add your config to the app

Edit [`js/firebase-config.js`](js/firebase-config.js) and replace every `REPLACE_ME`
with the values from step 1:

```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef",
};
```

> These values are **not secrets** — they're safe to commit. Your data is protected by
> the Firestore rules (each user only touches `users/{their-uid}/…`), not by hiding the config.

### 4. Authorize your GitHub Pages domain in Firebase

Firebase Auth → **Settings → Authorized domains → Add domain** →
`your-username.github.io`.

---

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The included workflow ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml))
   publishes the site on every push to `main`.
4. Your site will be at `https://<username>.github.io/<repo>/`.

---

## Run locally

Because it uses ES modules, open it through a tiny web server (not `file://`):

```bash
python -m http.server 8000
```

Then visit <http://localhost:8000>. For local dev, add `localhost` to Firebase's
authorized domains (it's usually there by default).

Run the unit tests with `npm test` (Node's built-in test runner — no deps).

---

## Project layout

```
index.html            markup + view containers
styles.css            all styling (Beyblade X dark theme)
manifest.webmanifest  PWA manifest;  sw.js  network-first service worker
icons/                app icons (192 / 512 / maskable / apple-touch)
js/
  firebase-config.js   <-- you edit this
  firebase.js          Firebase init + re-exports (CDN, no build)
  store.js             Firestore CRUD, scoped to users/{uid}/...
  stats.js             pure match/stat/meta math (unit-tested)
  teams.js             shared team data (teams/... and teamCodes/...)
  friends.js           friend codes, requests, friendships, cards, activity feed
  meta.js              community combo ratings (metaCombos/...)
  catalog.js           parts catalog loader + filter + slugify (data/parts.json)
  app.js               auth flow, views, forms, wiring
scripts/part-slugs.mjs  `npm run parts:slugs` — list part image file names
data/meta.json         curated tier-list snapshot (edit or PR to update)
data/parts.json        parts catalog for the collection picker (community-maintained; PRs welcome)
firestore.rules        security rules (auto-deployed if FIREBASE_TOKEN is set)
firebase.json          points firebase-tools at firestore.rules
test/stats.test.mjs    unit tests, run in CI before every deploy
.github/workflows/deploy.yml   test -> (rules + Pages), with SHA cache-busting
```

## Data model

```
users/{uid}/profile/main      { bladerName, region, homeStore, mainBey, bio, teamId,
                                photo }   // photo = 256px JPEG data URL, ~30 KB;
                                          // resized in the browser, no Firebase Storage needed
users/{uid}/tournaments/{id}   { name, date, location, format, placement, wins, losses, notes }
users/{uid}/matches/{id}       { date, tournamentId, opponent, myDeck, opponentDeck,
                                 games: [{ winner: "me"|"opp", finish: "Spin"|"Over"|"Burst"|"Xtreme" }],
                                 result, notes }
users/{uid}/beys/{id}          { type: "Blade"|"Ratchet"|"Bit", name, notes }
users/{uid}/decks/{id}         { name, combos: [{ blade, ratchet, bit }], notes }

teamCodes/{CODE}              { teamId }                       // invite-code lookup
teams/{teamId}               { name, tag, region, color, bio, founded,
                               ownerUid, memberUids: [uid], inviteCode }
teams/{teamId}/members/{uid} { bladerName, role: "owner"|"editor"|"member",
                               stats: { matchW, matchL, gameW, gameL,
                                        tournaments, bestPlacement } }
teams/{teamId}/battles/{id}  { date, opponentTeam, format, event,
                               lineup: [{ player, result: "W"|"L", opponent }],
                               teamResult, notes }
teams/{teamId}/events/{id}   { name, date, location, format, placement, wins, losses,
                               roster, notes }

playerCards/{uid}            { bladerName, photo, region, teamName, feedVisibility,
                               stats: { matchW, matchL, gameW, gameL, ... } }
friendCodes/{CODE}           { uid }                    // add-by-code lookup
friendRequests/{id}          { from, to, fromName, fromPhoto }   // exists = pending
friendships/{a_b}            { uids: [a, b] }           // doc id = sorted uids
activity/{uid}/items/{id}    { kind: "match"|"tournament", result, opponent,
                               myScore, oppScore, deck, name, placement, at }
                             // readable by a friend only if that user's
                             // playerCard.feedVisibility == "public"
```

Members publish their aggregate record to `teams/{teamId}/members/{uid}.stats` whenever
they log a match or tournament, so the leaderboard stays current without exposing each
member's private match log.
