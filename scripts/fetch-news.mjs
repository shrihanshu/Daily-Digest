import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fetchEmailArticles } from "./fetch-email.mjs";
import { writeArchive } from "./archive.mjs";
import { summarizeArticles, summarizeDay } from "./summarize.mjs";

const SOURCES = [
  // AI
  {
    topic: "ai",
    topicLabel: "AI",
    source: "Google News",
    url: "https://news.google.com/rss/search?q=artificial%20intelligence%20OR%20machine%20learning%20when:1d&hl=en-IN&gl=IN&ceid=IN:en",
  },
  {
    topic: "ai",
    topicLabel: "AI",
    source: "TechCrunch AI",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
  },
  {
    topic: "ai",
    topicLabel: "AI",
    source: "VentureBeat AI",
    url: "https://venturebeat.com/category/ai/feed/",
  },
  {
    topic: "ai",
    topicLabel: "AI",
    source: "MIT Technology Review",
    url: "https://www.technologyreview.com/feed/",
  },
  {
    topic: "ai",
    topicLabel: "AI",
    source: "Hugging Face",
    url: "https://huggingface.co/blog/feed.xml",
  },
  // Tech
  {
    topic: "tech",
    topicLabel: "Tech",
    source: "Hacker News",
    url: "https://hnrss.org/frontpage",
  },
  {
    topic: "tech",
    topicLabel: "Tech",
    source: "The Verge",
    url: "https://www.theverge.com/rss/index.xml",
  },
  {
    topic: "tech",
    topicLabel: "Tech",
    source: "Ars Technica",
    url: "https://feeds.arstechnica.com/arstechnica/index",
  },
  {
    topic: "tech",
    topicLabel: "Tech",
    source: "Wired",
    url: "https://www.wired.com/feed/rss",
  },
  // Current affairs
  {
    topic: "current-affairs",
    topicLabel: "Current Affairs",
    source: "Google News",
    url: "https://news.google.com/rss/search?q=current%20affairs%20India%20world%20when:1d&hl=en-IN&gl=IN&ceid=IN:en",
  },
  {
    topic: "current-affairs",
    topicLabel: "Current Affairs",
    source: "BBC World",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
  },
  {
    topic: "current-affairs",
    topicLabel: "Current Affairs",
    source: "The Hindu",
    url: "https://www.thehindu.com/news/national/feeder/default.rss",
  },
];

const MAX_PER_SOURCE = 6;

// Drop RSS items whose titles are clearly promo/coupon content (e.g. Wired coupons).
const TITLE_DROP = [
  /\bpromo code/i,
  /\bcoupon code/i,
  /\bcoupons?\b/i,
  /\bdiscount code/i,
  /%\s*off\b/i,
  /\bbest deals\b/i,
  /\btop deals\b/i,
  /\bdeals? for\b/i,
  /\bsale ends\b/i,
  /\bgift cards?\b/i,
  /\bblack friday\b/i,
  /\bcyber monday\b/i,
];

function isPromoTitle(title = "") {
  return TITLE_DROP.some((rx) => rx.test(title));
}

