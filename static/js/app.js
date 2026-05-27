/* ── State ── */
let allGames = [];
let ratingTarget = null;
let ratingValue = 0;
let searchTimer = null;

/* ── DOM refs ── */
const $ = id => document.getElementById(id);

/* ── Init ── */
document.addEventListener("DOMContentLoaded", () => {
const username = document.body.dataset.username;
if (username && username !== "None") {
    $("user-label").textContent = username;
    showApp();
    loadCollection();
}

  // Login
  $("login-btn").addEventListener("click", doLogin);
  $("password").addEventListener("keydown", e => e.key === "Enter" && doLogin());

  // Logout
  $("logout-btn").addEventListener("click", () => {
    fetch("/api/logout", { method: "POST" }).then(() => location.reload());
  });

  // Filter
  $("filter-input").addEventListener("input", () => {
    const q = $("filter-input").value.toLowerCase();
    const filtered = allGames.filter(g => g.name.toLowerCase().includes(q));
    renderGrid(filtered);
  });

  // Add modal
  $("add-game-btn").addEventListener("click", () => openModal("add-modal"));
  $("add-modal-close").addEventListener("click", () => closeModal("add-modal"));
  $("add-modal").querySelector(".modal-backdrop").addEventListener("click", () => closeModal("add-modal"));

  // Rate modal
  $("rate-modal-close").addEventListener("click", () => closeModal("rate-modal"));
  $("rate-modal").querySelector(".modal-backdrop").addEventListener("click", () => closeModal("rate-modal"));
  $("clear-rating-btn").addEventListener("click", () => { ratingValue = 0; renderStars(0); });
  $("save-rating-btn").addEventListener("click", saveRating);

    // Search
  $("search-input").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 350);
  });

  buildStarButtons();
});

/* ── Auth ── */
async function doLogin() {
  const username = $("username").value.trim();
  const password = $("password").value.trim();
  $("login-error").classList.add("hidden");
  $("login-btn").textContent = "Signing in…";
  $("login-btn").disabled = true;

  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();

  if (data.ok) {
    $("user-label").textContent = data.username;
    $("logout-btn").classList.remove("hidden");
    showApp();
    loadCollection();
  } else {
    $("login-error").textContent = data.error || "Login failed";
    $("login-error").classList.remove("hidden");
    $("login-btn").textContent = "Sign In";
    $("login-btn").disabled = false;
  }
}

/* ── Layout switching ── */
function showApp() {
  $("login-section").classList.add("hidden");
  $("app-section").classList.remove("hidden");
  $("logout-btn").classList.remove("hidden");
}

/* ── Collection ── */
async function loadCollection() {
  $("loading").style.display = "flex";
  $("loading").style.flexDirection = "column";
  $("loading").style.alignItems = "center";
  $("collection-grid").innerHTML = "";
  $("empty-state").classList.add("hidden");

  const res = await fetch("/api/collection");
  $("loading").style.display = "none";

  if (!res.ok) { toast("Failed to load collection", "error"); return; }
  const data = await res.json();
  renderCollection(data.games);
}

function renderCollection(games) {
  allGames = games;
  $("game-count").textContent = `${games.length} game${games.length !== 1 ? "s" : ""}`;
  renderGrid(games);
}

function renderGrid(games) {
  const grid = $("collection-grid");
  grid.innerHTML = "";
  if (!games.length) { $("empty-state").classList.remove("hidden"); return; }
  $("empty-state").classList.add("hidden");
  games.forEach(g => grid.appendChild(buildCard(g)));
}

function buildCard(game) {
  const card = document.createElement("div");
  card.className = "game-card";
  card.dataset.id = game.id;

  const players = game.minplayers && game.maxplayers
    ? (game.minplayers === game.maxplayers ? `${game.minplayers}p` : `${game.minplayers}–${game.maxplayers}p`)
    : "";
  const time = game.maxplaytime ? `${game.maxplaytime}min` : "";
  const meta = [players, time, game.year].filter(Boolean).join(" · ");

  const ratingNum = parseFloat(game.user_rating);
  const ratingDisplay = isNaN(ratingNum)
    ? `<span class="no-rating">Rate</span>`
    : `★ ${ratingNum.toFixed(1)}`;

  const img = game.image
    ? `<img class="game-img" src="${game.image}" alt="${escHtml(game.name)}" loading="lazy"/>`
    : `<div class="game-img-placeholder">♟</div>`;

  card.innerHTML = `
    ${img}
    <div class="game-body">
      <div class="game-name" title="${escHtml(game.name)}">${escHtml(game.name)}</div>
      <div class="game-meta">${escHtml(meta)}</div>
      <div class="game-actions">
        <button class="star-display btn-icon" data-id="${game.id}" data-name="${escHtml(game.name)}" data-rating="${game.user_rating}" title="Rate this game">${ratingDisplay}</button>
        <button class="btn-icon remove-btn" data-id="${game.id}" data-name="${escHtml(game.name)}" title="Remove from collection">🗑</button>
      </div>
    </div>`;

  card.querySelector(".star-display").addEventListener("click", e => {
    const btn = e.currentTarget;
    openRateModal(btn.dataset.id, btn.dataset.name, btn.dataset.rating);
  });
  card.querySelector(".remove-btn").addEventListener("click", e => {
    const btn = e.currentTarget;
    confirmRemove(btn.dataset.id, btn.dataset.name);
  });

  return card;
}

