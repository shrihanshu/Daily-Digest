const STORAGE_KEY = "daily-signal-state-v1";
const SEEN_KEY = "daily-signal-seen-v1";

const articleList = document.querySelector("#articleList");
const emptyState = document.querySelector("#emptyState");
const progressText = document.querySelector("#progressText");
const progressBar = document.querySelector("#progressBar");
const unreadCount = document.querySelector("#unreadCount");
const savedCount = document.querySelector("#savedCount");
const updatedAt = document.querySelector("#updatedAt");
const todayDate = document.querySelector("#todayDate");
const themeToggle = document.querySelector("#themeToggle");
const searchInput = document.querySelector("#searchInput");
const topicFilters = document.querySelector("#topicFilters");
const archiveDate = document.querySelector("#archiveDate");
const readStreak = document.querySelector("#readStreak");
const notifyToggle = document.querySelector("#notifyToggle");
const previewModal = document.querySelector("#previewModal");
const previewTopic = document.querySelector("#previewTopic");
const previewTitle = document.querySelector("#previewTitle");
const previewMeta = document.querySelector("#previewMeta");
const previewBody = document.querySelector("#previewBody");
const previewLink = document.querySelector("#previewLink");
const previewClose = document.querySelector(".preview-close");
const renderedById = new Map();
const NOTIFY_KEY = "daily-signal-notify";
const NOTIFY_SEEN_KEY = "daily-signal-notify-seen-v1";

let articles = [];
let activeTopic = "all";
let state = loadState();
let currentTheme = localStorage.getItem("daily-signal-theme") || "dark";
let latestDate = null; // value used by the date picker for "today"
let trends = null; // lazy-loaded trends.json
let archiveArticles = null; // lazy-loaded full archive (for cross-day search)
let payloadExec = null; // execSummary from the currently loaded day

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { read: {}, saved: {} };
  } catch {
    return { read: {}, saved: {} };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadSeen() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY)) || []);
  } catch {
    return new Set();
  }
}

function saveSeen(set) {
  localStorage.setItem(SEEN_KEY, JSON.stringify([...set]));
}

function articleId(article) {
  return article.id || article.url || article.title;
}

