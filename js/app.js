import {
  isConfigured,
  auth,
  db,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  sendPasswordResetEmail,
  waitForPendingWrites,
} from "./firebase.js";
import * as store from "./store.js";
import * as teams from "./teams.js";
import * as friends from "./friends.js";
import * as meta from "./meta.js";
import {
  FINISHES, finishLabel, finishPts,
  matchScore, matchResult, ordinal, groupRecord, streaks, achievements,
} from "./stats.js";

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s + (s.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d)) return esc(s);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function toast(msg, kind = "ok") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast toast--${kind}`;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2800);
}

/** Toast with an Undo action; stays up ~6s. */
function undoToast(msg, onUndo) {
  const t = $("#toast");
  clearTimeout(toast._t);
  t.className = "toast toast--warn toast--action";
  t.innerHTML = `<span>${esc(msg)}</span><button type="button" class="toast-undo">Undo</button>`;
  t.hidden = false;
  const close = () => { t.hidden = true; t.innerHTML = ""; t.className = "toast"; };
  t.querySelector(".toast-undo").addEventListener("click", () => { close(); onUndo(); });
  toast._t = setTimeout(close, 6000);
}


// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
const modal = {
  open(title, bodyNode) {
    $("#modal-title").textContent = title;
    const body = $("#modal-body");
    body.innerHTML = "";
    body.append(bodyNode);
    $("#modal").hidden = false;
    document.body.style.overflow = "hidden";
  },
  close() {
    $("#modal").hidden = true;
    document.body.style.overflow = "";
  },
};
$$("#modal [data-close]").forEach((b) => b.addEventListener("click", modal.close));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#modal").hidden) modal.close();
});

// Build a <form> from a field spec. Returns { form, values() }.
function buildForm(fields, initial = {}) {
  const form = document.createElement("form");
  form.className = "entry-form";
  for (const f of fields) {
    if (f.type === "custom") { form.append(f.render(initial)); continue; }
    if (f.type === "checkbox") {
      const wrap = document.createElement("label");
      wrap.className = "field field--check";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.name = f.name;
      if (initial[f.name] ?? f.default) cb.checked = true;
      const span = document.createElement("span");
      span.textContent = f.label;
      wrap.append(cb, span);
      form.append(wrap);
      continue;
    }
    const wrap = document.createElement("label");
    wrap.className = "field";
    const val = initial[f.name] ?? f.default ?? "";
    let input;
    if (f.type === "select") {
      input = document.createElement("select");
      for (const o of f.options) {
        const opt = document.createElement("option");
        opt.value = o.value; opt.textContent = o.label;
        if (String(o.value) === String(val)) opt.selected = true;
        input.append(opt);
      }
    } else if (f.type === "textarea") {
      input = document.createElement("textarea");
      input.rows = 3; input.value = val;
    } else {
      input = document.createElement("input");
      input.type = f.type || "text";
      input.value = val;
    }
    input.name = f.name;
    if (f.required) input.required = true;
    if (f.placeholder) input.placeholder = f.placeholder;
    if (f.min != null) input.min = f.min;
    if (f.step != null) input.step = f.step;
    wrap.innerHTML = `<span>${esc(f.label)}</span>`;
    wrap.append(input);
    form.append(wrap);
  }
  const actions = document.createElement("div");
  actions.className = "form-actions";
  actions.innerHTML = `
    <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
    <button type="submit" class="btn btn-primary">Save</button>`;
  form.append(actions);
  actions.querySelector("[data-cancel]").addEventListener("click", modal.close);

  return {
    form,
    values() {
      const fd = new FormData(form);
      return Object.fromEntries(fd.entries());
    },
  };
}

// Run an async action from a button click, showing a spinner on that button
// until it finishes. Restores the button if it's still on screen.
async function runBtn(btn, label, fn) {
  const restore = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add("is-loading");
  btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span>${esc(label)}</span>`;
  try {
    await fn();
  } catch (err) {
    console.error(err);
    toast(err.message || "Something went wrong.", "err");
  } finally {
    if (btn.isConnected) {
      btn.disabled = false;
      btn.classList.remove("is-loading");
      btn.innerHTML = restore;
    }
  }
}

// Wire a form's submit to an async handler, showing a spinner on the primary
// button while it runs and re-enabling it if the handler throws / leaves the
// form on screen.
function bindSubmit(form, handler) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn =
      form.querySelector('.form-actions .btn-primary') ||
      form.querySelector('button[type="submit"]');
    let restore = "";
    if (btn) {
      restore = btn.innerHTML;
      btn.disabled = true;
      btn.classList.add("is-loading");
      btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span>Saving…</span>`;
    }
    try {
      await handler();
    } catch (err) {
      console.error(err);
      toast(err.message || "Something went wrong.", "err");
    } finally {
      if (btn && btn.isConnected) {
        btn.disabled = false;
        btn.classList.remove("is-loading");
        btn.innerHTML = restore;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  view: "dashboard",
  tournaments: [],
  matches: [],
  beys: [],
  decks: [],
  profile: {},
  team: null,
  teamMembers: [],
  teamBattles: [],
  teamEvents: [],
  teamTab: "roster",
  friends: [],
  friendReqIn: [],
  friendReqOut: [],
  friendCards: {},
  feed: [],
  openFriend: null,
  friendProfile: null,
  achv: [],
  meta: null,
  metaTab: "combos",
  metaSort: "community",
  myVotes: {},
  loaded: false,
};

async function refresh() {
  const [tournaments, matches, beys, decks, profile] = await Promise.all([
    store.list("tournaments"),
    store.list("matches"),
    store.list("beys"),
    store.list("decks"),
    store.getOne("profile", "main"),
  ]);
  Object.assign(state, { tournaments, matches, beys, decks, profile: profile || {}, loaded: true });
  await Promise.all([refreshTeam(), refreshFriends()]);
  computeAchievements();
  publishPresence();
}

const ACHV_SEEN_KEY = "bbx_achv_seen";

function computeAchievements() {
  state.achv = achievements({
    matches: state.matches,
    tournaments: state.tournaments,
    beys: state.beys,
    decks: state.decks,
    friendsCount: state.friends.length,
    hasTeam: !!state.team,
  });
  const doneIds = state.achv.filter((a) => a.done).map((a) => a.id);
  let seen;
  try { seen = JSON.parse(localStorage.getItem(ACHV_SEEN_KEY) || "null"); } catch { seen = null; }
  if (!Array.isArray(seen)) {
    // first run — remember what's already earned, don't celebrate retroactively
    try { localStorage.setItem(ACHV_SEEN_KEY, JSON.stringify(doneIds)); } catch { /* ignore */ }
    return;
  }
  const fresh = state.achv.filter((a) => a.done && !seen.includes(a.id));
  if (fresh.length) {
    const first = fresh[0];
    toast(`${first.icon} Achievement unlocked: ${first.name}${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ""}`);
    try { localStorage.setItem(ACHV_SEEN_KEY, JSON.stringify(doneIds)); } catch { /* ignore */ }
  }
}

async function refreshFriends() {
  try {
    const code = await friends.ensureFriendCode(state.profile.friendCode);
    if (code !== state.profile.friendCode) {
      await store.setOne("profile", "main", { friendCode: code });
      state.profile.friendCode = code;
    }
    const [fr, ri, ro] = await Promise.all([
      friends.listFriends(),
      friends.listIncoming(),
      friends.listOutgoing(),
    ]);
    const me = auth.currentUser.uid;
    const others = fr.map((f) => (f.uids || []).find((u) => u !== me)).filter(Boolean);
    const cards = await Promise.all(others.map((u) => friends.getCard(u).catch(() => null)));
    const cardMap = {};
    others.forEach((u, i) => { if (cards[i]) cardMap[u] = cards[i]; });
    Object.assign(state, { friends: fr, friendReqIn: ri, friendReqOut: ro, friendCards: cardMap });

    // build the activity feed from friends who set their feed to public
    const publicUids = others.filter((u) => cardMap[u]?.feedVisibility === "public");
    const lists = await Promise.all(
      publicUids.map((u) => friends.listActivity(u, 8).catch(() => []))
    );
    const feed = [];
    publicUids.forEach((u, i) => {
      const c = cardMap[u] || {};
      for (const it of lists[i]) {
        feed.push({ ...it, actorName: c.bladerName || "Blader", actorPhoto: c.photo || "" });
      }
    });
    feed.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    state.feed = feed.slice(0, 25);
  } catch (err) {
    console.error("friends load failed", err);
  }
}

function tsMillis(ts) {
  if (!ts) return Date.now();
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return 0;
}

function relTime(ts) {
  const ms = tsMillis(ts);
  const diff = Date.now() - ms;
  if (diff < 60000) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const wks = Math.floor(days / 7);
  if (wks < 5) return `${wks}w ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function refreshTeam() {
  const teamId = state.profile.teamId;
  if (!teamId) {
    Object.assign(state, { team: null, teamMembers: [], teamBattles: [], teamEvents: [] });
    return;
  }
  try {
    const team = await teams.getTeam(teamId);
    if (!team) {
      // team was deleted — detach quietly
      await store.setOne("profile", "main", { teamId: "" });
      state.profile.teamId = "";
      Object.assign(state, { team: null, teamMembers: [], teamBattles: [], teamEvents: [] });
      return;
    }
    const [members, battles, events] = await Promise.all([
      teams.listMembers(teamId),
      teams.listBattles(teamId),
      teams.listEvents(teamId),
    ]);
    Object.assign(state, { team, teamMembers: members, teamBattles: battles, teamEvents: events });
  } catch (err) {
    console.error("team load failed", err);
    Object.assign(state, { team: null, teamMembers: [], teamBattles: [], teamEvents: [] });
  }
}

/** Aggregate record for the signed-in user, from their own data. */
function myStats() {
  const played = state.matches.filter((m) => matchResult(m) !== "—");
  let gW = 0, gL = 0;
  for (const m of state.matches) for (const g of m.games || []) {
    if (g.winner === "me") gW++; else gL++;
  }
  const placements = state.tournaments
    .map((t) => Number(t.placement)).filter((n) => Number.isFinite(n) && n > 0);
  return {
    matchW: played.filter((m) => matchResult(m) === "W").length,
    matchL: played.filter((m) => matchResult(m) === "L").length,
    gameW: gW, gameL: gL,
    tournaments: state.tournaments.length,
    bestPlacement: placements.length ? Math.min(...placements) : null,
  };
}

/** Push the current user's record to their public player card and, if on a
 *  team, to their team roster row. Best-effort — never throws. */
async function publishPresence() {
  const stats = myStats();
  const photo = state.profile.photo || "";
  try {
    await friends.publishCard({
      bladerName: displayName(),
      photo,
      region: state.profile.region || "",
      teamName: state.team ? state.team.name : "",
      mainBey: state.profile.mainBey || "",
      bio: state.profile.bio || "",
      feedVisibility: state.profile.feedVisibility === "public" ? "public" : "private",
      achvDone: (state.achv || []).filter((a) => a.done).length,
      stats,
    });
  } catch (err) {
    console.error("card publish failed", err);
  }
  if (state.team) {
    try {
      await teams.publishStats(state.team.id, displayName(), stats, photo);
    } catch (err) {
      console.error("stat publish failed", err);
    }
  }
}
// legacy name kept for existing call sites
const publishMyStats = publishPresence;

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "–";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function displayName() {
  return state.profile.bladerName || (auth.currentUser && (auth.currentUser.displayName || auth.currentUser.email)) || "Blader";
}

/** Paint an .avatar element with a photo (if given) or the name's initials. */
function paintAvatar(el, name, photo) {
  if (!el) return;
  if (photo) {
    el.textContent = "";
    el.classList.add("avatar--img");
    el.style.backgroundImage = `url("${photo}")`;
  } else {
    el.classList.remove("avatar--img");
    el.style.backgroundImage = "";
    el.textContent = initials(name);
  }
}

/** Inline avatar markup for use inside innerHTML strings. */
function avatarHtml(name, photo, cls = "") {
  return photo
    ? `<span class="avatar avatar--img ${cls}" style="background-image:url('${esc(photo)}')"></span>`
    : `<span class="avatar ${cls}">${esc(initials(name))}</span>`;
}

function syncProfileChrome() {
  const name = displayName();
  const photo = state.profile.photo || "";
  state.userName = name;
  paintAvatar($("#avatar"), name, photo);
  paintAvatar($("#avatar-lg"), name, photo);
  $("#profile-name").textContent = name;
  $("#pm-name").textContent = name;
  $("#pm-email").textContent = (auth.currentUser && auth.currentUser.email) || "";
}

/** Load an image file and return a square JPEG data URL, resized down. */
function fileToAvatarDataUrl(file, size = 256) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error("Please choose an image file."));
    if (file.size > 10 * 1024 * 1024) return reject(new Error("That image is over 10 MB — pick a smaller one."));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
      let quality = 0.85;
      let out = canvas.toDataURL("image/jpeg", quality);
      while (out.length > 120000 && quality > 0.4) {
        quality -= 0.12;
        out = canvas.toDataURL("image/jpeg", quality);
      }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image.")); };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Auth view
// ---------------------------------------------------------------------------
let authMode = "signin";

