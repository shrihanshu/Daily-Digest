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

let articles = [];
let activeTopic = "all";
let state = loadState();
let currentTheme = localStorage.getItem("daily-signal-theme") || "dark";
let latestDate = null; // value used by the date picker for "today"
let trends = null; // lazy-loaded trends.json

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

function render() {
  if (activeTopic === "trends") {
    renderTrends();
    return;
  }

  const filtered = articles.filter(matchesFilters);
  articleList.innerHTML = "";

  filtered.forEach((article) => {
    const id = articleId(article);
    const isRead = Boolean(state.read[id]);
    const isSaved = Boolean(state.saved[id]);

    const card = document.createElement("article");
    card.className = `article-card${isRead ? " read" : ""}`;
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
        <p class="article-description">${article.description || "Open the story for the full details."}</p>
      </div>
      <button class="save-button${isSaved ? " saved" : ""}" type="button" aria-label="Save article">${
        isSaved ? "&starf;" : "&star;"
      }</button>
    `;

    card.querySelector(".read-check").addEventListener("change", (event) => {
      state.read[id] = event.target.checked;
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

function updateSummary() {
  const readTotal = articles.filter((article) => state.read[articleId(article)]).length;
  const savedTotal = articles.filter((article) => state.saved[articleId(article)]).length;
  const newTotal = articles.filter((article) => article.__isNew).length;
  const percent = articles.length ? Math.round((readTotal / articles.length) * 100) : 0;

  progressText.textContent = `${readTotal}/${articles.length} read today${newTotal ? ` · ${newTotal} new` : ""}`;
  progressBar.style.width = `${percent}%`;
  unreadCount.textContent = String(Math.max(articles.length - readTotal, 0));
  savedCount.textContent = String(savedTotal);
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
  const bars = rows
    .map(([label, key]) => {
      const value = sum[key] || 0;
      const pct = Math.round((value / max) * 100);
      return `<div class="trend-row"><span class="trend-label">${label}</span><div class="trend-bar-track"><div class="trend-bar" style="width:${pct}%"></div></div><span class="trend-val">${value}</span></div>`;
    })
    .join("");
  const chips =
    (trends.topEntities || [])
      .map((entity) => `<span class="trend-chip">${entity.name}<span class="trend-chip-n">${entity.count}</span></span>`)
      .join("") || '<span class="empty-state">No entities yet.</span>';

  articleList.innerHTML = `
    <div class="trend-panel">
      <p class="trend-heading">Coverage over ${days.length} day${days.length === 1 ? "" : "s"} · ${sum.total || 0} stories</p>
      ${bars}
      <p class="trend-heading">Most-mentioned · last ${trends.windowDays || 7} days</p>
      <div class="trend-tags">${chips}</div>
    </div>`;
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
  } catch {
    articles = [];
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
    updatedAt.textContent = payload.updatedAt ? formatDate(payload.updatedAt) : "Today";
  } catch {
    articles = [];
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

archiveDate.addEventListener("change", () => {
  const date = archiveDate.value;
  if (!date || date === latestDate) {
    loadArticles();
  } else {
    loadArchiveDay(date);
  }
});

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
loadArchiveIndex();
loadArticles();