function formatDate(value) {
  if (!value) return "recent";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function matchesFilters(article) {
  const id = articleId(article);
  const query = searchInput.value.trim().toLowerCase();
  const topicMatch =
    activeTopic === "all" ||
    article.topic === activeTopic ||
    (activeTopic === "email" && article.channel === "email") ||
    (activeTopic === "linkedin" && article.channel === "linkedin") ||
    (activeTopic === "saved" && state.saved[id]) ||
    (activeTopic === "unread" && !state.read[id]);
  const queryMatch = !query || `${article.title} ${article.source} ${article.description}`.toLowerCase().includes(query);
  return topicMatch && queryMatch;
}

function isTodayMode() {
  return !archiveDate.value || archiveDate.value === latestDate;
}

async function ensureArchiveSuperset() {
  if (archiveArticles !== null) return archiveArticles;
  try {
    const idx = await (await fetch("data/archive/index.json", { cache: "no-store" })).json();
    const dates = idx.dates || [];
    const payloads = await Promise.all(
      dates.map((d) =>
        fetch(`data/archive/${d}.json`, { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null),
      ),
    );
    const merged = [];
    const seen = new Set();
    for (const payload of payloads) {
      for (const article of payload?.articles || []) {
        if (!article.id || seen.has(article.id)) continue;
        seen.add(article.id);
        merged.push(article);
      }
    }
    merged.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    archiveArticles = merged;
  } catch {
    archiveArticles = [];
  }
  return archiveArticles;
}

function render() {
  if (activeTopic === "trends") {
    renderTrends();
    return;
  }

  // Cross-day search: when a query is active on today's view, search the whole archive.
  const query = searchInput.value.trim();
  if (query && isTodayMode()) {
    if (archiveArticles === null) {
      articleList.innerHTML = '<p class="empty-state">Searching archive…</p>';
      emptyState.hidden = true;
      ensureArchiveSuperset().then(() => render());
      return;
    }
  }
  const dataset = query && isTodayMode() && archiveArticles ? archiveArticles : articles;

  const filtered = dataset.filter(matchesFilters);
  articleList.innerHTML = "";
  renderedById.clear();

  // Exec summary card — only when viewing the whole feed for a given day.
  if (activeTopic === "all" && !query && payloadExec?.bullets?.length) {
    const bullets = payloadExec.bullets.map((b) => `<li>${b}</li>`).join("");
    const card = document.createElement("article");
    card.className = "exec-card";
    card.innerHTML = `
      <span class="article-topic">Today’s Briefing</span>
      <ul class="exec-bullets">${bullets}</ul>
      <p class="exec-meta">Generated ${formatDate(payloadExec.generatedAt)}</p>
    `;
    articleList.appendChild(card);
  }

  filtered.forEach((article) => {
    const id = articleId(article);
    const isRead = Boolean(state.read[id]);
    const isSaved = Boolean(state.saved[id]);

    const card = document.createElement("article");
    card.className = `article-card${isRead ? " read" : ""}`;
    card.dataset.aid = id;
    renderedById.set(id, article);
    card.innerHTML = `
      <input class="read-check" type="checkbox" aria-label="Mark as read" ${isRead ? "checked" : ""} />
      <div>
        <span class="article-topic">${article.topicLabel || article.topic}</span>${
          article.__isNew && !isRead ? '<span class="article-new">New</span>' : ""
        }
        <h3>${
          article.url
            ? `<a href="${article.url}" target="_blank" rel="noopener noreferrer">${article.title}</a>`
            : article.title
        }</h3>
        <p class="article-meta">${article.source || "Source"} &middot; ${formatDate(article.publishedAt)}</p>
        <p class="article-description">${article.tldr || article.description || "Open the story for the full details."}</p>
      </div>
      <button class="save-button${isSaved ? " saved" : ""}" type="button" aria-label="Save article">${
        isSaved ? "&starf;" : "&star;"
      }</button>
    `;

    card.querySelector(".read-check").addEventListener("change", (event) => {
      if (event.target.checked) {
        state.read[id] = new Date().toISOString();
      } else {
        delete state.read[id];
      }
      saveState();
      render();
    });

    card.querySelector(".save-button").addEventListener("click", () => {
      state.saved[id] = !state.saved[id];
      saveState();
      render();
    });

    articleList.appendChild(card);
  });

  emptyState.hidden = filtered.length > 0;
  updateSummary();
}

function readsByDay() {
  const map = {};
  for (const value of Object.values(state.read || {})) {
    if (typeof value !== "string") continue;
    const day = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    map[day] = (map[day] || 0) + 1;
  }
  return map;
}

function computeReadStats() {
  const byDay = readsByDay();
  const today = new Date().toISOString().slice(0, 10);
  // 7-day rolling count.
  let weekCount = 0;
  const sevenAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const [day, n] of Object.entries(byDay)) {
    if (day >= sevenAgo && day <= today) weekCount += n;
  }
  // Streak — walk back from today while each day has ≥1 read.
  let streak = 0;
  for (let i = 0; i < 90; i += 1) {
    const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (byDay[day]) streak += 1;
    else if (i > 0) break; // today may be 0 — still count yesterday's streak
    else break;
  }
  return { weekCount, streak };
}

function updateSummary() {
  const readTotal = articles.filter((article) => state.read[articleId(article)]).length;
  const savedTotal = articles.filter((article) => state.saved[articleId(article)]).length;
  const newTotal = articles.filter((article) => article.__isNew).length;
  const percent = articles.length ? Math.round((readTotal / articles.length) * 100) : 0;

  progressText.textContent = `${readTotal}/${articles.length} read today${newTotal ? ` · ${newTotal} new` : ""}`;
  progressBar.style.width = `${percent}%`;
  unreadCount.textContent = String(Math.max(articles.length - readTotal, 0));
  savedCount.textContent = String(savedTotal);

  const stats = computeReadStats();
  if (readStreak) {
    const parts = [];
    if (stats.streak > 0) parts.push(`🔥 ${stats.streak}-day streak`);
    if (stats.weekCount > 0) parts.push(`${stats.weekCount} read this week`);
    readStreak.textContent = parts.join(" · ");
  }
}

function sparkline(values, width = 64, height = 16) {
  if (!values || !values.length) return "";
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = height - (v / max) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg class="trend-spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

async function renderTrends() {
  emptyState.hidden = true;
  if (!trends) {
    articleList.innerHTML = '<p class="empty-state">Loading trends…</p>';
    try {
      trends = await (await fetch("data/trends.json", { cache: "no-store" })).json();
    } catch {
      articleList.innerHTML = '<p class="empty-state">No trend data yet — runs build up daily.</p>';
      return;
    }
  }

  const days = trends.days || [];
  const sum = days.reduce((acc, day) => {
    for (const key of ["total", "ai", "tech", "current-affairs", "email", "linkedin"]) {
      acc[key] = (acc[key] || 0) + (day[key] || 0);
    }
    return acc;
  }, {});

  const rows = [
    ["AI", "ai"],
    ["Tech", "tech"],
    ["Current Affairs", "current-affairs"],
    ["Email", "email"],
    ["LinkedIn", "linkedin"],
  ];
  const max = Math.max(1, ...rows.map(([, key]) => sum[key] || 0));
  const recent = days.slice(-7);
  const bars = rows
    .map(([label, key]) => {
      const value = sum[key] || 0;
      const pct = Math.round((value / max) * 100);
      const spark = sparkline(recent.map((day) => day[key] || 0));
      return `<div class="trend-row"><span class="trend-label">${label}</span><div class="trend-bar-track"><div class="trend-bar" style="width:${pct}%"></div></div><span class="trend-val">${value}</span>${spark}</div>`;
    })
    .join("");
  const chips =
    (trends.topEntities || [])
      .map(
        (entity) =>
          `<button class="trend-chip" data-entity="${entity.name}" type="button" title="Filter feed by ${entity.name}">${entity.name}<span class="trend-chip-n">${entity.count}</span></button>`,
      )
      .join("") || '<span class="empty-state">No entities yet.</span>';

  const sourceRows =
    (trends.sources || [])
      .map((source) => {
        const silent = (source.daysSilent || 0) >= 3 ? `<span class="trend-warn" title="Silent ${source.daysSilent}d">⚠️</span>` : "";
        return `<div class="trend-srow"><span class="trend-slabel">${source.name}</span><span class="trend-sval">${source.count}</span>${silent}</div>`;
      })
      .join("") || '<span class="empty-state">No source data yet.</span>';

  articleList.innerHTML = `
    <div class="trend-panel">
      <p class="trend-heading">Coverage over ${days.length} day${days.length === 1 ? "" : "s"} · ${sum.total || 0} stories</p>
      ${bars}
      <p class="trend-heading">Most-mentioned · last ${trends.windowDays || 7} days · click chip to filter</p>
      <div class="trend-tags">${chips}</div>
      <p class="trend-heading">Sources · health (⚠️ = silent ≥3d)</p>
      <div class="trend-sources">${sourceRows}</div>
    </div>`;

  // Wire entity chip clicks → switch to All, set search to entity name.
  articleList.querySelectorAll(".trend-chip[data-entity]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const name = chip.dataset.entity;
      searchInput.value = name;
      document.querySelector('button[data-topic="all"]').click();
      searchInput.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

async function loadArchiveIndex() {
  try {
    const idx = await (await fetch("data/archive/index.json", { cache: "no-store" })).json();
    const dates = (idx.dates || []).slice().sort().reverse();
    if (!dates.length) {
      archiveDate.hidden = true;
      return;
    }
    latestDate = dates[0];
    archiveDate.innerHTML = dates
      .map((date, i) => `<option value="${date}">${i === 0 ? "Today" : formatDate(date)}</option>`)
      .join("");
  } catch {
    archiveDate.hidden = true;
  }
}

async function loadArchiveDay(date) {
  try {
    const payload = await (await fetch(`data/archive/${date}.json`, { cache: "no-store" })).json();
    articles = payload.articles || [];
    payloadExec = payload.execSummary || null;
  } catch {
    articles = [];
    payloadExec = null;
  }
  articles.forEach((article) => {
    article.__isNew = false;
  });
  articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  updatedAt.textContent = formatDate(date);
  render();
}

async function loadArticles() {
  try {
    const response = await fetch("data/news.json", { cache: "no-store" });
    const payload = await response.json();
    articles = payload.articles || [];
    payloadExec = payload.execSummary || null;
    updatedAt.textContent = payload.updatedAt ? formatDate(payload.updatedAt) : "Today";
  } catch {
    articles = [];
    payloadExec = null;
    updatedAt.textContent = "Not yet";
  }

  // Mark items unseen since last visit, then rank: new first, then newest.
  const prevSeen = loadSeen();
  articles.forEach((article) => {
    article.__isNew = !prevSeen.has(articleId(article));
  });
  articles.sort(
    (a, b) =>
      Number(Boolean(b.__isNew)) - Number(Boolean(a.__isNew)) ||
      new Date(b.publishedAt) - new Date(a.publishedAt),
  );
  const union = new Set(prevSeen);
  articles.forEach((article) => union.add(articleId(article)));
  saveSeen(union);

  maybeNotifyOnNew(articles);
  render();
}

topicFilters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-topic]");
  if (!button) return;

  activeTopic = button.dataset.topic;
  document.querySelectorAll(".filter-button").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  render();
});

searchInput.addEventListener("input", render);

function openPreview(article) {
  if (!previewModal) return;
  previewTopic.textContent = article.topicLabel || article.topic || "";
  previewTitle.textContent = article.title || "";
  previewMeta.textContent = `${article.source || "Source"} · ${formatDate(article.publishedAt)}`;
  previewBody.textContent = article.tldr || article.description || "";
  if (article.url) {
    previewLink.href = article.url;
    previewLink.style.display = "";
  } else {
    previewLink.style.display = "none";
  }
  previewModal.style.display = "flex";
  previewModal.classList.add("is-open");
}

function closePreview() {
  if (!previewModal) return;
  previewModal.style.display = "none";
  previewModal.classList.remove("is-open");
}

// Defensive: ensure modal is hidden on every page load, regardless of cached CSS state.
if (previewModal) previewModal.style.display = "none";

articleList.addEventListener("click", (event) => {
  if (event.target.closest("a, button, input")) return;
  const card = event.target.closest(".article-card");
  if (!card || !card.dataset.aid) return;
  const article = renderedById.get(card.dataset.aid);
  if (article) openPreview(article);
});

previewClose?.addEventListener("click", closePreview);
previewModal?.addEventListener("click", (event) => {
  if (event.target === previewModal) closePreview();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && previewModal?.classList.contains("is-open")) closePreview();
});

