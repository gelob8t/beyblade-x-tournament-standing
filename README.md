# Beyblade X Journey 🌀

A single-page web app for recording your **Beyblade X tournament journey** — tournaments,
match results, your parts collection, decks, and a stats dashboard. It's a static site
(no build step) with accounts and cloud storage powered by **Firebase**, hosted on
**GitHub Pages**.

## What you can track

| Section | What goes in it |
| --- | --- |
| **Tournaments** | Name, date, location, format, final placement, W–L, notes |
| **Matches** | Opponent, your deck, opponent deck, per-game winner + finish type (Spin / Over / Burst / Xtreme), notes |
| **Collection** | Owned Blades, Ratchets and Bits |
| **Decks** | Named 3-Bey decks with per-slot combos; auto win rate from matches |
| **Dashboard** | Match & game win rate, finish-type breakdown (scored / conceded), win rate by deck, recent form, best placement |
| **Profile** | Profile picture, blader name, region, home store, main Bey, bio; JSON export of all your data |
| **Team** | Create or join a team by invite code; shared roster + win-rate leaderboard, team profile, 3v3 team battles, team tournaments |
| **Friends** | Add bladers by friend code; accept/decline requests; friends list showing each friend's record and win rate |
| **Friends activity** | Dashboard feed of friends' recent matches / placements — shown only for friends who set their activity to **Public** (Edit profile → Match activity visibility; default Private) |

Each account's personal journey is private and syncs across any device you sign in on.
Team data (roster, battles, events) is shared with everyone on that team.

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
  (Re-paste whenever `firestore.rules` changes in this repo — the Team feature added rules for
  the shared `teams/` and `teamCodes/` collections.)

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

---

## Project layout

```
index.html            markup + view containers
styles.css            all styling (Beyblade X dark theme)
js/
  firebase-config.js   <-- you edit this
  firebase.js          Firebase init + re-exports (CDN, no build)
  store.js             Firestore CRUD, scoped to users/{uid}/...
  teams.js             shared team data (teams/... and teamCodes/...)
  friends.js           friend codes, requests, friendships, player cards
  app.js               auth flow, views, forms, stats
firestore.rules        security rules to paste into Firebase
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