function decodeEntities(text = "") {
  return text
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&hellip;", "…")
    .replaceAll("&mdash;", "—")
    .replaceAll("&ndash;", "–")
    .replaceAll("&rsquo;", "'")
    .replaceAll("&lsquo;", "'")
    .replaceAll("&rdquo;", '"')
    .replaceAll("&ldquo;", '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Some feeds (VentureBeat, etc.) dump the entire article body into <description>
// or <content:encoded>. A news-card description should be a teaser, not the
// full article — cap it so cards stay scannable and JSON stays small.
const DESC_MAX = 320;
function truncateDescription(text = "") {
  if (text.length <= DESC_MAX) return text;
  const cut = text.slice(0, DESC_MAX);
  // Prefer cutting at the last sentence/word boundary so the truncation reads naturally.
  const sentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  if (sentenceEnd > DESC_MAX * 0.6) return `${cut.slice(0, sentenceEnd + 1).trim()}…`;
  const wordEnd = cut.lastIndexOf(" ");
  return `${(wordEnd > 0 ? cut.slice(0, wordEnd) : cut).trim()}…`;
}

function getTag(item, tag) {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeEntities(match?.[1] || "");
}

// Atom <link href="..."/> support, with rel="alternate" preference.
function getLink(item) {
  const text = getTag(item, "link");
  if (text) return text;
  const alt = item.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alt?.[1]) return decodeEntities(alt[1]);
  const any = item.match(/<link[^>]*href=["']([^"']+)["']/i);
  return any?.[1] ? decodeEntities(any[1]) : "";
}

// Google News RSS hands out opaque redirect URLs that change on every fetch
// (e.g. https://news.google.com/rss/articles/CBMi...). Using them as the article
// ID breaks TL;DR carry-forward and makes the same story look "new" every day.
// For those (and any other source) we fall back to a stable hash of the
// normalized title when the URL looks unstable.
function isUnstableUrl(url = "") {
  return /news\.google\.com\/rss\/articles\//i.test(url);
}
function stableId(topic, url, title) {
  const norm = normalizeTitle(title);
  if (isUnstableUrl(url) && norm.length > 8) {
    const hash = createHash("md5").update(norm).digest("hex").slice(0, 12);
    return `${topic}-t-${hash}`;
  }
  return `${topic}-${url || title}`;
}

function parseFeed(xml, sourceConfig) {
  const blocks = [...xml.matchAll(/<(item|entry)[\s\S]*?<\/\1>/gi)].map((match) => match[0]);

  // Take a wider window because de-noise drops promo items.
  return blocks.slice(0, MAX_PER_SOURCE * 2).map((item) => {
    const title = getTag(item, "title");
    const url = getLink(item);
    const publishedAt =
      getTag(item, "pubDate") ||
      getTag(item, "published") ||
      getTag(item, "updated") ||
      getTag(item, "dc:date");
    const rawDescription =
      getTag(item, "description") || getTag(item, "summary") || getTag(item, "content");
    // Cap feed-supplied descriptions — VentureBeat & co. dump the whole article body.
    const description = truncateDescription(rawDescription);

    return {
      id: stableId(sourceConfig.topic, url, title),
      title,
      description,
      url,
      source: sourceConfig.source,
      topic: sourceConfig.topic,
      topicLabel: sourceConfig.topicLabel,
      channel: "rss",
      // Keep null when the source provides no date — sorter pushes nulls last
      // so undated articles do NOT bubble to the top of the feed.
      publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
    };
  })
    .filter((article) => article.title && !isPromoTitle(article.title))
    .slice(0, MAX_PER_SOURCE);
}

async function fetchSource(sourceConfig, attempt = 0) {
  try {
    const response = await fetch(sourceConfig.url, {
      headers: {
        "user-agent": "DailySignalPersonalDashboard/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`${sourceConfig.source} returned ${response.status}`);
    }

    const xml = await response.text();
    return parseFeed(xml, sourceConfig);
  } catch (error) {
    // One retry with backoff — transient 5xx/network blips should not drop a
    // whole source's daily contribution.
    if (attempt < 1) {
      await new Promise((r) => setTimeout(r, 1500));
      return fetchSource(sourceConfig, attempt + 1);
    }
    throw error;
  }
}

// Normalize a headline so the same story from different feeds collides:
// drop the trailing " - Publisher" Google News appends, strip punctuation.
function normalizeTitle(title = "") {
  return title
    .toLowerCase()
    .replace(/\s+[-–—|]\s+[^-–—|]+$/, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Map free-form OPML category labels to internal topic keys.
function topicFromLabel(label = "") {
  const key = label.trim().toLowerCase();
  if (key.startsWith("ai") || key.includes("artificial")) return ["ai", "AI"];
  if (key.includes("current") || key.includes("affairs") || key.includes("world")) {
    return ["current-affairs", "Current Affairs"];
  }
  return ["tech", "Tech"];
}

async function loadSourcesFromOpml(path) {
  let xml;
  try {
    xml = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const sources = [];
  // Walk each top-level outline (category) and pick its xmlUrl children (feeds).
  const groups = [...xml.matchAll(/<outline\b([^>]*)>([\s\S]*?)<\/outline>/gi)];
  for (const group of groups) {
    const attrs = group[1];
    if (/xmlUrl=/i.test(attrs)) continue; // group header should not be a feed itself
    const label =
      attrs.match(/title="([^"]+)"/i)?.[1] || attrs.match(/text="([^"]+)"/i)?.[1] || "";
    const [topic, topicLabel] = topicFromLabel(label);
    const inner = group[2];
    const feeds = [...inner.matchAll(/<outline\b([^>]*xmlUrl="[^"]+"[^>]*)\/?>/gi)];
    for (const feed of feeds) {
      const a = feed[1];
      const url = a.match(/xmlUrl="([^"]+)"/i)?.[1];
      if (!url) continue;
      const source =
        a.match(/title="([^"]+)"/i)?.[1] || a.match(/text="([^"]+)"/i)?.[1] || "Feed";
      sources.push({ topic, topicLabel, source, url: url.replaceAll("&amp;", "&") });
    }
  }
  return sources.length ? sources : null;
}

function dedupe(articles) {
  const seen = new Set();
  return articles.filter((article) => {
    const norm = normalizeTitle(article.title);
    // Cluster on normalized title when it is distinctive; else fall back to url.
    const key = norm.length > 12 ? `t:${norm}` : `u:${(article.url || article.title || "").toLowerCase()}`;
    if (!key || key === "u:" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const opmlSources = await loadSourcesFromOpml("feeds.opml");
const sources = opmlSources?.length ? opmlSources : SOURCES;
if (opmlSources?.length) console.log(`Loaded ${opmlSources.length} feeds from feeds.opml`);

const rssResults = await Promise.allSettled(sources.map(fetchSource));
for (const result of rssResults) {
  if (result.status === "rejected") {
    console.warn(`Source failed: ${result.reason}`);
  }
}
const rssArticles = rssResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

// Email newsletters (optional, only runs when Gmail creds are present).
let emailArticles = [];
try {
  emailArticles = await fetchEmailArticles();
  if (emailArticles.length) {
    console.log(`Fetched ${emailArticles.length} email newsletter items`);
  }
} catch (error) {
  console.warn(`Email fetch skipped: ${error.message}`);
}

// Nulls (undated articles) sort last so they don't bubble to the top.
const articles = dedupe([...rssArticles, ...emailArticles]).sort((a, b) => {
  const av = a.publishedAt ? new Date(a.publishedAt).getTime() : -Infinity;
  const bv = b.publishedAt ? new Date(b.publishedAt).getTime() : -Infinity;
  return bv - av;
});

if (articles.length === 0) {
  throw new Error("No articles fetched. Check sources.");
}

// Carry forward previously generated TL;DRs so we never re-pay for the same item.
let priorPayload = null;
try {
  priorPayload = JSON.parse(await readFile("data/news.json", "utf8"));
} catch {
  // No prior file — first run.
}
if (priorPayload?.articles?.length) {
  const priorTldr = new Map(priorPayload.articles.filter((a) => a.tldr).map((a) => [a.id, a.tldr]));
  for (const article of articles) {
    if (!article.tldr && priorTldr.has(article.id)) article.tldr = priorTldr.get(article.id);
  }
}

// Fill missing TL;DRs via Claude (no-op without ANTHROPIC_API_KEY).
await summarizeArticles(articles);

// Diff-aware write: hash article set; skip writes if identical to prior.
function contentHash(list) {
  const stable = list
    .map((a) => `${a.id}|${a.title || ""}|${a.tldr || ""}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(stable).digest("hex");
}
const newHash = contentHash(articles);
const priorHash = priorPayload?.articles ? contentHash(priorPayload.articles) : null;
const articlesSame = priorHash === newHash;
let execSummary = priorPayload?.execSummary || null;
let needWrite = !articlesSame;

// Generate exec summary when articles changed, or when none exists yet.
if (!articlesSame || !execSummary) {
  const fresh = await summarizeDay(articles);
  if (fresh) {
    execSummary = fresh;
    needWrite = true;
  }
}

// Heartbeat: force a write at least once per UTC day even when articles are
// identical. Without this, a quiet news day produces zero commits and the
// user can't tell if the cron actually fired. Also force-write when the
// FORCE_WRITE env var is set (the workflow sets it on every run).
const priorDay = (priorPayload?.updatedAt || "").slice(0, 10);
const todayDay = new Date().toISOString().slice(0, 10);
const heartbeatDue = priorDay !== todayDay;
if (heartbeatDue) {
  console.log(`Heartbeat write: prior updatedAt was ${priorDay || "(none)"}, today is ${todayDay}.`);
  needWrite = true;
}
if (process.env.FORCE_WRITE === "1" && !needWrite) {
  console.log("FORCE_WRITE=1 — writing news.json even though content is identical.");
  needWrite = true;
}

if (!needWrite) {
  console.log(`No content change (${articles.length} articles); skipping writes.`);
} else {
  await mkdir("data", { recursive: true });
  await writeFile(
    "data/news.json",
    `${JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        articles,
        execSummary,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Saved ${articles.length} articles to data/news.json`);

  // Archive today + rebuild trends (history → trends).
  try {
    const result = await writeArchive(articles, { execSummary });
    console.log(`Archived ${result.dates.length} day(s); trends over ${result.days} day(s).`);
  } catch (error) {
    console.warn(`Archive/trends skipped: ${error.message}`);
  }
}