function initAuthUi() {
  if (!isConfigured) {
    $("#config-warning").hidden = false;
    $("#auth-submit").disabled = true;
  }
  $$(".auth-tab").forEach((t) =>
    t.addEventListener("click", () => {
      authMode = t.dataset.mode;
      $$(".auth-tab").forEach((x) => x.classList.toggle("is-active", x === t));
      $("#field-name").hidden = authMode !== "signup";
      $("#auth-submit").textContent = authMode === "signup" ? "Create account" : "Sign in";
      $("#auth-password").autocomplete = authMode === "signup" ? "new-password" : "current-password";
      $("#auth-error").hidden = true;
    })
  );

  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    const name = $("#auth-name").value.trim();
    const errEl = $("#auth-error");
    errEl.hidden = true;
    const btn = $("#auth-submit");
    btn.disabled = true;
    btn.classList.add("is-loading");
    btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span>${authMode === "signup" ? "Creating…" : "Signing in…"}</span>`;
    try {
      if (authMode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (name) await updateProfile(cred.user, { displayName: name });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      errEl.textContent = friendlyAuthError(err);
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.classList.remove("is-loading");
      btn.textContent = authMode === "signup" ? "Create account" : "Sign in";
    }
  });

  $("#auth-reset").addEventListener("click", async () => {
    const email = $("#auth-email").value.trim();
    if (!email) return toast("Enter your email first, then click reset.", "warn");
    try {
      await sendPasswordResetEmail(auth, email);
      toast("Password reset email sent.");
    } catch (err) {
      toast(friendlyAuthError(err), "err");
    }
  });

  // landing <-> auth navigation
  $$("[data-auth]").forEach((b) =>
    b.addEventListener("click", () => showAuth(b.dataset.auth))
  );
  $("#auth-back").addEventListener("click", showLanding);
}

function showLanding() {
  $("#app-loading").hidden = true;
  $("#shell").hidden = true;
  $("#auth-view").hidden = true;
  $("#landing").hidden = false;
  populateLandingMeta();
}

function showAuth(mode) {
  const tab = $$(".auth-tab").find((t) => t.dataset.mode === (mode === "signup" ? "signup" : "signin"));
  if (tab && !tab.classList.contains("is-active")) tab.click();
  $("#landing").hidden = true;
  $("#auth-view").hidden = false;
  setTimeout(() => $("#auth-email").focus(), 50);
}

let landingMetaDone = false;
async function populateLandingMeta() {
  if (landingMetaDone) return;
  landingMetaDone = true;
  try {
    const data = await meta.loadCurated();
    const top = (data.combos || [])
      .slice()
      .sort((a, b) => (b.score || 0) - (a.score || 0) || ("SABCD".indexOf(a.tier) - "SABCD".indexOf(b.tier)))
      .slice(0, 4);
    if (!top.length) return;
    $("#landing-combos").innerHTML = top.map((c) => `
      <li><span class="tier tier--${esc(c.tier || "B")}">${esc(c.tier || "B")}</span>
      <span>${esc([c.blade, c.ratchet, c.bit].filter(Boolean).join(" "))}</span>
      ${c.role ? `<span class="chip">${esc(c.role)}</span>` : ""}</li>`).join("");
    $("#landing-meta").hidden = false;
  } catch { /* teaser is optional */ }
}

function friendlyAuthError(err) {
  const code = (err && err.code) || "";
  const map = {
    "auth/invalid-email": "That email address looks invalid.",
    "auth/missing-password": "Please enter a password.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/email-already-in-use": "An account with that email already exists.",
    "auth/invalid-credential": "Wrong email or password.",
    "auth/wrong-password": "Wrong email or password.",
    "auth/user-not-found": "No account with that email.",
    "auth/too-many-requests": "Too many attempts. Try again later.",
    "auth/network-request-failed": "Network error. Check your connection.",
  };
  return map[code] || (err && err.message) || "Something went wrong.";
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------
function initShell() {
  $$("#tabs .tab").forEach((t) =>
    t.addEventListener("click", () => switchView(t.dataset.view))
  );
  initProfileMenu();
  initNet();
}

function initNet() {
  const banner = $("#net-banner");
  const update = () => {
    const off = !navigator.onLine;
    banner.hidden = !off;
    banner.textContent = off
      ? "Offline — changes are saved on this device and sync when you reconnect."
      : "";
  };
  addEventListener("online", async () => {
    update();
    try {
      await waitForPendingWrites(db);
      if (state.loaded) { await refresh(); render(); }
    } catch { /* ignore */ }
  });
  addEventListener("offline", update);
  update();
}

// ---------------------------------------------------------------------------
// Profile menu
// ---------------------------------------------------------------------------
function initProfileMenu() {
  const btn = $("#profile-btn");
  const menu = $("#profile-menu");

  const setOpen = (open) => {
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(menu.hidden);
  });
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) setOpen(false);
  });

  menu.addEventListener("click", async (e) => {
    const act = e.target.closest("button")?.dataset.act;
    if (!act) return;
    setOpen(false);
    if (act === "edit") profileForm();
    else if (act === "export") exportData();
    else if (act === "signout") signOut(auth);
    else if (act === "reset") {
      const email = auth.currentUser?.email;
      if (!email) return;
      try {
        await sendPasswordResetEmail(auth, email);
        toast("Password reset email sent to " + email);
      } catch (err) {
        toast(friendlyAuthError(err), "err");
      }
    }
  });
}

function profileForm() {
  const p = state.profile || {};
  let photo = p.photo || "";

  const photoField = () => {
    const box = document.createElement("div");
    box.className = "photo-field";
    const draw = () => {
      box.innerHTML = `
        <span class="field-span">Profile picture</span>
        <div class="photo-field-row">
          ${avatarHtml(displayName(), photo, "avatar--xl")}
          <div class="photo-field-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-pick>${photo ? "Change" : "Upload"} photo</button>
            ${photo ? `<button type="button" class="btn btn-ghost btn-sm danger" data-clear>Remove</button>` : ""}
            <p class="muted small">Square works best. Stored resized to 256px.</p>
          </div>
        </div>
        <input type="file" accept="image/*" hidden data-file />`;
      box.querySelector("[data-pick]").addEventListener("click", () => box.querySelector("[data-file]").click());
      const clear = box.querySelector("[data-clear]");
      if (clear) clear.addEventListener("click", () => { photo = ""; draw(); });
      box.querySelector("[data-file]").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try { photo = await fileToAvatarDataUrl(file); draw(); }
        catch (err) { toast(err.message, "err"); }
      });
    };
    draw();
    return box;
  };

  const { form, values } = buildForm([
    { type: "custom", render: photoField },
    { name: "bladerName", label: "Blader name", required: true, placeholder: "e.g. Bird", default: displayName() },
    { name: "region", label: "Region / city", placeholder: "Metro Manila" },
    { name: "homeStore", label: "Home store / club", placeholder: "Where you usually play" },
    { name: "mainBey", label: "Main Bey", placeholder: "e.g. Dran Sword 3-60F" },
    { name: "bio", label: "Bio / goals", type: "textarea", placeholder: "This season I want to…" },
    { name: "feedVisibility", label: "Match activity visibility", type: "select",
      default: p.feedVisibility || "private", options: [
        { value: "private", label: "Private — only you" },
        { value: "public", label: "Public — friends see your recent matches" },
      ] },
  ], p);

  bindSubmit(form, async () => {
    const v = values();
    const data = {
      bladerName: v.bladerName.trim(),
      region: v.region.trim(),
      homeStore: v.homeStore.trim(),
      mainBey: v.mainBey.trim(),
      bio: v.bio.trim(),
      photo: photo || "",
      feedVisibility: v.feedVisibility === "public" ? "public" : "private",
    };
    await store.setOne("profile", "main", data);
    if (data.bladerName && auth.currentUser && auth.currentUser.displayName !== data.bladerName) {
      try { await updateProfile(auth.currentUser, { displayName: data.bladerName }); } catch { /* non-fatal */ }
    }
    state.profile = { ...state.profile, ...data };
    syncProfileChrome();
    await publishPresence();
    modal.close();
    render();
    toast("Profile updated.");
  });
  modal.open("Edit profile", form);
}

function exportData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    account: { email: auth.currentUser?.email || null, uid: auth.currentUser?.uid || null },
    profile: state.profile || {},
    tournaments: state.tournaments,
    matches: state.matches,
    beys: state.beys,
    decks: state.decks,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `beyblade-x-journey-${today()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast("Export downloaded.");
}

function switchView(view) {
  state.view = view;
  state.openFriend = null;
  $$("#tabs .tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === view));
  render();
}

async function openFriendProfile(uid) {
  state.view = "friends";
  state.openFriend = uid;
  state.friendProfile = { uid, loading: true };
  $$("#tabs .tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === "friends"));
  render();
  try {
    state.friendProfile = { ...(await friends.getProfile(uid)), loading: false };
  } catch (err) {
    console.error(err);
    state.friendProfile = { uid, card: null, items: null, loading: false };
  }
  if (state.openFriend === uid) render();
}

function updateTabBadges() {
  const tab = $('#tabs .tab[data-view="friends"]');
  if (!tab) return;
  const n = state.friendReqIn.length;
  tab.dataset.badge = n > 0 ? String(n) : "";
  tab.classList.toggle("has-badge", n > 0);
}

function render() {
  const main = $("#main");
  updateTabBadges();
  if (!state.loaded) { main.innerHTML = `<div class="empty">Loading your data…</div>`; return; }
  if (state.view === "friends" && state.openFriend) return renderFriendProfile(main);
  ({
    dashboard: renderDashboard,
    tournaments: renderTournaments,
    matches: renderMatches,
    collection: renderCollection,
    decks: renderDecks,
    meta: renderMeta,
    stats: renderStats,
    team: renderTeam,
    friends: renderFriends,
  }[state.view] || renderDashboard)(main);
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function renderDashboard(main) {
  const { matches, tournaments, decks } = state;
  const played = matches.filter((m) => matchResult(m) !== "—");
  const wins = played.filter((m) => matchResult(m) === "W").length;
  const losses = played.length - wins;

  let gW = 0, gL = 0;
  const scored = {}; const conceded = {};
  for (const m of matches) for (const g of m.games || []) {
    if (g.winner === "me") { gW++; scored[g.finish] = (scored[g.finish] || 0) + 1; }
    else { gL++; conceded[g.finish] = (conceded[g.finish] || 0) + 1; }
  }

  const placements = tournaments
    .map((t) => Number(t.placement))
    .filter((n) => Number.isFinite(n) && n > 0);
  const best = placements.length ? Math.min(...placements) : null;

  // win rate by deck
  const byDeck = {};
  for (const m of played) {
    const key = m.myDeck || "Unspecified";
    byDeck[key] = byDeck[key] || { w: 0, l: 0 };
    if (matchResult(m) === "W") byDeck[key].w++; else byDeck[key].l++;
  }
  const deckRows = Object.entries(byDeck)
    .map(([name, r]) => ({ name, ...r, total: r.w + r.l, rate: r.w / (r.w + r.l) }))
    .sort((a, b) => b.total - a.total);

  const recent = [...played]
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 12);

  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

  const prof = state.profile || {};
  const teamTag = state.team ? (state.team.tag ? `[${state.team.tag}] ` : "") + state.team.name : "";
  const idMeta = [teamTag, prof.region, prof.homeStore].filter(Boolean).join(" · ");

  main.innerHTML = `
    <div class="view-head">
      <h1>Dashboard</h1>
      <p class="muted">${matches.length} matches · ${tournaments.length} tournaments</p>
    </div>

    <div class="identity">
      ${avatarHtml(displayName(), state.profile.photo, "avatar--lg")}
      <div>
        <div class="identity-name">${esc(displayName())}</div>
        <div class="identity-meta">${esc(idMeta || "Add your details from the profile menu")}</div>
      </div>
      ${prof.mainBey ? `<div class="identity-main"><span>Main Bey</span><b>${esc(prof.mainBey)}</b></div>` : ""}
    </div>

    <div class="stat-grid">
      ${statCard("Match win rate", pct(wins, played.length) + "%", `${wins}W – ${losses}L`)}
      ${statCard("Game win rate", pct(gW, gW + gL) + "%", `${gW}W – ${gL}L games`)}
      ${statCard("Tournaments", tournaments.length, best ? `Best finish: ${ordinal(best)}` : "No placements yet")}
      ${statCard("Decks tracked", decks.length, `${state.beys.length} parts in collection`)}
    </div>

    ${feedPanel()}

    ${played.length === 0 ? onboardingPanel() : `
      <section class="panel">
        <div class="row-between" style="margin-bottom:.6rem">
          <h2 style="margin:0">Recent form</h2>
          <button class="btn btn-ghost btn-sm" id="go-stats">Full stats →</button>
        </div>
        <div class="form-pills">
          ${recent.map((m) => `<span class="pill pill--${matchResult(m) === "W" ? "w" : "l"}" title="${esc(m.opponent || "?")} · ${fmtDate(m.date)}">${matchResult(m)}</span>`).join("")}
        </div>
      </section>
      ${achvPanel(true)}`}
  `;
  wireFeedClicks(main);
  const gs = $("#go-stats");
  if (gs) gs.addEventListener("click", () => switchView("stats"));
  const ga = $("#go-achv");
  if (ga) ga.addEventListener("click", () => switchView("stats"));
  $$("[data-goto]", main).forEach((b) =>
    b.addEventListener("click", () => {
      const v = b.dataset.goto;
      if (v === "dashboard") profileForm();
      else switchView(v);
    })
  );
}

function onboardingPanel() {
  const done = {
    parts: state.beys.length > 0,
    deck: state.decks.length > 0,
    match: state.matches.length > 0,
    profile: !!(state.profile.bladerName || state.profile.region),
  };
  const step = (ok, label, view) =>
    `<li class="ob-step${ok ? " is-done" : ""}"><span class="ob-check">${ok ? "✓" : ""}</span>
      <button class="btn-link" data-goto="${view}">${esc(label)}</button></li>`;
  return `<section class="panel">
    <h2>Get started</h2>
    <ul class="ob-list">
      ${step(done.parts, "Add your beys to the Collection", "collection")}
      ${step(done.deck, "Build a deck", "decks")}
      ${step(done.match, "Log your first match", "matches")}
      ${step(done.profile, "Fill in your profile", "dashboard")}
    </ul>
  </section>`;
}

function wireFeedClicks(root) {
  $$("[data-open-friend]", root).forEach((el) => {
    const uid = el.dataset.openFriend;
    if (!uid) return;
    const go = () => openFriendProfile(uid);
    el.addEventListener("click", go);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
}

function statCard(label, value, sub) {
  return `<div class="stat-card"><span class="stat-label">${esc(label)}</span>
    <span class="stat-value">${esc(value)}</span>
    <span class="stat-sub">${esc(sub)}</span></div>`;
}

function achvPanel(compact) {
  const list = state.achv || [];
  const done = list.filter((a) => a.done);
  const total = list.length;

  if (compact) {
    if (!done.length) return "";
    const recent = done.slice(-8);
    return `<section class="panel">
      <div class="row-between" style="margin-bottom:.6rem">
        <h2 style="margin:0">Achievements <span class="muted">${done.length}/${total}</span></h2>
        <button class="btn btn-ghost btn-sm" id="go-achv">See all →</button>
      </div>
      <div class="achv-row">${recent.map((a) => `<span class="achv-chip" title="${esc(a.name)} — ${esc(a.desc)}">${a.icon}</span>`).join("")}</div>
    </section>`;
  }

  return `<section class="panel">
    <h2>Achievements <span class="muted">${done.length}/${total}</span></h2>
    <div class="achv-grid">
      ${list.map((a) => `<div class="achv${a.done ? "" : " achv--locked"}">
        <span class="achv-icon">${a.icon}</span>
        <div class="achv-body">
          <div class="achv-name">${esc(a.name)}</div>
          <div class="muted small">${esc(a.desc)}</div>
          ${a.progress ? `<div class="achv-bar"><span style="width:${Math.round((a.progress.have / a.progress.need) * 100)}%"></span></div>
            <div class="muted small">${a.progress.have} / ${a.progress.need}</div>` : ""}
        </div>
        ${a.done ? `<span class="achv-tick">✓</span>` : ""}
      </div>`).join("")}
    </div>
  </section>`;
}

function feedPanel() {
  const f = state.feed || [];
  const vis = state.profile.feedVisibility === "public" ? "public" : "private";
  return `
    <section class="panel">
      <div class="row-between" style="margin-bottom:.7rem">
        <h2 style="margin:0">Friends activity</h2>
        <span class="chip${vis === "public" ? " chip--accent" : ""}">Your feed: ${vis}</span>
      </div>
      ${f.length === 0
        ? `<p class="muted small">Nothing here yet. Matches logged by friends who set their activity to <b>Public</b> (Edit profile) show up here.</p>`
        : `<ul class="feed">${f.map(feedItem).join("")}</ul>`}
    </section>`;
}

function feedItem(x) {
  const badge = x.kind === "match"
    ? `<span class="result-badge result-badge--${x.result === "W" ? "w" : "l"}">${x.result}</span>`
    : `<span class="result-badge result-badge--x">${x.placement ? ordinal(x.placement) : "—"}</span>`;
  return `<li class="feed-item is-clickable" data-open-friend="${esc(x.ownerUid || "")}" role="button" tabindex="0">
    ${avatarHtml(x.actorName, x.actorPhoto, "avatar--sm")}
    <div class="feed-body">
      <div class="feed-text">${feedText(x)}</div>
      <div class="muted small">${esc(relTime(x.createdAt))}${x.at ? " · " + fmtDate(x.at) : ""}</div>
    </div>
    ${badge}
  </li>`;
}

function feedText(x) {
  const who = `<b>${esc(x.actorName || "Blader")}</b>`;
  if (x.kind === "match") {
    const verb = x.result === "W" ? "beat" : "lost to";
    const score = (x.myScore || x.oppScore) ? ` ${x.myScore}–${x.oppScore}` : "";
    const deck = x.deck ? ` <span class="muted">· ${esc(x.deck)}</span>` : "";
    return `${who} ${verb} ${esc(x.opponent || "someone")}${score}${deck}`;
  }
  const rec = (x.wins != null || x.losses != null)
    ? ` <span class="muted">· ${Number(x.wins || 0)}–${Number(x.losses || 0)}</span>` : "";
  return `${who} placed ${esc(ordinal(x.placement || 0))} at ${esc(x.name || "a tournament")}${rec}`;
}

function finishBars(counts, total) {
  const rows = FINISHES.map((f) => {
    const n = counts[f.key] || 0;
    return `<div class="bar-row">
      <span class="bar-label">${esc(f.label)}</span>
      <div class="bar"><span style="width:${total ? Math.round((n / total) * 100) : 0}%"></span></div>
      <span class="bar-num">${n}</span></div>`;
  }).join("");
  return `<div class="bars">${rows}</div>`;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
function renderStats(main) {
  const played = state.matches
    .filter((m) => matchResult(m) !== "—")
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  if (played.length === 0) {
    main.innerHTML = `<div class="view-head"><h1>Stats</h1></div>
      <div class="empty">Log a few matches and your stats will build up here.</div>
      ${achvPanel(false)}`;
    return;
  }

  const wins = played.filter((m) => matchResult(m) === "W").length;
  const rate = Math.round((wins / played.length) * 100);

  let gW = 0, gL = 0;
  const scored = {}, conceded = {};
  for (const m of state.matches) for (const g of m.games || []) {
    if (g.winner === "me") { gW++; scored[g.finish] = (scored[g.finish] || 0) + 1; }
    else { gL++; conceded[g.finish] = (conceded[g.finish] || 0) + 1; }
  }

  const { current: cur, type: curType, longestWin: longestW } = streaks(played);

  // by month
  const months = {};
  for (const m of played) {
    const k = (m.date || "").slice(0, 7) || "unknown";
    months[k] = months[k] || { w: 0, n: 0 };
    months[k].n++;
    if (matchResult(m) === "W") months[k].w++;
  }
  const monthRows = Object.entries(months)
    .filter(([k]) => k !== "unknown")
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([k, v]) => ({ label: monthLabel(k), rate: v.w / v.n, n: v.n }));

  // head to head
  const h2h = groupRecord(played, (m) => (m.opponent || "").trim() || "Unknown");
  // matchup vs opponent deck
  const vsDeck = groupRecord(played, (m) => (m.opponentDeck || "").trim());
  const myDeck = groupRecord(played, (m) => (m.myDeck || "").trim() || "Unspecified");

  main.innerHTML = `
    <div class="view-head"><h1>Stats</h1><p class="muted">${played.length} rated matches</p></div>

    <div class="stat-grid">
      ${statCard("Match win rate", rate + "%", `${wins}W – ${played.length - wins}L`)}
      ${statCard("Game win rate", (gW + gL ? Math.round((gW / (gW + gL)) * 100) : 0) + "%", `${gW}W – ${gL}L games`)}
      ${statCard("Current streak", cur ? cur + (curType === "win" ? " W" : " L") : "—", curType ? `on a ${curType} streak` : "even")}
      ${statCard("Longest win streak", longestW || "—", "best run of wins")}
    </div>

    <section class="panel">
      <h2>Win rate by month</h2>
      ${monthRows.length ? `<div class="bars">${monthRows.map((r) => `
        <div class="bar-row">
          <span class="bar-label">${esc(r.label)}</span>
          <div class="bar"><span style="width:${Math.round(r.rate * 100)}%"></span></div>
          <span class="bar-num">${Math.round(r.rate * 100)}%</span>
        </div>`).join("")}</div>
        <p class="muted small">${monthRows.map((r) => r.n).reduce((a, b) => a + b, 0)} matches across ${monthRows.length} month${monthRows.length === 1 ? "" : "s"}</p>`
        : `<p class="muted">Add dates to your matches to see a trend.</p>`}
    </section>

    <div class="panel-row">
      <section class="panel"><h2>Finishes you scored</h2>${finishBars(scored, gW)}</section>
      <section class="panel"><h2>Finishes scored on you</h2>${finishBars(conceded, gL)}</section>
    </div>

    ${recordTable("Your decks", myDeck, "Deck")}
    ${recordTable("Head-to-head", h2h, "Opponent")}
    ${vsDeck.length ? recordTable("Vs. opponent bey / deck", vsDeck, "Their bey") : ""}

    ${achvPanel(false)}
  `;
}

function monthLabel(k) {
  const [y, m] = k.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return isNaN(d) ? k : d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function recordTable(title, rows, col) {
  if (!rows.length) return "";
  return `<section class="panel">
    <h2>${esc(title)}</h2>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>${esc(col)}</th><th>Record</th><th>Win rate</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${esc(r.name)}</td>
        <td>${r.w}–${r.l}</td>
        <td><div class="mini-bar"><span style="width:${Math.round(r.rate * 100)}%"></span></div> ${Math.round(r.rate * 100)}%</td>
      </tr>`).join("")}</tbody>
    </table></div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Tournaments
// ---------------------------------------------------------------------------
let tournamentQuery = "";

function renderTournaments(main) {
  const all = [...state.tournaments].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const q = tournamentQuery.trim().toLowerCase();
  const rows = q
    ? all.filter((t) => `${t.name || ""} ${t.location || ""} ${t.format || ""} ${t.notes || ""}`.toLowerCase().includes(q))
    : all;
  main.innerHTML = `
    <div class="view-head">
      <h1>Tournaments</h1>
      <button class="btn btn-primary" id="add-tournament">+ Add tournament</button>
    </div>
    ${all.length === 0 ? "" : `
    <div class="filter-bar">
      <input id="tq" placeholder="Search name / location / notes" value="${esc(tournamentQuery)}" />
      ${q ? `<button class="btn-link" id="tq-clear">clear</button>` : ""}
    </div>`}
    ${all.length === 0 ? `<div class="empty">No tournaments yet.</div>`
      : rows.length === 0 ? `<div class="empty">No tournaments match that search.</div>` : `
    <div class="card-list">
      ${rows.map((t) => {
        const mCount = state.matches.filter((m) => m.tournamentId === t.id).length;
        return `<article class="card">
          <div class="card-main">
            <h3>${esc(t.name || "Untitled tournament")}</h3>
            <p class="muted">${fmtDate(t.date)}${t.location ? " · " + esc(t.location) : ""}${t.format ? " · " + esc(t.format) : ""}</p>
            <div class="chips">
              ${t.placement ? `<span class="chip chip--accent">${esc(ordinalMaybe(t.placement))}</span>` : ""}
              ${t.wins != null || t.losses != null ? `<span class="chip">${Number(t.wins || 0)}–${Number(t.losses || 0)}</span>` : ""}
              <span class="chip">${mCount} match${mCount === 1 ? "" : "es"}</span>
            </div>
            ${t.notes ? `<p class="card-notes">${esc(t.notes)}</p>` : ""}
          </div>
          <div class="card-actions">
            <button class="btn btn-ghost btn-sm" data-edit="${t.id}">Edit</button>
            <button class="btn btn-ghost btn-sm danger" data-del="${t.id}">Delete</button>
          </div>
        </article>`;
      }).join("")}
    </div>`}
  `;
  $("#add-tournament").addEventListener("click", () => tournamentForm());
  $$("[data-edit]", main).forEach((b) =>
    b.addEventListener("click", () => tournamentForm(state.tournaments.find((t) => t.id === b.dataset.edit)))
  );
  $$("[data-del]", main).forEach((b) =>
    b.addEventListener("click", () => confirmDelete("tournaments", b.dataset.del, "tournament"))
  );
  const tq = $("#tq");
  if (tq) tq.addEventListener("input", debounce((e) => {
    tournamentQuery = e.target.value; render();
    const el = $("#tq"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, 200));
  const tqc = $("#tq-clear");
  if (tqc) tqc.addEventListener("click", () => { tournamentQuery = ""; render(); });
}

function ordinalMaybe(p) {
  const n = Number(p);
  return Number.isFinite(n) && n > 0 ? ordinal(n) : p;
}

function tournamentForm(existing) {
  const { form, values } = buildForm([
    { name: "name", label: "Tournament name", required: true, placeholder: "Local Store Challenge #4" },
    { name: "date", label: "Date", type: "date", default: today() },
    { name: "location", label: "Location", placeholder: "Hobby shop, city…" },
    { name: "format", label: "Format", type: "select", options: [
      "Swiss", "Single elimination", "Double elimination", "Round robin", "Swiss + Top cut", "Other",
    ].map((v) => ({ value: v, label: v })) },
    { name: "placement", label: "Final placement (number)", type: "number", min: 1, placeholder: "1" },
    { name: "wins", label: "Wins", type: "number", min: 0 },
    { name: "losses", label: "Losses", type: "number", min: 0 },
    { name: "notes", label: "Notes", type: "textarea", placeholder: "What worked, what to change…" },
  ], existing || {});

  bindSubmit(form, async () => {
    const v = values();
    const data = {
      name: v.name.trim(),
      date: v.date || "",
      location: v.location.trim(),
      format: v.format,
      placement: v.placement === "" ? null : Number(v.placement),
      wins: v.wins === "" ? null : Number(v.wins),
      losses: v.losses === "" ? null : Number(v.losses),
      notes: v.notes.trim(),
    };
    await save("tournaments", existing, data);
  });
  modal.open(existing ? "Edit tournament" : "Add tournament", form);
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------
const matchFilter = { q: "", result: "", deck: "" };

function renderMatches(main) {
  const all = [...state.matches].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const decks = [...new Set(all.map((m) => m.myDeck).filter(Boolean))];
  const f = matchFilter;
  const q = f.q.trim().toLowerCase();
  const rows = all.filter((m) => {
    if (f.result && matchResult(m) !== f.result) return false;
    if (f.deck && (m.myDeck || "") !== f.deck) return false;
    if (q) {
      const hay = `${m.opponent || ""} ${m.opponentDeck || ""} ${m.notes || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const last = all[0];

  main.innerHTML = `
    <div class="view-head">
      <h1>Matches</h1>
      <div class="head-actions">
        ${last ? `<button class="btn btn-ghost" id="repeat-match">Repeat last</button>` : ""}
        <button class="btn btn-ghost" id="live-score">⚡ Score live</button>
        <button class="btn btn-primary" id="add-match">+ Log match</button>
      </div>
    </div>
    ${all.length === 0 ? "" : `
    <div class="filter-bar">
      <input id="mf-q" placeholder="Search opponent / deck / notes" value="${esc(f.q)}" />
      <select id="mf-result">
        <option value="">All results</option>
        <option value="W"${f.result === "W" ? " selected" : ""}>Wins</option>
        <option value="L"${f.result === "L" ? " selected" : ""}>Losses</option>
      </select>
      ${decks.length ? `<select id="mf-deck">
        <option value="">All decks</option>
        ${decks.map((d) => `<option value="${esc(d)}"${f.deck === d ? " selected" : ""}>${esc(d)}</option>`).join("")}
      </select>` : ""}
      ${(f.q || f.result || f.deck) ? `<button class="btn-link" id="mf-clear">clear</button>` : ""}
    </div>`}
    ${all.length === 0 ? `<div class="empty">No matches logged yet.</div>`
      : rows.length === 0 ? `<div class="empty">No matches match that filter.</div>` : `
    <p class="muted small">${rows.length} of ${all.length} match${all.length === 1 ? "" : "es"}</p>
    <div class="card-list">
      ${rows.map((m) => {
        const res = matchResult(m);
        const { mine, opp } = matchScore(m);
        const tourney = state.tournaments.find((t) => t.id === m.tournamentId);
        return `<article class="card">
          <div class="card-main">
            <div class="match-top">
              <span class="result-badge result-badge--${res === "W" ? "w" : res === "L" ? "l" : "x"}">${res}</span>
              <h3>vs ${esc(m.opponent || "Unknown")}</h3>
              ${(mine || opp) ? `<span class="score">${mine}–${opp}</span>` : ""}
            </div>
            <p class="muted">${fmtDate(m.date)}${tourney ? " · " + esc(tourney.name) : ""}${m.myDeck ? " · " + esc(m.myDeck) : ""}${m.opponentDeck ? " vs " + esc(m.opponentDeck) : ""}</p>
            ${(m.games || []).length ? `<div class="game-line">
              ${m.games.map((g) => `<span class="game-tag game-tag--${g.winner === "me" ? "w" : "l"}">${g.winner === "me" ? "W" : "L"} · ${esc(finishLabel(g.finish))}</span>`).join("")}
            </div>` : ""}
            ${m.notes ? `<p class="card-notes">${esc(m.notes)}</p>` : ""}
          </div>
          <div class="card-actions">
            <button class="btn btn-ghost btn-sm" data-edit="${m.id}">Edit</button>
            <button class="btn btn-ghost btn-sm danger" data-del="${m.id}">Delete</button>
          </div>
        </article>`;
      }).join("")}
    </div>`}
  `;
  $("#add-match").addEventListener("click", () => matchForm());
  $("#live-score").addEventListener("click", () => liveScoring(last));
  const rep = $("#repeat-match");
  if (rep) rep.addEventListener("click", () => matchForm(null, last));
  $$("[data-edit]", main).forEach((b) =>
    b.addEventListener("click", () => matchForm(state.matches.find((m) => m.id === b.dataset.edit)))
  );
  $$("[data-del]", main).forEach((b) =>
    b.addEventListener("click", () => confirmDelete("matches", b.dataset.del, "match"))
  );

  const rerender = () => { render(); };
  const qEl = $("#mf-q");
  if (qEl) qEl.addEventListener("input", debounce((e) => { matchFilter.q = e.target.value; rerender(); const el = $("#mf-q"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 200));
  const rEl = $("#mf-result");
  if (rEl) rEl.addEventListener("change", (e) => { matchFilter.result = e.target.value; rerender(); });
  const dEl = $("#mf-deck");
  if (dEl) dEl.addEventListener("change", (e) => { matchFilter.deck = e.target.value; rerender(); });
  const cEl = $("#mf-clear");
  if (cEl) cEl.addEventListener("click", () => { matchFilter.q = ""; matchFilter.result = ""; matchFilter.deck = ""; rerender(); });
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function matchForm(existing, template) {
  const base = existing || (template
    ? { date: today(), tournamentId: template.tournamentId || null, myDeck: template.myDeck || "" }
    : {});
  const games = structuredClone(existing?.games || []);

  const deckOptions = [
    { value: "", label: "— none —" },
    ...state.decks.map((d) => ({ value: d.name, label: d.name })),
  ];

  const gamesSection = () => {
    const box = document.createElement("div");
    box.className = "games-editor";
    const draw = () => {
      box.innerHTML = `<div class="field"><span>Games</span></div>`;
      games.forEach((g, i) => {
        const row = document.createElement("div");
        row.className = "game-edit-row";
        row.innerHTML = `
          <select data-k="winner">
            <option value="me"${g.winner === "me" ? " selected" : ""}>I won</option>
            <option value="opp"${g.winner === "opp" ? " selected" : ""}>Opponent won</option>
          </select>
          <select data-k="finish">
            ${FINISHES.map((f) => `<option value="${f.key}"${g.finish === f.key ? " selected" : ""}>${f.label} (${f.pts}pt)</option>`).join("")}
          </select>
          <button type="button" class="btn btn-ghost btn-sm danger" data-rm="${i}">✕</button>`;
        row.querySelector('[data-k="winner"]').addEventListener("change", (e) => (games[i].winner = e.target.value));
        row.querySelector('[data-k="finish"]').addEventListener("change", (e) => (games[i].finish = e.target.value));
        row.querySelector("[data-rm]").addEventListener("click", () => { games.splice(i, 1); draw(); });
        box.append(row);
      });
      const add = document.createElement("button");
      add.type = "button";
      add.className = "btn btn-ghost btn-sm";
      add.textContent = "+ Add game";
      add.addEventListener("click", () => { games.push({ winner: "me", finish: "Spin" }); draw(); });
      box.append(add);
      const hint = document.createElement("p");
      hint.className = "muted small";
      hint.textContent = "First to 4 points wins. Leave empty and set the result manually below.";
      box.append(hint);
    };
    draw();
    return box;
  };

  const { form, values } = buildForm([
    { name: "date", label: "Date", type: "date", default: today() },
    { name: "tournamentId", label: "Tournament", type: "select", options: [
      { value: "", label: "— none / casual —" },
      ...state.tournaments.map((t) => ({ value: t.id, label: t.name || "Untitled" })),
    ] },
    { name: "opponent", label: "Opponent", required: true, placeholder: "Blader name" },
    { name: "myDeck", label: "My deck", type: "select", options: deckOptions },
    { name: "opponentDeck", label: "Opponent deck (optional)", placeholder: "e.g. Dran Sword" },
    { type: "custom", render: gamesSection },
    { name: "result", label: "Result (if no games above)", type: "select", options: [
      { value: "", label: "Auto from games" }, { value: "W", label: "Win" }, { value: "L", label: "Loss" },
    ] },
    { name: "notes", label: "Notes", type: "textarea" },
  ], base);

  bindSubmit(form, async () => {
    const v = values();
    const clean = games.filter((g) => g.winner && g.finish);
    const data = {
      date: v.date || "",
      tournamentId: v.tournamentId || null,
      opponent: v.opponent.trim(),
      myDeck: v.myDeck || "",
      opponentDeck: v.opponentDeck.trim(),
      games: clean,
      result: clean.length ? "" : v.result,
      notes: v.notes.trim(),
    };
    await save("matches", existing, data);
  });
  modal.open(existing ? "Edit match" : template ? "Log match (repeat)" : "Log match", form);
}

// ---------------------------------------------------------------------------
// Live scoring — full-screen, big-button, score a match at the table
// ---------------------------------------------------------------------------
const TARGET_POINTS = 4;

function liveScoring(template) {
  const s = {
    opponent: "",
    myDeck: template?.myDeck || "",
    tournamentId: template?.tournamentId || "",
    games: [],
  };

  const root = document.createElement("div");
  root.className = "live";
  document.body.append(root);
  document.body.style.overflow = "hidden";
  const close = () => { root.remove(); document.body.style.overflow = ""; };

  const points = () => {
    let me = 0, opp = 0;
    for (const g of s.games) (g.winner === "me" ? (me += finishPts(g.finish)) : (opp += finishPts(g.finish)));
    return { me, opp };
  };
  const done = () => {
    if (s.forceOpen) return false;
    const p = points();
    return p.me >= TARGET_POINTS || p.opp >= TARGET_POINTS;
  };

  const setup = () => {
    root.innerHTML = `
      <div class="live-inner">
        <div class="live-top"><h2>Score a match</h2><button class="btn btn-ghost btn-sm" data-x>Close</button></div>
        <form class="entry-form" id="live-setup">
          <label class="field"><span>Opponent</span><input id="l-opp" required placeholder="Blader name" autocomplete="off" /></label>
          <label class="field"><span>My deck</span>
            <select id="l-deck">
              <option value="">— none —</option>
              ${state.decks.map((d) => `<option value="${esc(d.name)}"${s.myDeck === d.name ? " selected" : ""}>${esc(d.name)}</option>`).join("")}
            </select>
          </label>
          <label class="field"><span>Tournament</span>
            <select id="l-tourney">
              <option value="">— casual —</option>
              ${state.tournaments.map((t) => `<option value="${esc(t.id)}"${s.tournamentId === t.id ? " selected" : ""}>${esc(t.name || "Untitled")}</option>`).join("")}
            </select>
          </label>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" data-x>Cancel</button>
            <button class="btn btn-primary">Start scoring</button>
          </div>
        </form>
      </div>`;
    root.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
    root.querySelector("#live-setup").addEventListener("submit", (e) => {
      e.preventDefault();
      s.opponent = root.querySelector("#l-opp").value.trim();
      s.myDeck = root.querySelector("#l-deck").value;
      s.tournamentId = root.querySelector("#l-tourney").value;
      board();
    });
  };

  const board = () => {
    const p = points();
    const finished = done();
    const res = p.me === p.opp ? "—" : p.me > p.opp ? "W" : "L";
    root.innerHTML = `
      <div class="live-inner live-board">
        <div class="live-top">
          <span class="muted">${esc(s.opponent || "Opponent")}${s.myDeck ? " · " + esc(s.myDeck) : ""}</span>
          <button class="btn btn-ghost btn-sm" data-x>Close</button>
        </div>

        <div class="live-score">
          <div class="live-side live-side--me"><span>YOU</span><b>${p.me}</b></div>
          <span class="live-dash">–</span>
          <div class="live-side live-side--opp"><span>OPP</span><b>${p.opp}</b></div>
        </div>

        ${finished
          ? `<div class="live-result live-result--${res === "W" ? "w" : "l"}">
              ${res === "W" ? "You win" : res === "L" ? "You lose" : "Tied"} ${p.me}–${p.opp}
             </div>
             <div class="live-actions">
               <button class="btn btn-primary btn-block" data-save>Save match</button>
               <button class="btn btn-ghost btn-block" data-continue>Keep scoring</button>
               <button class="btn btn-ghost btn-block danger" data-x>Discard</button>
             </div>`
          : `<p class="live-hint">First to ${TARGET_POINTS} points. Tap who won each game.</p>
             <div class="live-zones">
               <button class="live-zone live-zone--me" data-win="me">I won a game</button>
               <button class="live-zone live-zone--opp" data-win="opp">Opponent won</button>
             </div>
             ${(p.me >= TARGET_POINTS || p.opp >= TARGET_POINTS) ? `<button class="btn btn-primary btn-block" data-finish>Finish &amp; review</button>` : ""}`}

        ${s.games.length ? `<div class="live-games">
          ${s.games.map((g, i) => `<button class="live-game live-game--${g.winner === "me" ? "me" : "opp"}" data-undo="${i}" title="Tap to remove">
            ${g.winner === "me" ? "You" : "Opp"} · ${esc(finishLabel(g.finish))} +${finishPts(g.finish)}
          </button>`).join("")}
        </div>` : ""}
      </div>`;

    root.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
    root.querySelectorAll("[data-win]").forEach((b) =>
      b.addEventListener("click", () => finishPicker(b.dataset.win))
    );
    root.querySelectorAll("[data-undo]").forEach((b) =>
      b.addEventListener("click", () => { s.games.splice(Number(b.dataset.undo), 1); board(); })
    );
    const cont = root.querySelector("[data-continue]");
    if (cont) cont.addEventListener("click", () => { s.forceOpen = true; board(); });
    const fin = root.querySelector("[data-finish]");
    if (fin) fin.addEventListener("click", () => { s.forceOpen = false; board(); });
    const saveBtn = root.querySelector("[data-save]");
    if (saveBtn) saveBtn.addEventListener("click", (e) => runBtn(e.currentTarget, "Saving…", async () => {
      await save_(); close();
    }));
  };

  const finishPicker = (winner) => {
    const sheet = document.createElement("div");
    sheet.className = "live-picker";
    sheet.innerHTML = `
      <div class="live-picker-card">
        <h3>${winner === "me" ? "You won" : "Opponent won"} — how?</h3>
        <div class="live-picker-grid">
          ${FINISHES.map((f) => `<button class="btn btn-ghost" data-f="${f.key}">${f.label}<br><span class="muted">+${f.pts}</span></button>`).join("")}
          <button class="btn btn-ghost danger" data-cancel>Cancel</button>
        </div>
      </div>`;
    root.append(sheet);
    sheet.querySelector("[data-cancel]").addEventListener("click", () => sheet.remove());
    sheet.querySelectorAll("[data-f]").forEach((b) =>
      b.addEventListener("click", () => {
        s.games.push({ winner, finish: b.dataset.f });
        sheet.remove();
        board();
      })
    );
  };

  const save_ = async () => {
    const data = {
      date: today(),
      tournamentId: s.tournamentId || null,
      opponent: s.opponent.trim(),
      myDeck: s.myDeck || "",
      opponentDeck: "",
      games: s.games.map((g) => ({ winner: g.winner, finish: g.finish })),
      result: "",
      notes: "",
    };
    const id = store.newId("matches");
    try {
      await commit(store.createAt("matches", id, data));
    } catch (err) {
      toast(err.message || "Could not save.", "err");
      return;
    }
    patchLocalDoc("matches", id, data, true);
    postActivity("matches", id, data);
    publishPresence();
    if (state.view === "matches") render();
    toast("Match saved.");
  };

  setup();
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------
const PART_TYPES = ["Blade", "Ratchet", "Bit"];

function renderCollection(main) {
  main.innerHTML = `
    <div class="view-head">
      <h1>Collection</h1>
      <div class="head-actions">
        <button class="btn btn-ghost" id="bulk-bey">Bulk add</button>
        <button class="btn btn-primary" id="add-bey">+ Add part</button>
      </div>
    </div>
    ${state.beys.length === 0 ? `<div class="empty">No parts yet. Add your blades, ratchets and bits.</div>` : `
    <div class="collection-grid">
      ${PART_TYPES.map((type) => {
        const items = state.beys.filter((b) => b.type === type);
        return `<section class="panel">
          <h2>${type}s <span class="muted">(${items.length})</span></h2>
          ${items.length ? `<ul class="part-list">
            ${items.map((b) => `<li>
              <div><b>${esc(b.name)}</b>${b.notes ? `<span class="muted"> — ${esc(b.notes)}</span>` : ""}</div>
              <span class="row-actions">
                <button class="btn-link" data-edit="${b.id}">edit</button>
                <button class="btn-link danger" data-del="${b.id}">delete</button>
              </span>
            </li>`).join("")}
          </ul>` : `<p class="muted">—</p>`}
        </section>`;
      }).join("")}
    </div>`}
  `;
  $("#add-bey").addEventListener("click", () => beyForm());
  $("#bulk-bey").addEventListener("click", () => bulkBeyForm());
  $$("[data-edit]", main).forEach((b) =>
    b.addEventListener("click", () => beyForm(state.beys.find((x) => x.id === b.dataset.edit)))
  );
  $$("[data-del]", main).forEach((b) =>
    b.addEventListener("click", () => confirmDelete("beys", b.dataset.del, "part"))
  );
}

function beyForm(existing) {
  const { form, values } = buildForm([
    { name: "type", label: "Part type", type: "select", options: PART_TYPES.map((v) => ({ value: v, label: v })) },
    { name: "name", label: "Name", required: true, placeholder: "Dran Sword / 3-60 / Flat" },
    { name: "notes", label: "Notes", type: "textarea", placeholder: "Condition, source, weight…" },
  ], existing || {});
  bindSubmit(form, async () => {
    const v = values();
    await save("beys", existing, { type: v.type, name: v.name.trim(), notes: v.notes.trim() });
  });
  modal.open(existing ? "Edit part" : "Add part", form);
}

function bulkBeyForm() {
  const { form, values } = buildForm([
    { name: "Blade", label: "Blades — one per line", type: "textarea",
      placeholder: "Dran Sword\nHells Scythe\nWizard Arrow" },
    { name: "Ratchet", label: "Ratchets — one per line", type: "textarea",
      placeholder: "3-60\n9-60\n1-60" },
    { name: "Bit", label: "Bits — one per line", type: "textarea",
      placeholder: "Flat\nBall\nTaper" },
    { name: "skipExisting", label: "Skip names already in my collection", type: "checkbox", default: true },
  ]);

  bindSubmit(form, async () => {
    const v = values();
    const skip = v.skipExisting === "on";
    const have = new Set(state.beys.map((b) => (b.type + "|" + (b.name || "")).toLowerCase()));
    const seen = new Set();
    const rows = [];
    let skipped = 0;
    for (const type of PART_TYPES) {
      const lines = (v[type] || "").split("\n").map((s) => s.trim()).filter(Boolean);
      for (const name of lines) {
        const key = (type + "|" + name).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (skip && have.has(key)) { skipped++; continue; }
        rows.push({ type, name, notes: "" });
      }
    }
    if (!rows.length) {
      toast(skipped ? "Nothing new to add — those parts are already in your collection." : "Add at least one part name.", "warn");
      return;
    }
    await store.createMany("beys", rows);
    await refresh();
    modal.close();
    render();
    toast(`Added ${rows.length} part${rows.length === 1 ? "" : "s"}${skipped ? ` · ${skipped} skipped` : ""}.`);
  });
  modal.open("Bulk add parts", form);
}

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------
function renderDecks(main) {
  main.innerHTML = `
    <div class="view-head">
      <h1>Decks</h1>
      <button class="btn btn-primary" id="add-deck">+ Add deck</button>
    </div>
    ${state.decks.length === 0 ? `<div class="empty">No decks yet. Build a 3-Bey deck.</div>` : `
    <div class="card-list">
      ${state.decks.map((d) => {
        const used = state.matches.filter((m) => m.myDeck === d.name);
        const w = used.filter((m) => matchResult(m) === "W").length;
        const l = used.filter((m) => matchResult(m) === "L").length;
        return `<article class="card">
          <div class="card-main">
            <h3>${esc(d.name)}</h3>
            <ol class="combo-list">
              ${(d.combos || []).filter((c) => c.blade || c.ratchet || c.bit).map((c) =>
                `<li>${esc([c.blade, c.ratchet, c.bit].filter(Boolean).join(" "))}</li>`).join("") || "<li class='muted'>No combos set</li>"}
            </ol>
            <div class="chips">
              <span class="chip">${used.length} match${used.length === 1 ? "" : "es"}</span>
              ${used.length ? `<span class="chip chip--accent">${w}–${l}</span>` : ""}
            </div>
            ${d.notes ? `<p class="card-notes">${esc(d.notes)}</p>` : ""}
          </div>
          <div class="card-actions">
            <button class="btn btn-ghost btn-sm" data-edit="${d.id}">Edit</button>
            <button class="btn btn-ghost btn-sm danger" data-del="${d.id}">Delete</button>
          </div>
        </article>`;
      }).join("")}
    </div>`}
  `;
  $("#add-deck").addEventListener("click", () => deckForm());
  $$("[data-edit]", main).forEach((b) =>
    b.addEventListener("click", () => deckForm(state.decks.find((d) => d.id === b.dataset.edit)))
  );
  $$("[data-del]", main).forEach((b) =>
    b.addEventListener("click", () => confirmDelete("decks", b.dataset.del, "deck"))
  );
}

function deckForm(existing, seedCombo) {
  const combos = structuredClone(existing?.combos || (seedCombo ? [seedCombo, {}, {}] : [{}, {}, {}]));
  while (combos.length < 3) combos.push({});

  const comboSection = () => {
    const box = document.createElement("div");
    box.className = "combo-editor";
    box.innerHTML = `<div class="field"><span>Combos (Blade · Ratchet · Bit)</span></div>`;
    combos.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "combo-edit-row";
      row.innerHTML = `
        <input placeholder="Blade" value="${esc(c.blade || "")}" data-k="blade" list="blades-list" />
        <input placeholder="Ratchet" value="${esc(c.ratchet || "")}" data-k="ratchet" list="ratchets-list" />
        <input placeholder="Bit" value="${esc(c.bit || "")}" data-k="bit" list="bits-list" />`;
      row.querySelectorAll("input").forEach((inp) =>
        inp.addEventListener("input", (e) => (combos[i][e.target.dataset.k] = e.target.value.trim()))
      );
      box.append(row);
    });
    box.append(partDatalists());
    return box;
  };

  const { form, values } = buildForm([
    { name: "name", label: "Deck name", required: true, placeholder: "Attack Aggro",
      default: seedCombo ? `${seedCombo.blade} deck` : "" },
    { type: "custom", render: comboSection },
    { name: "notes", label: "Notes", type: "textarea" },
  ], existing || {});

  bindSubmit(form, async () => {
    const v = values();
    await save("decks", existing, {
      name: v.name.trim(),
      combos: combos.map((c) => ({ blade: c.blade || "", ratchet: c.ratchet || "", bit: c.bit || "" })),
      notes: v.notes.trim(),
    });
  });
  modal.open(existing ? "Edit deck" : "Add deck", form);
}

function partDatalists() {
  const frag = document.createDocumentFragment();
  const make = (id, type) => {
    const dl = document.createElement("datalist");
    dl.id = id;
    [...new Set(state.beys.filter((b) => b.type === type).map((b) => b.name))].forEach((n) => {
      const o = document.createElement("option");
      o.value = n;
      dl.append(o);
    });
    frag.append(dl);
  };
  make("blades-list", "Blade");
  make("ratchets-list", "Ratchet");
  make("bits-list", "Bit");
  return frag;
}

// ---------------------------------------------------------------------------
// Meta — curated tier list + community combo ratings
// ---------------------------------------------------------------------------
function ownsPart(name) {
  const n = String(name || "").trim().toLowerCase();
  return !!n && state.beys.some((b) => (b.name || "").trim().toLowerCase() === n);
}

async function loadMeta() {
  const [curated, community, votes] = await Promise.all([
    meta.loadCurated(),
    meta.listCombos().catch(() => []),
    store.list("metaVotes").catch(() => []),
  ]);
  state.myVotes = {};
  for (const v of votes) state.myVotes[v.id] = v.tier;

  const byKey = new Map();
  for (const c of curated.combos || []) {
    const key = meta.comboKey(c.blade, c.ratchet, c.bit);
    byKey.set(key, {
      key, blade: c.blade, ratchet: c.ratchet, bit: c.bit, role: c.role || "",
      officialTier: c.tier || null, trend: c.trend || null, note: c.note || "",
      tally: {}, count: 0,
    });
  }
  for (const c of community) {
    const cur = byKey.get(c.key);
    if (cur) { cur.tally = c.tally || {}; cur.count = c.count || 0; }
    else byKey.set(c.key, {
      key: c.key, blade: c.blade, ratchet: c.ratchet, bit: c.bit, role: c.role || "",
      officialTier: null, trend: "new", note: "",
      tally: c.tally || {}, count: c.count || 0, addedByName: c.addedByName,
    });
  }

  state.meta = {
    updated: curated.updated,
    refreshedAt: curated.refreshedAt || null,
    note: curated.note,
    roles: curated.roles || ["Attack", "Stamina", "Defense", "Balance"],
    blades: curated.blades || [],
    ratchets: curated.ratchets || [],
    bits: curated.bits || [],
    combos: [...byKey.values()].map((c) => ({
      ...c,
      cons: meta.consensus(c.tally, c.count),
      owned: [c.blade, c.ratchet, c.bit].filter(ownsPart).length,
    })),
  };
}

const TIER_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };

function renderMeta(main) {
  if (!state.meta) {
    main.innerHTML = `<div class="view-head"><h1>Meta</h1></div><div class="empty">Loading the meta…</div>`;
    loadMeta().then(() => { if (state.view === "meta") renderMeta(main); })
      .catch((err) => { main.innerHTML = `<div class="view-head"><h1>Meta</h1></div><div class="empty">${esc(err.message || "Couldn't load the meta.")}</div>`; });
    return;
  }

  const m = state.meta;
  const tabs = [["combos", "Combos"], ["blades", "Blades"], ["ratchets", "Ratchets"], ["bits", "Bits"]];

  main.innerHTML = `
    <div class="view-head">
      <h1>Meta</h1>
      <button class="btn btn-primary" id="add-combo">+ Add combo</button>
    </div>
    <p class="muted small">${esc(m.note)}
      <b>${m.refreshedAt ? `Combos refreshed weekly — last: ${fmtDate((m.refreshedAt || "").slice(0, 10))}.` : `Snapshot: ${esc(m.updated)}.`}</b></p>
    <div class="seg" id="meta-tabs">
      ${tabs.map(([k, l]) => `<button class="seg-btn${state.metaTab === k ? " is-active" : ""}" data-mt="${k}">${l}</button>`).join("")}
    </div>
    <div id="meta-panel"></div>
  `;

  $("#add-combo").addEventListener("click", () => addComboForm());
  $$("#meta-tabs .seg-btn").forEach((b) =>
    b.addEventListener("click", () => { state.metaTab = b.dataset.mt; renderMeta(main); })
  );

  const panel = $("#meta-panel");
  if (state.metaTab === "combos") metaCombosPanel(panel);
  else metaPartsPanel(panel, state.metaTab);
}

const TREND_MARK = { up: "▲", down: "▼", new: "★", same: "" };

function metaTierRank(c) {
  return TIER_RANK[c.officialTier] ?? (c.cons.letter ? TIER_RANK[c.cons.letter] : 9);
}

function metaCombosPanel(panel) {
  const rows = [...state.meta.combos];
  const sort = state.metaSort;
  rows.sort((a, b) => {
    if (sort === "tier") return metaTierRank(a) - metaTierRank(b) || b.cons.score - a.cons.score;
    if (sort === "votes") return b.cons.count - a.cons.count;
    if (sort === "owned") return b.owned - a.owned || metaTierRank(a) - metaTierRank(b);
    return b.cons.score - a.cons.score || metaTierRank(a) - metaTierRank(b);
  });

  panel.innerHTML = `
    <div class="filter-bar">
      <label class="muted small">Sort</label>
      <select id="meta-sort">
        <option value="community"${sort === "community" ? " selected" : ""}>Live community rating</option>
        <option value="tier"${sort === "tier" ? " selected" : ""}>This week's tier</option>
        <option value="votes"${sort === "votes" ? " selected" : ""}>Most votes</option>
        <option value="owned"${sort === "owned" ? " selected" : ""}>Parts I own</option>
      </select>
    </div>
    <div class="card-list">
      ${rows.map((c) => {
        const mine = state.myVotes[c.key];
        const trend = TREND_MARK[c.trend] || "";
        return `<article class="card meta-combo">
          <div class="card-main">
            <div class="match-top">
              ${c.officialTier ? `<span class="tier tier--${c.officialTier}">${c.officialTier}</span>` : ""}
              ${trend ? `<span class="trend trend--${c.trend}" title="${c.trend === "up" ? "moved up this week" : c.trend === "down" ? "moved down this week" : "new this week"}">${trend}</span>` : ""}
              <h3>${esc([c.blade, c.ratchet, c.bit].filter(Boolean).join(" "))}</h3>
            </div>
            <div class="chips">
              ${c.role ? `<span class="chip">${esc(c.role)}</span>` : ""}
              ${c.cons.letter ? `<span class="chip chip--accent">Live ${c.cons.letter} · ${c.cons.score.toFixed(1)} (${c.cons.count})</span>` : `<span class="chip">Unrated</span>`}
              <span class="chip${c.owned === 3 ? " chip--accent" : ""}">Own ${c.owned}/3</span>
            </div>
            ${c.note ? `<p class="card-notes">${esc(c.note)}</p>` : ""}
            <div class="tier-vote" data-key="${esc(c.key)}">
              <span class="muted small">Your rating:</span>
              ${meta.TIERS.map((t) => `<button class="tier-btn${mine === t ? " is-mine" : ""}" data-tier="${t}">${t}</button>`).join("")}
            </div>
          </div>
          <div class="card-actions">
            <button class="btn btn-ghost btn-sm" data-deck='${esc(JSON.stringify({ blade: c.blade, ratchet: c.ratchet, bit: c.bit }))}'>+ Deck</button>
          </div>
        </article>`;
      }).join("")}
    </div>`;

  $("#meta-sort").addEventListener("change", (e) => { state.metaSort = e.target.value; renderMeta($("#main")); });

  $$(".tier-vote .tier-btn", panel).forEach((b) =>
    b.addEventListener("click", (e) => {
      const key = e.target.closest(".tier-vote").dataset.key;
      const combo = state.meta.combos.find((c) => c.key === key);
      const tier = b.dataset.tier;
      runBtn(b, tier, async () => {
        await meta.castVote(combo, tier);
        await store.setOne("metaVotes", key, { tier });
        await loadMeta();
        renderMeta($("#main"));
        toast(`Rated ${combo.blade} ${tier}.`);
      });
    })
  );

  $$("[data-deck]", panel).forEach((b) =>
    b.addEventListener("click", () => {
      try { deckForm(null, JSON.parse(b.dataset.deck)); } catch { deckForm(); }
    })
  );
}

function metaPartsPanel(panel, kind) {
  const items = state.meta[kind] || [];
  const roles = ["", ...state.meta.roles];
  state.metaRoleFilter = state.metaRoleFilter || "";
  const rf = state.metaRoleFilter;
  const hasRoles = items.some((i) => i.role);
  const filtered = rf ? items.filter((i) => i.role === rf) : items;
  const byTier = { S: [], A: [], B: [], C: [], D: [] };
  for (const i of filtered) (byTier[i.tier] || byTier.B).push(i);

  panel.innerHTML = `
    ${hasRoles ? `<div class="filter-bar">
      ${roles.map((r) => `<button class="chip${rf === r ? " chip--accent" : ""}" data-role="${esc(r)}">${r || "All"}</button>`).join("")}
    </div>` : ""}
    ${["S", "A", "B", "C", "D"].filter((t) => byTier[t].length).map((t) => `
      <section class="panel">
        <h2><span class="tier tier--${t}">${t}</span> tier</h2>
        <ul class="part-list">
          ${byTier[t].map((i) => `<li>
            <div><b>${esc(i.name)}</b>${i.line ? ` <span class="chip">${esc(i.line)}</span>` : ""}${i.role ? ` <span class="chip">${esc(i.role)}</span>` : ""}
              ${i.note ? `<div class="muted small">${esc(i.note)}</div>` : ""}</div>
            ${ownsPart(i.name) ? `<span class="chip chip--accent">owned</span>` : ""}
          </li>`).join("")}
        </ul>
      </section>`).join("")}
  `;

  $$("[data-role]", panel).forEach((b) =>
    b.addEventListener("click", () => { state.metaRoleFilter = b.dataset.role; renderMeta($("#main")); })
  );
}

function addComboForm() {
  const { form, values } = buildForm([
    { name: "blade", label: "Blade", required: true, placeholder: "e.g. Dran Buster" },
    { name: "ratchet", label: "Ratchet", required: true, placeholder: "e.g. 3-60" },
    { name: "bit", label: "Bit", required: true, placeholder: "e.g. Flat" },
    { name: "role", label: "Role", type: "select", options: ["Attack", "Stamina", "Defense", "Balance"].map((v) => ({ value: v, label: v })) },
  ], {});
  // datalists from the user's collection
  form.append(partDatalists());
  form.querySelector('[name="blade"]').setAttribute("list", "blades-list");
  form.querySelector('[name="ratchet"]').setAttribute("list", "ratchets-list");
  form.querySelector('[name="bit"]').setAttribute("list", "bits-list");

  bindSubmit(form, async () => {
    const v = values();
    const combo = { blade: v.blade.trim(), ratchet: v.ratchet.trim(), bit: v.bit.trim(), role: v.role };
    await meta.addCombo(combo);
    await loadMeta();
    modal.close();
    state.metaTab = "combos";
    renderMeta($("#main"));
    toast("Combo added — rate it to seed the tier.");
  });
  modal.open("Add a combo to the meta list", form);
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------
function isTeamOwner() {
  return state.team && auth.currentUser && state.team.ownerUid === auth.currentUser.uid;
}

function myMemberRow() {
  return auth.currentUser
    ? state.teamMembers.find((m) => m.uid === auth.currentUser.uid) || null
    : null;
}

/** Owner, or a member the owner promoted to "editor". */
function canManageTeam() {
  if (isTeamOwner()) return true;
  const me = myMemberRow();
  return !!me && me.role === "editor";
}

function renderTeam(main) {
  if (!state.team) return renderTeamJoin(main);

  const t = state.team;
  const tabs = [
    ["roster", "Roster"],
    ["battles", "Team battles"],
    ["events", "Team events"],
    ["about", "About / settings"],
  ];

  main.innerHTML = `
    <div class="view-head">
      <h1>${esc(t.name)}${t.tag ? ` <span class="muted">[${esc(t.tag)}]</span>` : ""}</h1>
      <button class="btn btn-ghost btn-sm" id="copy-code">Invite code: ${esc(t.inviteCode)}</button>
    </div>

    <div class="team-banner" style="--team:${cssColor(t.color)}">
      <div class="team-crest">${esc((t.tag || t.name || "T").slice(0, 3).toUpperCase())}</div>
      <div>
        <div class="identity-meta">${esc([t.region, t.founded ? "est. " + t.founded : ""].filter(Boolean).join(" · ") || "—")}</div>
        ${t.bio ? `<p class="card-notes">${esc(t.bio)}</p>` : ""}
      </div>
      <div class="identity-main"><span>Members</span><b>${state.teamMembers.length}</b></div>
    </div>

    <div class="seg" id="team-tabs">
      ${tabs.map(([k, label]) => `<button class="seg-btn${state.teamTab === k ? " is-active" : ""}" data-tt="${k}">${label}</button>`).join("")}
    </div>

    <div id="team-panel"></div>
  `;

  $("#copy-code").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(t.inviteCode); toast("Invite code copied."); }
    catch { toast(t.inviteCode, "warn"); }
  });
  $$("#team-tabs .seg-btn").forEach((b) =>
    b.addEventListener("click", () => { state.teamTab = b.dataset.tt; renderTeam(main); })
  );

  const panel = $("#team-panel");
  ({
    roster: teamRoster,
    battles: teamBattles,
    events: teamEvents,
    about: teamAbout,
  }[state.teamTab] || teamRoster)(panel);
}

function cssColor(c) {
  return /^#[0-9a-f]{3,8}$/i.test(String(c || "")) ? c : "#2b7dff";
}

function teamRoster(panel) {
  const rows = [...state.teamMembers].map((m) => {
    const s = m.stats || {};
    const mw = Number(s.matchW || 0), ml = Number(s.matchL || 0);
    return { ...m, mw, ml, total: mw + ml, rate: mw + ml ? mw / (mw + ml) : 0,
      gw: Number(s.gameW || 0), gl: Number(s.gameL || 0), tn: Number(s.tournaments || 0), best: s.bestPlacement };
  }).sort((a, b) => b.rate - a.rate || b.total - a.total);

  const owner = isTeamOwner();
  panel.innerHTML = `
    <div class="row-between">
      <p class="muted small">Ranked by match win rate. Records update when each member logs matches.</p>
      <button class="btn btn-ghost btn-sm" id="sync-stats">Sync my record</button>
    </div>
    <section class="panel">
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>#</th><th>Blader</th><th>Matches</th><th>Win rate</th><th>Games</th><th>Events</th><th>Best</th>${owner ? "<th>Manage</th>" : ""}</tr></thead>
        <tbody>
          ${rows.map((r, i) => `<tr>
            <td>${i + 1}</td>
            <td><span class="roster-name">${avatarHtml(r.bladerName, r.photo, "avatar--sm")}<span>${esc(r.bladerName || "Blader")}</span></span>${r.role === "owner" ? ` <span class="chip chip--accent">owner</span>` : ""}${r.role === "editor" ? ` <span class="chip chip--accent">editor</span>` : ""}${r.uid === auth.currentUser.uid ? ` <span class="chip">you</span>` : ""}</td>
            <td>${r.mw}–${r.ml}</td>
            <td><div class="mini-bar"><span style="width:${Math.round(r.rate * 100)}%"></span></div> ${Math.round(r.rate * 100)}%</td>
            <td>${r.gw}–${r.gl}</td>
            <td>${r.tn}</td>
            <td>${r.best ? ordinal(r.best) : "—"}</td>
            ${owner ? `<td class="row-actions">${r.uid === state.team.ownerUid ? "<span class='muted'>—</span>" : `
              <button class="btn-link" data-role="${r.uid}" data-to="${r.role === "editor" ? "member" : "editor"}">${r.role === "editor" ? "revoke editor" : "make editor"}</button>
              <button class="btn-link danger" data-kick="${r.uid}">remove</button>`}</td>` : ""}
          </tr>`).join("")}
        </tbody>
      </table></div>
      ${owner ? `<p class="muted small">Editors can change team info and regenerate the invite code. Only you can remove members or delete the team.</p>` : ""}
    </section>
  `;
  $("#sync-stats").addEventListener("click", (e) =>
    runBtn(e.currentTarget, "Syncing…", async () => {
      await publishMyStats();
      await refreshTeam();
      renderTeam($("#main"));
      toast("Your record is up to date.");
    })
  );
  $$("[data-role]", panel).forEach((b) =>
    b.addEventListener("click", (e) =>
      runBtn(e.currentTarget, "…", async () => {
        await teams.setMemberRole(state.team.id, b.dataset.role, b.dataset.to);
        await refreshTeam();
        renderTeam($("#main"));
        toast(b.dataset.to === "editor" ? "Member can now edit team info." : "Editor access removed.");
      })
    )
  );
  $$("[data-kick]", panel).forEach((b) =>
    b.addEventListener("click", () => confirmTeamAction(
      "Remove member", "Remove this blader from the team?",
      async () => { await teams.removeMember(state.team.id, b.dataset.kick); await refreshTeam(); renderTeam($("#main")); toast("Member removed."); }
    ))
  );
}

function teamBattles(panel) {
  const rows = state.teamBattles;
  panel.innerHTML = `
    <div class="row-between">
      <p class="muted small">3v3 and squad battles against other teams.</p>
      <button class="btn btn-primary btn-sm" id="add-battle">+ Log team battle</button>
    </div>
    ${rows.length === 0 ? `<div class="empty">No team battles logged yet.</div>` : `
    <div class="card-list">
      ${rows.map((b) => {
        const res = b.teamResult || autoTeamResult(b);
        return `<article class="card">
          <div class="card-main">
            <div class="match-top">
              <span class="result-badge result-badge--${res === "W" ? "w" : res === "L" ? "l" : "x"}">${res || "—"}</span>
              <h3>vs ${esc(b.opponentTeam || "Unknown team")}</h3>
              ${b.format ? `<span class="score">${esc(b.format)}</span>` : ""}
            </div>
            <p class="muted">${fmtDate(b.date)}${b.event ? " · " + esc(b.event) : ""}${b.createdByName ? " · logged by " + esc(b.createdByName) : ""}</p>
            ${(b.lineup || []).length ? `<div class="game-line">
              ${b.lineup.map((l) => `<span class="game-tag game-tag--${l.result === "W" ? "w" : "l"}">${esc(l.player || "?")} ${l.result || "?"}${l.opponent ? " vs " + esc(l.opponent) : ""}</span>`).join("")}
            </div>` : ""}
            ${b.notes ? `<p class="card-notes">${esc(b.notes)}</p>` : ""}
          </div>
          <div class="card-actions">
            <button class="btn btn-ghost btn-sm" data-edit="${b.id}">Edit</button>
            <button class="btn btn-ghost btn-sm danger" data-del="${b.id}">Delete</button>
          </div>
        </article>`;
      }).join("")}
    </div>`}
  `;
  $("#add-battle").addEventListener("click", () => battleForm());
  $$("[data-edit]", panel).forEach((b) =>
    b.addEventListener("click", () => battleForm(state.teamBattles.find((x) => x.id === b.dataset.edit)))
  );
  $$("[data-del]", panel).forEach((b) =>
    b.addEventListener("click", () => confirmTeamAction(
      "Delete battle", "Delete this team battle?",
      async () => { await teams.removeBattle(state.team.id, b.dataset.del); await refreshTeam(); renderTeam($("#main")); toast("Battle deleted."); }
    ))
  );
}

function autoTeamResult(b) {
  const w = (b.lineup || []).filter((l) => l.result === "W").length;
  const l = (b.lineup || []).filter((l) => l.result === "L").length;
  if (!w && !l) return "";
  return w === l ? "D" : w > l ? "W" : "L";
}

function battleForm(existing) {
  const lineup = structuredClone(existing?.lineup || [{}, {}, {}]);
  const memberNames = state.teamMembers.map((m) => m.bladerName || "Blader");

  const lineupSection = () => {
    const box = document.createElement("div");
    box.className = "games-editor";
    const draw = () => {
      box.innerHTML = `<div class="field"><span>Line-up (your blader · result · their blader)</span></div>`;
      lineup.forEach((l, i) => {
        const row = document.createElement("div");
        row.className = "lineup-edit-row";
        row.innerHTML = `
          <input placeholder="Your blader" value="${esc(l.player || "")}" data-k="player" list="team-members-list" />
          <select data-k="result">
            <option value="">?</option>
            <option value="W"${l.result === "W" ? " selected" : ""}>Win</option>
            <option value="L"${l.result === "L" ? " selected" : ""}>Loss</option>
          </select>
          <input placeholder="Their blader" value="${esc(l.opponent || "")}" data-k="opponent" />
          <button type="button" class="btn btn-ghost btn-sm danger" data-rm="${i}">✕</button>`;
        row.querySelectorAll("[data-k]").forEach((inp) =>
          inp.addEventListener("input", (e) => (lineup[i][e.target.dataset.k] = e.target.value)));
        row.querySelector("[data-rm]").addEventListener("click", () => { lineup.splice(i, 1); draw(); });
        box.append(row);
      });
      const add = document.createElement("button");
      add.type = "button"; add.className = "btn btn-ghost btn-sm"; add.textContent = "+ Add blader";
      add.addEventListener("click", () => { lineup.push({}); draw(); });
      box.append(add);
      const dl = document.createElement("datalist");
      dl.id = "team-members-list";
      memberNames.forEach((n) => { const o = document.createElement("option"); o.value = n; dl.append(o); });
      box.append(dl);
    };
    draw();
    return box;
  };

  const { form, values } = buildForm([
    { name: "date", label: "Date", type: "date", default: today() },
    { name: "opponentTeam", label: "Opponent team", required: true, placeholder: "Team name" },
    { name: "format", label: "Format", type: "select", options: ["3v3", "5v5", "1v1", "2v2", "Other"].map((v) => ({ value: v, label: v })) },
    { name: "event", label: "Event (optional)", placeholder: "League night, regional…" },
    { type: "custom", render: lineupSection },
    { name: "teamResult", label: "Team result", type: "select", options: [
      { value: "", label: "Auto from line-up" }, { value: "W", label: "Win" }, { value: "L", label: "Loss" }, { value: "D", label: "Draw" },
    ] },
    { name: "notes", label: "Notes", type: "textarea" },
  ], existing || {});

  bindSubmit(form, async () => {
    const v = values();
    const clean = lineup.filter((l) => (l.player || "").trim() || l.result);
    const data = {
      date: v.date || "",
      opponentTeam: v.opponentTeam.trim(),
      format: v.format,
      event: v.event.trim(),
      lineup: clean.map((l) => ({ player: (l.player || "").trim(), result: l.result || "", opponent: (l.opponent || "").trim() })),
      teamResult: v.teamResult,
      notes: v.notes.trim(),
      createdByName: displayName(),
    };
    try {
      if (existing) await teams.updateBattle(state.team.id, existing.id, data);
      else await teams.addBattle(state.team.id, data);
      await refreshTeam();
      modal.close();
      renderTeam($("#main"));
      toast("Saved.");
    } catch (err) { console.error(err); toast(err.message || "Could not save.", "err"); }
  });
  modal.open(existing ? "Edit team battle" : "Log team battle", form);
}

function teamEvents(panel) {
  const rows = state.teamEvents;
  panel.innerHTML = `
    <div class="row-between">
      <p class="muted small">Tournaments your team entered as a squad.</p>
      <button class="btn btn-primary btn-sm" id="add-event">+ Add team event</button>
    </div>
    ${rows.length === 0 ? `<div class="empty">No team events yet.</div>` : `
    <div class="card-list">
      ${rows.map((ev) => `<article class="card">
        <div class="card-main">
          <h3>${esc(ev.name || "Untitled event")}</h3>
          <p class="muted">${fmtDate(ev.date)}${ev.location ? " · " + esc(ev.location) : ""}${ev.format ? " · " + esc(ev.format) : ""}</p>
          <div class="chips">
            ${ev.placement ? `<span class="chip chip--accent">${esc(ordinalMaybe(ev.placement))}</span>` : ""}
            ${ev.wins != null || ev.losses != null ? `<span class="chip">${Number(ev.wins || 0)}–${Number(ev.losses || 0)}</span>` : ""}
            ${ev.roster ? `<span class="chip">${esc(ev.roster)}</span>` : ""}
          </div>
          ${ev.notes ? `<p class="card-notes">${esc(ev.notes)}</p>` : ""}
        </div>
        <div class="card-actions">
          <button class="btn btn-ghost btn-sm" data-edit="${ev.id}">Edit</button>
          <button class="btn btn-ghost btn-sm danger" data-del="${ev.id}">Delete</button>
        </div>
      </article>`).join("")}
    </div>`}
  `;
  $("#add-event").addEventListener("click", () => teamEventForm());
  $$("[data-edit]", panel).forEach((b) =>
    b.addEventListener("click", () => teamEventForm(state.teamEvents.find((x) => x.id === b.dataset.edit)))
  );
  $$("[data-del]", panel).forEach((b) =>
    b.addEventListener("click", () => confirmTeamAction(
      "Delete event", "Delete this team event?",
      async () => { await teams.removeEvent(state.team.id, b.dataset.del); await refreshTeam(); renderTeam($("#main")); toast("Event deleted."); }
    ))
  );
}

function teamEventForm(existing) {
  const { form, values } = buildForm([
    { name: "name", label: "Event name", required: true, placeholder: "Regional Team Cup" },
    { name: "date", label: "Date", type: "date", default: today() },
    { name: "location", label: "Location" },
    { name: "format", label: "Format", type: "select", options: ["3v3", "5v5", "Team Swiss", "Other"].map((v) => ({ value: v, label: v })) },
    { name: "placement", label: "Team placement (number)", type: "number", min: 1 },
    { name: "wins", label: "Wins", type: "number", min: 0 },
    { name: "losses", label: "Losses", type: "number", min: 0 },
    { name: "roster", label: "Roster (names)", placeholder: "Bird, Rin, Ohtori" },
    { name: "notes", label: "Notes", type: "textarea" },
  ], existing || {});
  bindSubmit(form, async () => {
    const v = values();
    const data = {
      name: v.name.trim(), date: v.date || "", location: v.location.trim(), format: v.format,
      placement: v.placement === "" ? null : Number(v.placement),
      wins: v.wins === "" ? null : Number(v.wins),
      losses: v.losses === "" ? null : Number(v.losses),
      roster: v.roster.trim(), notes: v.notes.trim(), createdByName: displayName(),
    };
    try {
      if (existing) await teams.updateEvent(state.team.id, existing.id, data);
      else await teams.addEvent(state.team.id, data);
      await refreshTeam();
      modal.close();
      renderTeam($("#main"));
      toast("Saved.");
    } catch (err) { console.error(err); toast(err.message || "Could not save.", "err"); }
  });
  modal.open(existing ? "Edit team event" : "Add team event", form);
}

function teamAbout(panel) {
  const t = state.team;
  const owner = isTeamOwner();
  const manage = canManageTeam();
  const editors = state.teamMembers.filter((m) => m.role === "editor").map((m) => m.bladerName || "Blader");
  panel.innerHTML = `
    <section class="panel">
      <h2>Team info</h2>
      <dl class="kv">
        <dt>Name</dt><dd>${esc(t.name)}</dd>
        <dt>Tag</dt><dd>${esc(t.tag || "—")}</dd>
        <dt>Region</dt><dd>${esc(t.region || "—")}</dd>
        <dt>Founded</dt><dd>${esc(t.founded || "—")}</dd>
        <dt>Invite code</dt><dd><code>${esc(t.inviteCode)}</code></dd>
        <dt>Editors</dt><dd>${editors.length ? esc(editors.join(", ")) : "<span class='muted'>none — owner only</span>"}</dd>
      </dl>
      ${t.bio ? `<p class="card-notes">${esc(t.bio)}</p>` : ""}
      ${!manage ? `<p class="muted small">Only the owner${editors.length ? " and editors" : ""} can change team info. ${owner ? "" : "Ask the owner to make you an editor from the Roster tab."}</p>` : ""}
    </section>
    <div class="row-between">
      ${manage ? `<button class="btn btn-ghost btn-sm" id="edit-team">Edit team</button>
                  <button class="btn btn-ghost btn-sm" id="new-code">Regenerate invite code</button>` : ""}
      ${owner ? `<button class="btn btn-ghost btn-sm danger" id="del-team">Delete team</button>` : ""}
      ${!owner ? `<button class="btn btn-ghost btn-sm danger" id="leave-team">Leave team</button>` : ""}
    </div>
  `;
  if (manage) {
    $("#edit-team").addEventListener("click", () => teamForm(t));
    $("#new-code").addEventListener("click", () => confirmTeamAction(
      "Regenerate code", "The old invite code stops working immediately. Continue?",
      async () => { await teams.regenerateCode(t.id, t.inviteCode); await refreshTeam(); renderTeam($("#main")); toast("New invite code generated."); }
    ));
  }
  if (owner) {
    $("#del-team").addEventListener("click", () => confirmTeamAction(
      "Delete team", "This permanently deletes the team, its roster, battles and events for everyone. This can't be undone.",
      async () => {
        await teams.deleteTeam(t.id);
        await store.setOne("profile", "main", { teamId: "" });
        state.profile.teamId = "";
        await refreshTeam();
        renderTeam($("#main"));
        toast("Team deleted.");
      }
    ));
  } else {
    $("#leave-team").addEventListener("click", () => confirmTeamAction(
      "Leave team", "Leave this team? Your personal journey data stays with you.",
      async () => {
        await teams.leaveTeam(t.id);
        await store.setOne("profile", "main", { teamId: "" });
        state.profile.teamId = "";
        await refreshTeam();
        renderTeam($("#main"));
        toast("You left the team.");
      }
    ));
  }
}

function renderTeamJoin(main) {
  main.innerHTML = `
    <div class="view-head"><h1>Team</h1></div>
    <div class="panel-row">
      <section class="panel">
        <h2>Join a team</h2>
        <p class="muted small">Ask a teammate for the 6-character invite code.</p>
        <form id="join-form" class="entry-form">
          <label class="field"><span>Invite code</span><input id="join-code" maxlength="6" placeholder="ABC123" style="text-transform:uppercase" required /></label>
          <div class="form-actions"><button class="btn btn-primary">Join team</button></div>
        </form>
      </section>
      <section class="panel">
        <h2>Start a team</h2>
        <p class="muted small">You'll be the owner and get an invite code to share.</p>
        <div class="form-actions"><button class="btn btn-primary" id="create-team">Create a team</button></div>
      </section>
    </div>
  `;
  $("#create-team").addEventListener("click", () => teamForm());
  bindSubmit($("#join-form"), async () => {
    const code = $("#join-code").value;
    const teamId = await teams.joinTeam(code, displayName());
    await store.setOne("profile", "main", { teamId });
    state.profile.teamId = teamId;
    await refreshTeam();
    await publishPresence();
    await refreshTeam();
    state.teamTab = "roster";
    renderTeam(main);
    toast("Welcome to the team!");
  });
}

function teamForm(existing) {
  const { form, values } = buildForm([
    { name: "name", label: "Team name", required: true, placeholder: "Persona Studio" },
    { name: "tag", label: "Tag (short)", placeholder: "PSN", default: "" },
    { name: "region", label: "Region / city" },
    { name: "founded", label: "Founded (year)", placeholder: "2025" },
    { name: "color", label: "Accent colour", type: "color", default: "#2b7dff" },
    { name: "bio", label: "Bio", type: "textarea", placeholder: "Who you are, how you roll…" },
  ], existing || {});
  bindSubmit(form, async () => {
    const v = values();
    const data = {
      name: v.name.trim(), tag: v.tag.trim().toUpperCase().slice(0, 5),
      region: v.region.trim(), founded: v.founded.trim(),
      color: v.color || "#2b7dff", bio: v.bio.trim(),
    };
    try {
      if (existing) {
        await teams.updateTeam(existing.id, data);
      } else {
        const teamId = await teams.createTeam(data, displayName());
        await store.setOne("profile", "main", { teamId });
        state.profile.teamId = teamId;
        state.teamTab = "roster";
      }
      await refreshTeam();
      await publishPresence();
      await refreshTeam();
      modal.close();
      renderTeam($("#main"));
      toast(existing ? "Team updated." : "Team created.");
    } catch (err) {
      console.error(err);
      toast(err.message || "Could not save team.", "err");
    }
  });
  modal.open(existing ? "Edit team" : "Create a team", form);
}

function confirmTeamAction(title, message, run) {
  const box = document.createElement("div");
  box.innerHTML = `<p>${esc(message)}</p>
    <div class="form-actions">
      <button class="btn btn-ghost" data-cancel>Cancel</button>
      <button class="btn btn-danger" data-go>Confirm</button>
    </div>`;
  box.querySelector("[data-cancel]").addEventListener("click", modal.close);
  box.querySelector("[data-go]").addEventListener("click", (e) =>
    runBtn(e.currentTarget, "Working…", async () => { await run(); modal.close(); })
  );
  modal.open(title, box);
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------
function friendRate(s) {
  const w = Number(s?.matchW || 0), l = Number(s?.matchL || 0);
  return w + l ? w / (w + l) : 0;
}

function renderFriends(main) {
  const me = auth.currentUser.uid;
  const code = state.profile.friendCode || "…";
  const incoming = state.friendReqIn;
  const outgoing = state.friendReqOut;

  const friendRows = state.friends
    .map((f) => {
      const otherUid = (f.uids || []).find((u) => u !== me);
      return { otherUid, card: state.friendCards[otherUid] || null };
    })
    .filter((r) => r.otherUid)
    .sort((a, b) => friendRate(b.card?.stats) - friendRate(a.card?.stats));

  main.innerHTML = `
    <div class="view-head"><h1>Friends</h1></div>

    <div class="panel-row">
      <section class="panel">
        <h2>Your friend code</h2>
        <p class="muted small">Share this so other bladers can add you.</p>
        <button class="btn btn-ghost friend-code" id="copy-friend-code">${esc(code)}</button>
      </section>
      <section class="panel">
        <h2>Add a friend</h2>
        <form id="add-friend-form" class="entry-form">
          <label class="field"><span>Friend code</span><input id="friend-code-input" maxlength="6" placeholder="ABC123" style="text-transform:uppercase" required /></label>
          <div class="form-actions"><button class="btn btn-primary">Send request</button></div>
        </form>
      </section>
    </div>

    ${incoming.length ? `<section class="panel">
      <h2>Requests <span class="muted">(${incoming.length})</span></h2>
      <div class="req-list">
        ${incoming.map((r) => `<div class="req-row">
          ${avatarHtml(r.fromName, r.fromPhoto, "avatar--sm")}
          <span class="req-name">${esc(r.fromName || "Blader")}</span>
          <span class="req-actions">
            <button class="btn btn-primary btn-sm" data-accept="${r.id}">Accept</button>
            <button class="btn btn-ghost btn-sm" data-decline="${r.id}">Decline</button>
          </span>
        </div>`).join("")}
      </div>
    </section>` : ""}

    <section class="panel">
      <h2>Friends <span class="muted">(${friendRows.length})</span></h2>
      ${friendRows.length === 0 ? `<p class="muted">No friends yet. Share your code or add someone above.</p>` : `
      <div class="friend-grid">
        ${friendRows.map((r) => {
          const c = r.card || {};
          const s = c.stats || {};
          const w = Number(s.matchW || 0), l = Number(s.matchL || 0);
          const rate = Math.round(friendRate(s) * 100);
          return `<article class="friend-card is-clickable" data-open-friend="${esc(r.otherUid)}" role="button" tabindex="0">
            ${avatarHtml(c.bladerName, c.photo, "avatar--lg")}
            <div class="friend-main">
              <div class="friend-name">${esc(c.bladerName || "Blader")}</div>
              <div class="muted small">${esc([c.region, c.teamName].filter(Boolean).join(" · ") || "—")}</div>
              <div class="friend-rec"><span>${w}–${l}</span>
                <div class="mini-bar"><span style="width:${rate}%"></span></div><span>${rate}%</span></div>
            </div>
            <button class="btn-link danger" data-unfriend="${r.otherUid}">remove</button>
          </article>`;
        }).join("")}
      </div>`}
    </section>

    ${outgoing.length ? `<section class="panel">
      <h2>Pending sent <span class="muted">(${outgoing.length})</span></h2>
      <div class="req-list">
        ${outgoing.map((r) => `<div class="req-row">
          <span class="req-name muted">Waiting for them to accept…</span>
          <span class="req-actions"><button class="btn btn-ghost btn-sm" data-cancel="${r.id}">Cancel</button></span>
        </div>`).join("")}
      </div>
    </section>` : ""}
  `;

  $("#copy-friend-code").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(code); toast("Friend code copied."); }
    catch { toast(code, "warn"); }
  });

  bindSubmit($("#add-friend-form"), async () => {
    const val = $("#friend-code-input").value;
    await friends.sendRequest(val, { name: displayName(), photo: state.profile.photo || "" });
    await refreshFriends();
    renderFriends(main);
    toast("Friend request sent.");
  });

  $$("[data-accept]", main).forEach((b) =>
    b.addEventListener("click", (e) => runBtn(e.currentTarget, "…", async () => {
      const req = incoming.find((r) => r.id === b.dataset.accept);
      await friends.acceptRequest(req);
      await refreshFriends();
      renderFriends(main);
      toast("You're now friends!");
    }))
  );
  $$("[data-decline]", main).forEach((b) =>
    b.addEventListener("click", (e) => runBtn(e.currentTarget, "…", async () => {
      await friends.dropRequest(b.dataset.decline);
      await refreshFriends();
      renderFriends(main);
      toast("Request declined.");
    }))
  );
  $$("[data-cancel]", main).forEach((b) =>
    b.addEventListener("click", (e) => runBtn(e.currentTarget, "…", async () => {
      await friends.dropRequest(b.dataset.cancel);
      await refreshFriends();
      renderFriends(main);
      toast("Request cancelled.");
    }))
  );
  $$("[data-unfriend]", main).forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      confirmTeamAction(
        "Remove friend", "Remove this blader from your friends?",
        async () => {
          await friends.removeFriend(b.dataset.unfriend);
          await refreshFriends();
          renderFriends(main);
          toast("Friend removed.");
        }
      );
    })
  );
  wireFeedClicks(main);
}

// ---------------------------------------------------------------------------
// Friend profile
// ---------------------------------------------------------------------------
function renderFriendProfile(main) {
  const p = state.friendProfile;
  const uid = state.openFriend;
  const back = `<button class="btn btn-ghost btn-sm" id="friend-back">← Friends</button>`;

  if (!p || p.loading || p.uid !== uid) {
    main.innerHTML = `<div class="view-head">${back}<h1>Profile</h1></div><div class="empty">Loading…</div>`;
    $("#friend-back").addEventListener("click", () => { state.openFriend = null; render(); });
    return;
  }

  const c = p.card;
  if (!c) {
    main.innerHTML = `<div class="view-head">${back}<h1>Profile</h1></div>
      <div class="empty">Couldn't load this blader's profile.</div>`;
    $("#friend-back").addEventListener("click", () => { state.openFriend = null; render(); });
    return;
  }

  const s = c.stats || {};
  const mw = Number(s.matchW || 0), ml = Number(s.matchL || 0);
  const gw = Number(s.gameW || 0), gl = Number(s.gameL || 0);
  const mRate = mw + ml ? Math.round((mw / (mw + ml)) * 100) : 0;
  const gRate = gw + gl ? Math.round((gw / (gw + gl)) * 100) : 0;
  const meta = [c.region, c.teamName].filter(Boolean).join(" · ");
  const items = p.items;

  main.innerHTML = `
    <div class="view-head">${back}<h1>${esc(c.bladerName || "Blader")}</h1></div>

    <div class="identity">
      ${avatarHtml(c.bladerName, c.photo, "avatar--lg")}
      <div>
        <div class="identity-name">${esc(c.bladerName || "Blader")}</div>
        <div class="identity-meta">${esc(meta || "—")}</div>
      </div>
      ${c.mainBey ? `<div class="identity-main"><span>Main Bey</span><b>${esc(c.mainBey)}</b></div>` : ""}
    </div>

    ${c.bio ? `<section class="panel"><p class="card-notes" style="margin:0">${esc(c.bio)}</p></section>` : ""}

    <div class="stat-grid">
      ${statCard("Match win rate", mRate + "%", `${mw}W – ${ml}L`)}
      ${statCard("Game win rate", gRate + "%", `${gw}W – ${gl}L games`)}
      ${statCard("Tournaments", Number(s.tournaments || 0), s.bestPlacement ? `Best finish: ${ordinal(s.bestPlacement)}` : "No placements")}
      ${c.achvDone != null ? statCard("Achievements", Number(c.achvDone), "badges earned") : ""}
    </div>

    <section class="panel">
      <h2>Match history</h2>
      ${items == null
        ? `<p class="muted">🔒 ${esc(c.bladerName || "This blader")} keeps their match history private.</p>`
        : items.length === 0
          ? `<p class="muted">No matches shared yet.</p>`
          : `<ul class="feed">${items.map(historyItem).join("")}</ul>`}
    </section>
  `;
  $("#friend-back").addEventListener("click", () => { state.openFriend = null; render(); });
}

function historyItem(x) {
  if (x.kind === "tournament") {
    const rec = (x.wins != null || x.losses != null) ? ` · ${Number(x.wins || 0)}–${Number(x.losses || 0)}` : "";
    return `<li class="feed-item">
      <span class="result-badge result-badge--x">${x.placement ? ordinal(x.placement) : "—"}</span>
      <div class="feed-body">
        <div class="feed-text">${esc(ordinal(x.placement || 0))} at ${esc(x.name || "a tournament")}<span class="muted">${esc(rec)}</span></div>
        <div class="muted small">${x.at ? fmtDate(x.at) : esc(relTime(x.createdAt))}</div>
      </div>
    </li>`;
  }
  const score = (x.myScore || x.oppScore) ? ` ${x.myScore}–${x.oppScore}` : "";
  const deck = x.deck ? ` <span class="muted">· ${esc(x.deck)}</span>` : "";
  return `<li class="feed-item">
    <span class="result-badge result-badge--${x.result === "W" ? "w" : "l"}">${x.result}</span>
    <div class="feed-body">
      <div class="feed-text">${x.result === "W" ? "Beat" : "Lost to"} ${esc(x.opponent || "someone")}${score}${deck}</div>
      <div class="muted small">${x.at ? fmtDate(x.at) : esc(relTime(x.createdAt))}</div>
    </div>
  </li>`;
}

// ---------------------------------------------------------------------------
// Shared save / delete
// ---------------------------------------------------------------------------

/** Race a Firestore write against a short timeout. Resolves "online" if it
 *  lands quickly, "queued" if it's still pending (offline / very slow).
 *  Rejects if the write fails fast (e.g. permission denied). */
function commit(promise) {
  return Promise.race([
    promise.then(() => "online"),
    new Promise((res) => setTimeout(() => res("queued"), 1500)),
  ]);
}

const STATE_KEY = { tournaments: "tournaments", matches: "matches", beys: "beys", decks: "decks" };

/** Optimistically reflect a write in local state so the UI updates instantly. */
function patchLocalDoc(coll, id, data, isNew) {
  const key = STATE_KEY[coll];
  if (!key) return;
  const arr = state[key];
  const now = new Date();
  if (isNew) {
    arr.unshift({ id, ...data, createdAt: now, updatedAt: now });
  } else {
    const i = arr.findIndex((x) => x.id === id);
    if (i >= 0) arr[i] = { ...arr[i], ...data, updatedAt: now };
  }
}

function removeLocalDoc(coll, id) {
  const key = STATE_KEY[coll];
  if (key) state[key] = state[key].filter((x) => x.id !== id);
}

async function save(coll, existing, data) {
  const isNew = !existing;
  const id = existing?.id || store.newId(coll);
  const write = isNew ? store.createAt(coll, id, data) : store.update(coll, id, data);

  let status;
  try {
    status = await commit(write);
  } catch (err) {
    console.error(err);
    toast(err.message || "Could not save.", "err");
    return;
  }

  patchLocalDoc(coll, id, data, isNew);
  computeAchievements();
  if (isNew) postActivity(coll, id, data);
  publishPresence();
  modal.close();
  render();
  toast(status === "online" ? "Saved." : "Saved — will sync when you're online.", status === "online" ? "ok" : "warn");

  // reconcile with the server once the write settles (server timestamps, etc.)
  write
    .then(() => refresh().then(render))
    .catch((err) => toast("A change didn't sync: " + (err.message || err), "err"));
}

/** Add a feed item when a new match / placed tournament is logged. Best-effort. */
async function postActivity(coll, srcId, data) {
  try {
    if (coll === "matches") {
      const res = matchResult(data);
      if (res !== "W" && res !== "L") return;
      const { mine, opp } = matchScore(data);
      await friends.addActivity({
        kind: "match", srcId,
        result: res,
        opponent: data.opponent || "",
        myScore: mine, oppScore: opp,
        deck: data.myDeck || "",
        at: data.date || today(),
      });
    } else if (coll === "tournaments" && Number(data.placement) > 0) {
      await friends.addActivity({
        kind: "tournament", srcId,
        name: data.name || "",
        placement: Number(data.placement),
        wins: data.wins == null ? null : Number(data.wins),
        losses: data.losses == null ? null : Number(data.losses),
        at: data.date || today(),
      });
    }
  } catch (err) {
    console.error("activity post failed", err);
  }
}

/** Delete a user-owned doc immediately, with a 6s Undo toast. */
function confirmDelete(coll, id, noun) {
  const key = STATE_KEY[coll];
  const item = key ? state[key].find((x) => x.id === id) : null;
  const Noun = noun[0].toUpperCase() + noun.slice(1);

  removeLocalDoc(coll, id);
  render();

  const del = store.remove(coll, id);
  del.catch((err) => toast("Delete failed: " + (err.message || err), "err"));

  let undone = false;
  const finalize = setTimeout(async () => {
    if (undone) return;
    if (coll === "matches" || coll === "tournaments") {
      await friends.deleteActivityForSource(id).catch(() => {});
    }
    publishPresence();
    refresh().then(render).catch(() => {});
  }, 6500);

  undoToast(`${Noun} deleted`, async () => {
    undone = true;
    clearTimeout(finalize);
    if (item) {
      const { id: _i, createdAt, updatedAt, ...rest } = item;
      try {
        await store.createAt(coll, id, { ...rest, createdAt });
        patchLocalDoc(coll, id, rest, true);
        render();
        toast(`${Noun} restored.`);
      } catch (err) {
        toast("Couldn't restore: " + (err.message || err), "err");
      }
    }
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
initAuthUi();
initShell();

if (!isConfigured) {
  showLanding();
} else {
  onAuthStateChanged(auth, async (user) => {
    $("#app-loading").hidden = true;
    if (user) {
      $("#landing").hidden = true;
      $("#auth-view").hidden = true;
      $("#shell").hidden = false;
      state.loaded = false;
      syncProfileChrome();
      render();
      try {
        await refresh();
      } catch (err) {
        console.error(err);
        toast("Could not load data. Check your Firestore rules.", "err");
      }
      syncProfileChrome();
      render();
    } else {
      state.loaded = false;
      $("#shell").hidden = true;
      // keep the auth card up if the user was mid sign-in, else show landing
      if ($("#auth-view").hidden) showLanding();
    }
  });
}