archiveDate.addEventListener("change", () => {
  const date = archiveDate.value;
  if (!date || date === latestDate) {
    loadArticles();
  } else {
    loadArchiveDay(date);
  }
});

function notifyEnabled() {
  return (
    "Notification" in window &&
    Notification.permission === "granted" &&
    localStorage.getItem(NOTIFY_KEY) === "on"
  );
}

function updateNotifyIcon() {
  if (!notifyToggle) return;
  const on = notifyEnabled();
  const icon = notifyToggle.querySelector(".theme-icon");
  if (icon) icon.textContent = on ? "🔔" : "🔕";
  notifyToggle.setAttribute("aria-label", on ? "Disable notifications" : "Enable notifications");
}

async function toggleNotify() {
  if (!("Notification" in window)) {
    alert("Notifications are not supported in this browser.");
    return;
  }
  const isOn = notifyEnabled();
  if (isOn) {
    localStorage.setItem(NOTIFY_KEY, "off");
  } else {
    if (Notification.permission !== "granted") {
      const result = await Notification.requestPermission();
      if (result !== "granted") {
        updateNotifyIcon();
        return;
      }
    }
    localStorage.setItem(NOTIFY_KEY, "on");
    // Best-effort: ask the service worker for periodic background polling.
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg && "periodicSync" in reg) {
        const status = await navigator.permissions?.query({ name: "periodic-background-sync" });
        if (!status || status.state === "granted") {
          await reg.periodicSync.register("news-poll", { minInterval: 12 * 60 * 60 * 1000 });
        }
      }
    } catch {
      // periodicSync unsupported or denied — foreground only is fine.
    }
  }
  updateNotifyIcon();
}

