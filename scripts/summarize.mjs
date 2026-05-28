import Anthropic from "@anthropic-ai/sdk";

// Adds a one-line `tldr` to each article (≤22 words). Skips silently when
// ANTHROPIC_API_KEY is not set, so RSS-only runs still work.
// Cost controls:
//   - Caps the number of articles per run (TLDR_MAX, default 40).
//   - Only summarises articles missing a tldr (idempotent across runs).
//   - Batches all items into ONE request, JSON in/out.
//   - System prompt uses prompt caching (cache_control: ephemeral).
export async function summarizeArticles(articles) {
  if (!process.env.ANTHROPIC_API_KEY) return articles;
  const cap = Number(process.env.TLDR_MAX || 40);
  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5";

  // Newest first; only the first `cap` items are eligible to keep cost bounded.
  const eligible = articles.slice(0, cap);
  const todo = eligible
    .filter((article) => !article.tldr)
    .map((article) => ({
      id: article.id,
      title: article.title,
      desc: (article.description || "").slice(0, 280),
    }));

  if (!todo.length) return articles;

  const client = new Anthropic();
  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 4000,
      system: [
        {
          type: "text",
          text:
            "You write one-line TL;DRs for news headlines. Respond ONLY with a JSON array of {id, tldr}. " +
            "tldr must be plain prose, ≤22 words, no preamble, no markdown, no emojis. " +
            "If the title is already self-explanatory, paraphrase it concisely. " +
            "Use the description for context but never quote it.",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Summarise these articles. Output JSON only.\n\n${JSON.stringify(todo)}`,
        },
      ],
    });
  } catch (error) {
    console.warn(`TL;DR generation skipped: ${error.message}`);
    return articles;
  }

  const text = response.content?.find?.((block) => block.type === "text")?.text || "[]";
  const match = text.match(/\[[\s\S]*\]/);
  let parsed = [];
  try {
    parsed = JSON.parse(match ? match[0] : "[]");
  } catch {
    console.warn("TL;DR JSON parse failed; skipping merge.");
    return articles;
  }

  const map = new Map(parsed.filter((item) => item && item.id && item.tldr).map((item) => [item.id, String(item.tldr).trim()]));
  for (const article of articles) {
    if (map.has(article.id)) article.tldr = map.get(article.id);
  }

  const usage = response.usage || {};
  console.log(
    `TL;DR: ${map.size}/${todo.length} new · in ${usage.input_tokens || "?"} / out ${usage.output_tokens || "?"} tokens`,
  );
  return articles;
}
