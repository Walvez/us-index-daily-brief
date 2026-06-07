---
name: us-index-daily-brief
description: Use when operating, diagnosing, changing, or manually running the personal Nasdaq-100 and S&P 500 daily market email workflow.
---

# US Index Daily Brief

## Start

Confirm the repository root contains `package.json` and `lib/index-brief/`.

Run:

```bash
npm test
npm run typecheck
npm run index-brief
```

To send an existing report:

```bash
npm run send-index-brief -- YYYY-MM-DD
```

Never send until the report date and recipient configuration have been checked.

## Component Map

- Market data and session validation: `lib/index-brief/market.ts`
- Returns, drawdowns, and volatility: `lib/index-brief/metrics.ts`
- Deterministic contribution observation: `lib/index-brief/advice.ts`
- News filtering and sourced explanation: `lib/index-brief/news.ts`, `commentary.ts`
- GitHub Models translation: `lib/index-brief/github-models.ts`
- Official PE context and history: `lib/index-brief/valuation.ts`, `valuation-history.ts`
- Mobile HTML and Gmail: `lib/index-brief/render.ts`, `mail.ts`
- Duplicate prevention and retries: `lib/index-brief/state.ts`, `run.ts`
- Cloud schedule: `.github/workflows/index-brief.yml`
- Deployment setup: `docs/index-brief-setup.md`

## Diagnosis Order

1. Read the GitHub Actions failure step and error.
2. Confirm Nasdaq-100 and S&P 500 resolve to the same New York market date.
3. Inspect `daily_reports/<date>/`, `valuation-history.json`, and whether `.emailed` exists.
4. Distinguish a GitHub Models translation fallback from a report-generation failure.
5. For missing valuation, check the Nasdaq document date and `pdftotext` step.
6. Check Gmail Variables and Secret names without printing their values.

## Safety Rules

- Never print, commit, or request a Gmail application password or token in chat.
- The LLM may explain news but must never change the deterministic advice level.
- Never claim a specific fund execution price, confirmed NAV, available quota, or guaranteed return.
- Treat QQQ and SPY only as fallback market proxies for their indices.
- Core market data failures stop the report; optional macro/news failures degrade gracefully.
- Treat the private `gh-pages` branch as storage only; the email is the complete report.
