import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const AI_HINTS = [
  /\bai\b/i,
  /artificial intelligence/i,
  /machine learning/i,
  /\bllm\b/i,
  /\bgpt\b/i,
  /openai/i,
  /anthropic/i,
  /\bclaude\b/i,
  /gemini/i,
  /neural/i,
  /deep learning/i,
  /diffusion/i,
];

const TECH_HINTS = [
  /\bsoftware\b/i,
  /\bstartup/i,
  /\bdeveloper/i,
  /\bprogramming\b/i,
  /\bcloud\b/i,
  /\bcyber/i,
  /\bsemiconductor/i,
  /\bchip(s)?\b/i,
  /\bopen source\b/i,
  /\bgithub\b/i,
  /\bsaas\b/i,
  /\bdevops\b/i,
  /\bkubernetes\b/i,
  /\bdatabase\b/i,
  /\bframework\b/i,
  /\btechnology\b/i,
  /\bsilicon valley\b/i,
  /\bventure\b/i,
];

function classify(text = "") {
  return AI_HINTS.some((rx) => rx.test(text)) ? "ai" : "tech";
}

// Keep only mail that is genuinely about AI or tech. A full personal inbox is
// mostly not newsletters, so default-keeping is wrong — require a positive hit.
function isRelevant(text = "") {
  return AI_HINTS.some((rx) => rx.test(text)) || TECH_HINTS.some((rx) => rx.test(text));
}

// Promo / transactional noise to drop (matched against subject + sender).
const JUNK = [
  /naukri/i,
  /security alert/i,
  /\bverify\b/i,
  /\bpassword\b/i,
  /job recommendation/i,
  /\bhiring\b/i,
  /premium credit/i,
  /last chance/i,
  /\binvitation\b/i,
  /\binvoice\b/i,
  /\breceipt\b/i,
  /\bbilling\b/i,
  /your order/i,
  /\bsign in\b/i,
  /claim your/i,
  /\bwebinar reminder\b/i,
  /\bunsubscribe to stop\b/i,
  // LinkedIn social noise (keep News/posts, drop network spam).
  /people you may know/i,
  /who.?s viewed your/i,
  /add to your network/i,
  /grow your network/i,
  /connection request/i,
  /\bi want to connect\b/i,
  /reacted to your/i,
  /endorse/i,
  /weekly job alert/i,
  /premium\b/i,
  /\bimpressions\b/i,
  /your posts? got/i,
  /people.?s connections/i,
  /viewed your profile/i,
  /appeared in .* searches/i,
];

function isJunk(subject = "", fromName = "", body = "") {
  const hay = `${subject} ${fromName}`;
  if (JUNK.some((rx) => rx.test(hay))) return true;
  // Real newsletters carry substance; tiny transactional blasts do not.
  if (body.replace(/\s+/g, " ").trim().length < 120) return true;
  return false;
}

function firstLink(text = "") {
  const match = text.match(/https?:\/\/[^\s"'<>)]+/i);
  return match ? match[0] : "";
}

function snippet(text = "", limit = 220) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

// Returns [] when no Gmail credentials are configured, so RSS-only runs still work.
export async function fetchEmailArticles() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return [];

  const mailbox = process.env.GMAIL_LABEL || "INBOX";
  const max = Number(process.env.GMAIL_MAX || 12);
  // Optional sender allowlist (comma-separated addresses/domains). When set, it is
  // authoritative: only mail from these senders is kept, heuristics are bypassed.
  const allow = (process.env.GMAIL_FROM || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const client = new ImapFlow({
    host: process.env.IMAP_HOST || "imap.gmail.com",
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  const out = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      let uids = await client.search({ since }, { uid: true });
      if (!uids || !uids.length) return out;
      // Pull a wider candidate window since the junk gate drops many.
      uids = uids.slice(-(max * 5)).reverse();

      for await (const msg of client.fetch(uids, { uid: true, envelope: true, source: true }, { uid: true })) {
        if (out.length >= max) break;
        const parsed = await simpleParser(msg.source);
        const subject = parsed.subject || "(no subject)";
        const fromName = parsed.from?.value?.[0]?.name || parsed.from?.text || "Email";
        const fromAddr = (parsed.from?.value?.[0]?.address || "").toLowerCase();
        const textBody = parsed.text || "";
        const htmlText = parsed.html ? parsed.html.replace(/<[^>]*>/g, " ") : "";
        const body = textBody || htmlText;
        if (!body) continue;

        const isLinkedIn = fromAddr.includes("linkedin.com") || /linkedin/i.test(fromName);

        if (isLinkedIn) {
          // LinkedIn is its own channel — never gated by the newsletter allowlist,
          // only the junk gate (drops connection/impression spam).
          if (isJunk(subject, fromName, body)) continue;
        } else if (allow.length) {
          const senderHay = `${fromAddr} ${fromName}`.toLowerCase();
          if (!allow.some((token) => senderHay.includes(token))) continue;
        } else {
          // No allowlist: fall back to heuristic gate (leaky on a noisy inbox).
          if (isJunk(subject, fromName, body)) continue;
          if (!isRelevant(`${subject} ${body}`)) continue;
        }

        const url = firstLink(textBody) || firstLink(parsed.html || "");
        if (!url) continue;

        const description = snippet(body) || "Newsletter email.";
        const topic = classify(`${subject} ${textBody} ${htmlText}`);
        const channel = isLinkedIn ? "linkedin" : "email";

        out.push({
          id: `${channel}-${msg.uid}`,
          title: subject,
          description,
          url,
          source: fromName,
          topic,
          topicLabel: topic === "ai" ? "AI" : "Tech",
          channel,
          publishedAt: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
        });
      }

      // Dedicated LinkedIn sweep: grab ALL LinkedIn mail (news, newsletters, posts)
      // over a wider window, independent of the general email cap. Junk-gated only.
      const liMax = Number(process.env.LINKEDIN_MAX || 20);
      const liDays = Number(process.env.LINKEDIN_DAYS || 7);
      const liSince = new Date(Date.now() - liDays * 24 * 60 * 60 * 1000);
      let liUids = await client.search({ since: liSince, from: "linkedin.com" }, { uid: true });
      liUids = (liUids || []).slice(-liMax).reverse();
      const seenIds = new Set(out.map((o) => o.id));

      for await (const msg of client.fetch(liUids, { uid: true, envelope: true, source: true }, { uid: true })) {
        const id = `linkedin-${msg.uid}`;
        if (seenIds.has(id)) continue;
        const parsed = await simpleParser(msg.source);
        const subject = parsed.subject || "(no subject)";
        const fromName = parsed.from?.value?.[0]?.name || parsed.from?.text || "LinkedIn";
        const textBody = parsed.text || "";
        const htmlText = parsed.html ? parsed.html.replace(/<[^>]*>/g, " ") : "";
        const body = textBody || htmlText;
        if (!body || isJunk(subject, fromName, body)) continue;
        const url = firstLink(textBody) || firstLink(parsed.html || "");
        if (!url) continue;
        const topic = classify(`${subject} ${textBody} ${htmlText}`);
        out.push({
          id,
          title: subject,
          description: snippet(body) || "LinkedIn update.",
          url,
          source: fromName,
          topic,
          topicLabel: topic === "ai" ? "AI" : "Tech",
          channel: "linkedin",
          publishedAt: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
        });
        seenIds.add(id);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return out;
}