function maybeNotifyOnNew(allArticles) {
  if (!notifyEnabled() || !allArticles.length) return;
  let prev = [];
  try {
    prev = JSON.parse(localStorage.getItem(NOTIFY_SEEN_KEY)) || [];
  } catch {
    prev = [];
  }
  const prevSet = new Set(prev);
  const fresh = allArticles.filter((article) => !prevSet.has(articleId(article)));
  if (fresh.length && prev.length) {
    const sample = fresh[0];
    try {
      new Notification(`Daily Signal · ${fresh.length} new`, {
        body: sample.title.slice(0, 120),
        icon: "icon.svg",
        tag: "daily-signal-new",
      });
    } catch {
      // ignore
    }
  }
  const next = allArticles.map((article) => articleId(article));
  localStorage.setItem(NOTIFY_SEEN_KEY, JSON.stringify(next));
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const icon = themeToggle.querySelector(".theme-icon");
  if (icon) {
    icon.textContent = theme === "dark" ? "☾" : "☀";
  }
  themeToggle.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  localStorage.setItem("daily-signal-theme", theme);
}

themeToggle.addEventListener("click", () => {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(currentTheme);
});

todayDate.textContent = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
}).format(new Date());

applyTheme(currentTheme);
updateNotifyIcon();
notifyToggle?.addEventListener("click", toggleNotify);
loadArchiveIndex();
loadArticles();

// Register PWA service worker (silent if unsupported / blocked).
// Auto-reload once when a new SW takes over, so users always get the latest shell.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .then((reg) => {
        reg.addEventListener("updatefound", () => {
          const incoming = reg.installing;
          if (!incoming) return;
          incoming.addEventListener("statechange", () => {
            if (incoming.state === "installed" && navigator.serviceWorker.controller) {
              // New SW installed alongside an existing controller — refresh once on activation.
              let reloaded = false;
              navigator.serviceWorker.addEventListener("controllerchange", () => {
                if (reloaded) return;
                reloaded = true;
                window.location.reload();
              });
            }
          });
        });
      })
      .catch(() => {});
  });
}