/* ── Remove ── */
async function confirmRemove(gameId, name) {
  if (!confirm(`Remove "${name}" from your collection?`)) return;
  const res = await fetch("/api/collection/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game_id: gameId }),
  });
  const data = await res.json();
  if (data.ok) {
    allGames = allGames.filter(g => g.id !== gameId);
    $("game-count").textContent = `${allGames.length} game${allGames.length !== 1 ? "s" : ""}`;
    document.querySelector(`.game-card[data-id="${gameId}"]`)?.remove();
    toast(`Removed "${name}"`, "success");
  } else {
    toast(data.error || "Failed to remove", "error");
  }
}

async function doSearch() {
  const q = $("search-input").value.trim();
  const results = $("search-results");
  if (!q) { results.innerHTML = ""; return; }

  // Extract game ID from a BGG URL or use directly if numeric
  let gameId = null;
  const urlMatch = q.match(/boardgamegeek\.com\/boardgame\/(\d+)/);
  if (urlMatch) {
    gameId = urlMatch[1];
  } else if (/^\d+$/.test(q)) {
    gameId = q;
  }

  if (!gameId) {
    results.innerHTML = `<div class="search-empty">Please paste a BGG game URL or ID.<br><small>e.g. https://boardgamegeek.com/boardgame/448419/vampire-lords</small></div>`;
    return;
  }

  results.innerHTML = `<div class="search-empty">Looking up game…</div>`;
  const res = await fetch(`/api/lookup?game_id=${gameId}`);
  const data = await res.json();

  if (data.error) {
    results.innerHTML = `<div class="search-empty">${escHtml(data.error)}</div>`;
    return;
  }

  const alreadyOwned = allGames.some(g => g.id === data.id);
  results.innerHTML = "";
  const row = document.createElement("div");
  row.className = "search-result-item";
  row.innerHTML = `
    <div>
      <div>${escHtml(data.name)}</div>
      <div class="game-year">${data.year || ""}</div>
    </div>
    <button class="btn-primary add-btn" data-id="${data.id}" data-name="${escHtml(data.name)}"
      ${alreadyOwned ? "disabled title='Already in collection'" : ""}>
      ${alreadyOwned ? "✓ Owned" : "+ Add"}
    </button>`;
  row.querySelector(".add-btn").addEventListener("click", () => addGame(data.id, data.name));
  results.appendChild(row);
}

async function addGame(gameId, name) {
  const res = await fetch("/api/collection/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game_id: gameId }),
  });
  const data = await res.json();
  if (data.ok) {
    toast(`Added "${name}" – refreshing…`, "success");
    closeModal("add-modal");
    setTimeout(loadCollection, 1500);
  } else {
    toast(data.error || "Failed to add", "error");
  }
}

/* ── Rating ── */
function buildStarButtons() {
  const row = $("star-row");
  for (let i = 1; i <= 10; i++) {
    const btn = document.createElement("button");
    btn.className = "star-btn";
    btn.dataset.val = i;
    btn.textContent = "★";
    btn.title = `${i}/10`;
    btn.addEventListener("click", () => { ratingValue = i; renderStars(i); });
    btn.addEventListener("mouseenter", () => renderStars(i));
    btn.addEventListener("mouseleave", () => renderStars(ratingValue));
    row.appendChild(btn);
  }
}

function renderStars(val) {
  document.querySelectorAll(".star-btn").forEach(btn => {
    btn.classList.toggle("active", +btn.dataset.val <= val);
  });
}

function openRateModal(gameId, name, currentRating) {
  ratingTarget = gameId;
  const num = parseFloat(currentRating);
  ratingValue = isNaN(num) ? 0 : Math.round(num);
  $("rate-game-name").textContent = name;
  renderStars(ratingValue);
  openModal("rate-modal");
}

async function saveRating() {
  if (!ratingTarget) return;
  const res = await fetch("/api/collection/rate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game_id: ratingTarget, rating: ratingValue || "N/A" }),
  });
  const data = await res.json();
  if (data.ok) {
    toast("Rating saved!", "success");
    closeModal("rate-modal");
    // Update local state
    const game = allGames.find(g => g.id === ratingTarget);
    if (game) game.user_rating = ratingValue || "N/A";
    // Re-render the card
    const card = document.querySelector(`.game-card[data-id="${ratingTarget}"]`);
    if (card && game) {
      const newCard = buildCard(game);
      card.replaceWith(newCard);
    }
  } else {
    toast(data.error || "Failed to save rating", "error");
  }
}

/* ── Modal helpers ── */
function openModal(id) { $(id).classList.remove("hidden"); }
function closeModal(id) {
  $(id).classList.add("hidden");
  if (id === "add-modal") { $("search-input").value = ""; $("search-results").innerHTML = ""; }
}

/* ── Toast ── */
let toastTimer;
function toast(msg, type = "") {
  const el = $("toast");
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3000);
}

/* ── Util ── */
function escHtml(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
