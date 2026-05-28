import { writeFile, mkdir, readdir, readFile, rm } from "node:fs/promises";

const ARCHIVE_DIR = "data/archive";
const KEEP_DAYS = 30;
const ENTITY_WINDOW_DAYS = 7;

// Known AI/tech entities to track frequency for (matched as whole words in titles).
const ENTITIES = [
  "OpenAI", "Anthropic", "Claude", "ChatGPT", "GPT", "Gemini", "DeepMind",
  "Google", "Meta", "Llama", "Microsoft", "Copilot", "Nvidia", "Apple",
  "Amazon", "AWS", "Tesla", "xAI", "Grok", "Mistral", "Hugging Face",
  "Intel", "AMD", "TSMC", "Samsung", "Qualcomm", "Nintendo", "Sony",
  "Spotify", "Netflix", "Uber", "Stripe", "Reddit", "TikTok", "Oracle",
  "IBM", "Salesforce", "Adobe", "Figma", "GitHub", "Linux", "Android",
  "iOS", "Windows", "Bitcoin", "Ethereum", "Quantum", "Robotics",
];

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function countTopics(articles) {
  const bucket = { total: articles.length, ai: 0, tech: 0, "current-affairs": 0, email: 0, linkedin: 0 };
  for (const a of articles) {
    if (bucket[a.topic] !== undefined) bucket[a.topic] += 1;
    if (a.channel === "email") bucket.email += 1;
    if (a.channel === "linkedin") bucket.linkedin += 1;
  }
  return bucket;
}

function countSources(articles) {
  const counts = {};
  for (const a of articles) {
    const key = a.source || "Unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function countEntities(articles) {
  const counts = {};
  for (const a of articles) {
    const title = ` ${(a.title || "").toLowerCase()} `;
    for (const ent of ENTITIES) {
      const rx = new RegExp(`(^|[^a-z0-9])${ent.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
      if (rx.test(title)) counts[ent] = (counts[ent] || 0) + 1;
    }
  }
  return counts;
}

// Persist today's snapshot, prune old days, rebuild index + trends.
export async function writeArchive(articles) {
  await mkdir(ARCHIVE_DIR, { recursive: true });
  const date = todayStamp();

  await writeFile(
    `${ARCHIVE_DIR}/${date}.json`,
    `${JSON.stringify({ date, updatedAt: new Date().toISOString(), articles }, null, 2)}\n`,
  );

  // Discover archived days.
  let files = (await readdir(ARCHIVE_DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();

  // Prune beyond KEEP_DAYS (oldest first).
  if (files.length > KEEP_DAYS) {
    const drop = files.slice(0, files.length - KEEP_DAYS);
    await Promise.all(drop.map((f) => rm(`${ARCHIVE_DIR}/${f}`)));
    files = files.slice(files.length - KEEP_DAYS);
  }

  const dates = files.map((f) => f.replace(".json", ""));
  await writeFile(`${ARCHIVE_DIR}/index.json`, `${JSON.stringify({ dates }, null, 2)}\n`);

  // Build trends across kept days.
  const days = [];
  const entityTotals = {};
  const sourceCounts = {}; // name -> count in window
  const sourceLastSeen = {}; // name -> date string
  const cutoff = new Date(Date.now() - ENTITY_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const latestDay = dates[dates.length - 1] || todayStamp();

  for (const f of files) {
    try {
      const payload = JSON.parse(await readFile(`${ARCHIVE_DIR}/${f}`, "utf8"));
      const day = f.replace(".json", "");
      days.push({ date: day, ...countTopics(payload.articles || []) });
      if (day >= cutoff) {
        const ec = countEntities(payload.articles || []);
        for (const [name, n] of Object.entries(ec)) entityTotals[name] = (entityTotals[name] || 0) + n;
        const sc = countSources(payload.articles || []);
        for (const [name, n] of Object.entries(sc)) {
          sourceCounts[name] = (sourceCounts[name] || 0) + n;
          if (!sourceLastSeen[name] || day > sourceLastSeen[name]) sourceLastSeen[name] = day;
        }
      }
    } catch {
      // skip unreadable file
    }
  }

  const topEntities = Object.entries(entityTotals)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  // Source health: days silent = days since last seen, vs the latest archived day.
  const latestMs = new Date(`${latestDay}T00:00:00Z`).getTime();
  const sources = Object.entries(sourceCounts)
    .map(([name, count]) => {
      const lastSeen = sourceLastSeen[name];
      const daysSilent = lastSeen
        ? Math.round((latestMs - new Date(`${lastSeen}T00:00:00Z`).getTime()) / (24 * 60 * 60 * 1000))
        : ENTITY_WINDOW_DAYS;
      return { name, count, lastSeen, daysSilent };
    })
    .sort((a, b) => b.count - a.count);

  await writeFile(
    "data/trends.json",
    `${JSON.stringify(
      { updatedAt: new Date().toISOString(), windowDays: ENTITY_WINDOW_DAYS, days, topEntities, sources },
      null,
      2,
    )}\n`,
  );

  return { dates, days: days.length, topEntities: topEntities.length, sources: sources.length };
}
