---
name: us-index-daily-brief
description: Use when operating, diagnosing, changing, or manually running the personal Nasdaq-100 / S&P 500 market + AI tech daily email workflow.
---

# Personal Daily Brief (US Index + Tech)

## Start

Confirm the repository root contains `package.json`, `lib/daily-brief/`, and `lib/index-brief/`.

Run:

```bash
npm test
npm run typecheck
npm run daily-brief
```

To send an existing edition:

```bash
npm run send-daily-brief -- YYYY-MM-DD
```

Never send until the edition date and recipient configuration have been checked.
Use the workflow's `validation_only` input to exercise generation without sending or persisting.

## Component Map

- Orchestration / editionDate / module status: `lib/daily-brief/`
- Market module (metrics, advice, valuation, market news): `lib/daily-brief/market-module.ts` → `lib/index-brief/*`
- Tech news module: `lib/daily-brief/tech-news/`
- Unified mobile HTML: `lib/daily-brief/render.ts`
- Duplicate prevention: `lib/daily-brief/state.ts` + durable `brief-delivery` ledger (keyed by **editionDate**)
- Attempt-aware send policy: `lib/daily-brief/send-policy.ts` (early defers market-failed; final/manual may tech-only)
- Cloud schedule: `.github/workflows/index-brief.yml` (single workflow, single email)
- Deployment setup: `docs/index-brief-setup.md`

Legacy single-module path (tests / comparison only):

- `npm run index-brief` / `lib/index-brief/run.ts`

## Diagnosis Order

1. Read the GitHub Actions failure step and error.
2. Confirm `editionDate` (Asia/Taipei) vs market module `marketDate` (America/New_York session).
3. Inspect `daily_reports/<editionDate>/`, `valuation-history.json`, and whether `.emailed` exists.
4. Distinguish module `degraded`/`failed` from whole-run failure; tech failure must not block market send.
5. Distinguish a GitHub Models translation fallback from a report-generation failure.
6. For missing valuation, check the Nasdaq document date and `pdftotext` step.
7. Check Gmail Variables and Secret names without printing their values.

## Safety Rules

- Never print, commit, or request a Gmail application password or token in chat.
- The LLM may explain news but must never change the deterministic advice level or invent URLs.
- Every tech-news URL must come from collected candidates.
- Never claim a specific fund execution price, confirmed NAV, available quota, or guaranteed return.
- Treat QQQ and SPY only as fallback market proxies for their indices.
- Core market data failures fail the market module only; optional tech/macro/news failures degrade gracefully.
- Treat the private `gh-pages` branch as storage only; the email is the complete report.
- Mark `.emailed` only after SMTP succeeds.
