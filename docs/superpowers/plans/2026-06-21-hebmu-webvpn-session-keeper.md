# HebMU WebVPN Session Keeper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a publishable ScriptCat scheduled userscript that keeps an existing Hebei Medical University WebVPN session active.

**Architecture:** Create an isolated `webvpn-session-keeper/` subdirectory with one publishable `.user.js`, README, and changelog. Add a Node test that guards ScriptCat metadata, permission minimality, and the verified probe URL.

**Tech Stack:** ScriptCat scheduled userscript metadata, `GM_xmlhttpRequest`, Node built-in test runner via `tsx`.

---

## File Structure

- Create: `webvpn-session-keeper/hebmu-webvpn-session-keeper.user.js`
- Create: `webvpn-session-keeper/README.md`
- Create: `webvpn-session-keeper/CHANGELOG.md`
- Create: `tests/webvpn-session-keeper.test.ts`
- Create: `docs/superpowers/specs/2026-06-21-hebmu-webvpn-session-keeper-design.md`

### Task 1: Metadata Guard Test

**Files:**
- Create: `tests/webvpn-session-keeper.test.ts`
- Create later: `webvpn-session-keeper/hebmu-webvpn-session-keeper.user.js`

- [x] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const scriptPath = path.join(
  projectRoot,
  "webvpn-session-keeper",
  "hebmu-webvpn-session-keeper.user.js",
);

function readScript(): string {
  return readFileSync(scriptPath, "utf8");
}

function metadata(script: string): string {
  const match = script.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
  assert.ok(match, "userscript metadata block is present");
  return match[0];
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/webvpn-session-keeper.test.ts`

Expected: FAIL with `ENOENT` because `webvpn-session-keeper/hebmu-webvpn-session-keeper.user.js` does not exist yet.

### Task 2: Publishable ScriptCat Userscript

**Files:**
- Create: `webvpn-session-keeper/hebmu-webvpn-session-keeper.user.js`
- Create: `webvpn-session-keeper/README.md`
- Create: `webvpn-session-keeper/CHANGELOG.md`

- [x] **Step 1: Implement the userscript**

Use ScriptCat scheduled-script top-level `return new Promise(...)`, `@crontab 0 */3 * * *`, `GM_xmlhttpRequest`, and the verified probe URL:

```js
// @crontab      0 */3 * * *
// @grant        GM_xmlhttpRequest
// @connect      webvpn.hebmu.edu.cn
```

- [x] **Step 2: Document install and limitations**

Document that the user must log in manually first, the script only keeps an active session warm, and service-side absolute expiry or account risk controls can still end the session.

- [x] **Step 3: Run targeted test**

Run: `npx tsx --test tests/webvpn-session-keeper.test.ts`

Expected: PASS, 2 tests.

### Task 3: Verification

**Files:**
- Test: `tests/webvpn-session-keeper.test.ts`
- Test: `package.json` test command, unchanged

- [x] **Step 1: Run focused verification**

Run: `npx tsx --test tests/webvpn-session-keeper.test.ts`

Expected: all tests pass.

- [x] **Step 2: Run broader repository test command**

Run: `npm test`

Expected: all repository tests pass, or unrelated pre-existing failures are reported with details.
