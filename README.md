# Daily Signal

A free personal dashboard for daily AI, technology, and current-affairs reading.

## Features

- Daily article list from many AI/tech RSS sources
- AI, tech, current-affairs, email, saved, and unread filters
- Optional Gmail newsletter ingestion (AI/tech emails)
- Search
- Read tracking in browser local storage (works across every source, including email)
- Save-for-later tracking
- GitHub Actions workflow to refresh `data/news.json` every day
- Static hosting friendly for GitHub Pages

## Sources

RSS (always on, no setup):

- AI: Google News (AI/ML), TechCrunch AI, VentureBeat AI, MIT Technology Review, Hugging Face
- Tech: Hacker News, The Verge, Ars Technica, Wired
- Current affairs: Google News

Email (optional, see below): AI/tech newsletters from your Gmail inbox, shown under the **Email** filter.

### A note on LinkedIn

LinkedIn has no public RSS feed and no read API, and scraping it breaks their terms
and gets blocked. So the dashboard covers the same AI/tech voices through reliable
RSS feeds and newsletters instead of pulling the LinkedIn feed directly.

## Run Locally

Open `index.html` in your browser.

Install dependencies once (needed only for email; RSS works without them):

```bash
npm install
```

To manually refresh news with Node.js:

```bash
node scripts/fetch-news.mjs
```

## Email Newsletters (optional)

To pull AI/tech newsletters from Gmail into the **Email** filter:

1. Turn on 2-Step Verification on your Google account.
2. Create a Gmail **App Password**: Google Account → Security → App passwords.
   (Use a normal app password — never your real account password.)
3. Add these as repository secrets (`Settings` → `Secrets and variables` → `Actions`):
   - `GMAIL_USER` — your Gmail address
   - `GMAIL_APP_PASSWORD` — the 16-character app password
   - `GMAIL_LABEL` — optional, defaults to `INBOX`. Tip: make a Gmail filter that
     labels newsletters (e.g. `AI News`) and set this to that label.

The daily workflow reads these secrets and adds newsletter items automatically.
If the secrets are absent, the fetch simply skips email and uses RSS only.

To test email locally:

```bash
GMAIL_USER="you@gmail.com" GMAIL_APP_PASSWORD="xxxxxxxxxxxxxxxx" node scripts/fetch-news.mjs
```

## Deploy With GitHub Pages

1. Create a new public GitHub repository.
2. Push this folder to the repository.
3. Open repository `Settings`.
4. Go to `Pages`.
5. Under `Build and deployment`, choose `Deploy from a branch`.
6. Select branch `main` and folder `/root`.
7. Save.

Your site will be available at:

```text
https://YOUR_USERNAME.github.io/YOUR_REPOSITORY_NAME/
```

## Daily Updates

The workflow in `.github/workflows/daily-news.yml` runs daily at `00:30 UTC`, which is `06:00 IST`.

You can also run it manually:

1. Open the repository on GitHub.
2. Go to `Actions`.
3. Select `Daily news refresh`.
4. Click `Run workflow`.
