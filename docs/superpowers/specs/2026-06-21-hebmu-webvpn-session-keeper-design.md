# HebMU WebVPN Session Keeper Design

## Goal

Build a ScriptCat scheduled userscript that keeps an already-authenticated Hebei Medical University WebVPN session active by periodically visiting a verified protected WebVPN page.

## Scope

The script runs only after the user has manually logged in to `https://webvpn.hebmu.edu.cn/`. It does not automate login, solve captchas, store credentials, read cookies, or bypass WebVPN authentication. Its only network action is a scheduled GET request to the protected library probe URL that was previously verified to keep the session active.

## Architecture

The project lives in `webvpn-session-keeper/` so it is separate from the rest of the repository. The publishable artifact is `hebmu-webvpn-session-keeper.user.js`, a ScriptCat scheduled script using `@crontab 0 */3 * * *`, `GM_xmlhttpRequest`, and `@connect webvpn.hebmu.edu.cn`.

The script classifies each response into three states:

- Active: HTTP 2xx/3xx response that does not look like the WebVPN login page.
- Expired: final URL or response body looks like the WebVPN login page, or the server returns 401/403.
- Unknown failure: timeout, network error, or unexpected status.

## Review Rules

To fit ScriptCat script-site review expectations, the script keeps a readable single-file implementation, uses no external executable code, declares the exact network permission it needs, and describes the feature honestly in metadata and README.

## Testing

`tests/webvpn-session-keeper.test.ts` verifies the release userscript exists, declares the expected ScriptCat metadata, does not use external `@require` or `@resource`, does not request notification permission in v0.1.0, and targets the verified WebVPN probe URL.
