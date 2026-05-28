import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fetchEmailArticles } from "./fetch-email.mjs";
import { writeArchive } from "./archive.mjs";
import { summarizeArticles } from "./summarize.mjs";

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
    .replace(/<[^>]*>/g, "")
    .trim();
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
    const description =
      getTag(item, "description") || getTag(item, "summary") || getTag(item, "content");

    return {
      id: `${sourceConfig.topic}-${url || title}`,
      title,
      description,
      url,
      source: sourceConfig.source,
      topic: sourceConfig.topic,
      topicLabel: sourceConfig.topicLabel,
      channel: "rss",
      publishedAt: publishedAt ? new Date(publishedAt).toISOString() : new Date().toISOString(),
    };
  })
    .filter((article) => article.title && !isPromoTitle(article.title))
    .slice(0, MAX_PER_SOURCE);
}

async function fetchSource(sourceConfig) {
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

const rssResults = await Promise.allSettled(SOURCES.map(fetchSource));
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

const articles = dedupe([...rssArticles, ...emailArticles]).sort(
  (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt),
);

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

if (priorHash === newHash) {
  console.log(`No content change (${articles.length} articles); skipping writes.`);
} else {
  await mkdir("data", { recursive: true });
  await writeFile(
    "data/news.json",
    `${JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        articles,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Saved ${articles.length} articles to data/news.json`);

  // Archive today + rebuild trends (history → trends).
  try {
    const result = await writeArchive(articles);
    console.log(`Archived ${result.dates.length} day(s); trends over ${result.days} day(s).`);
  } catch (error) {
    console.warn(`Archive/trends skipped: ${error.message}`);
  }
}
