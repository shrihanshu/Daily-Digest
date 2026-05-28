import Anthropic from "@anthropic-ai/sdk";

// Adds a one-line `tldr` to each article (≤22 words). No-op when no provider
// key is set, so RSS-only runs still work.
//
// Provider priority (first one with a key wins):
//   1. Anthropic Claude — ANTHROPIC_API_KEY  (CLAUDE_MODEL, default claude-haiku-4-5)
//   2. Google Gemini    — GEMINI_API_KEY     (GEMINI_MODEL, default gemini-flash-latest)
//
// Cost controls:
//   - Cap items per run (TLDR_MAX, default 40).
//   - Only summarises items missing a tldr (idempotent across runs).
//   - One batched JSON request per run.
export async function summarizeArticles(articles) {
  const cap = Number(process.env.TLDR_MAX || 40);

  const eligible = articles.slice(0, cap);
  const todo = eligible
    .filter((article) => !article.tldr)
    .map((article) => ({
      id: article.id,
      title: article.title,
      desc: (article.description || "").slice(0, 280),
    }));

  if (!todo.length) return articles;

  let pairs = [];
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      pairs = await summarizeWithClaude(todo);
    } else if (process.env.GEMINI_API_KEY) {
      pairs = await summarizeWithGemini(todo);
    } else {
      return articles;
    }
  } catch (error) {
    console.warn(`TL;DR generation skipped: ${error.message}`);
    return articles;
  }

  const map = new Map(
    pairs.filter((item) => item && item.id && item.tldr).map((item) => [item.id, String(item.tldr).trim()]),
  );
  for (const article of articles) {
    if (map.has(article.id)) article.tldr = map.get(article.id);
  }
  console.log(`TL;DR: ${map.size}/${todo.length} new`);
  return articles;
}

// Produces a 5-bullet "what happened today" summary for the top articles.
// Returns { bullets: [string,...], generatedAt } or null on failure / no key.
export async function summarizeDay(articles) {
  const sample = articles
    .slice(0, 20)
    .map((article) => ({
      title: article.title,
      source: article.source,
      topic: article.topicLabel || article.topic,
      tldr: article.tldr || (article.description || "").slice(0, 200),
    }));
  if (!sample.length) return null;

  const prompt =
    "Read these top headlines and write a 5-bullet executive summary of the day in AI / tech / current affairs. " +
    "Each bullet ≤22 words, plain prose, no markdown, no emojis, no preamble. " +
    "Respond ONLY with a JSON array of 5 strings.\n\n" +
    `Headlines:\n${JSON.stringify(sample)}`;

  try {
    let bullets = [];
    if (process.env.ANTHROPIC_API_KEY) {
      bullets = await dayWithClaude(prompt);
    } else if (process.env.GEMINI_API_KEY) {
      bullets = await dayWithGemini(prompt);
    } else {
      return null;
    }
    bullets = (bullets || []).map((b) => String(b).trim()).filter(Boolean).slice(0, 5);
    if (!bullets.length) return null;
    console.log(`Exec summary: ${bullets.length} bullets`);
    return { bullets, generatedAt: new Date().toISOString() };
  } catch (error) {
    console.warn(`Exec summary skipped: ${error.message}`);
    return null;
  }
}

async function dayWithClaude(prompt) {
  const client = new Anthropic();
  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5";
  const response = await client.messages.create({
    model,
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = response.content?.find?.((b) => b.type === "text")?.text || "[]";
  return parseJsonArray(text);
}

async function dayWithGemini(prompt) {
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, response_mime_type: "application/json" },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  return parseJsonArray(text);
}

async function summarizeWithClaude(todo) {
  const client = new Anthropic();
  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5";
  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    system: [
      {
        type: "text",
        text:
          "You write one-line TL;DRs for news headlines. Respond ONLY with a JSON array of {id, tldr}. " +
          "tldr must be plain prose, ≤22 words, no preamble, no markdown, no emojis. " +
          "If the title is already self-explanatory, paraphrase concisely. Use the description for context but never quote it.",
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      { role: "user", content: `Summarise these articles. Output JSON only.\n\n${JSON.stringify(todo)}` },
    ],
  });
  const text = response.content?.find?.((block) => block.type === "text")?.text || "[]";
  const usage = response.usage || {};
  if (usage.input_tokens || usage.output_tokens) {
    console.log(`Claude tokens · in ${usage.input_tokens} / out ${usage.output_tokens}`);
  }
  return parseJsonArray(text);
}

async function summarizeWithGemini(todo) {
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const prompt =
    "Summarise each article into a one-line TL;DR (≤22 words, plain prose, no preamble, no markdown, no emojis). " +
    "Respond ONLY with a JSON array of objects {id, tldr}.\n\n" +
    `Articles:\n${JSON.stringify(todo)}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      response_mime_type: "application/json",
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 240);
    throw new Error(`Gemini ${res.status}: ${detail}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  return parseJsonArray(text);
}

function parseJsonArray(text) {
  const match = text.match(/\[[\s\S]*\]/);
  try {
    return JSON.parse(match ? match[0] : "[]");
  } catch {
    console.warn("TL;DR JSON parse failed; skipping merge.");
    return [];
  }
}
