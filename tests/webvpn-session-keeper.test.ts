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

test("HebMU WebVPN keeper declares the minimal ScriptCat permissions", () => {
  const script = readScript();
  const meta = metadata(script);

  assert.match(meta, /@crontab\s+0 \*\/3 \* \* \*/);
  assert.match(meta, /@grant\s+GM_xmlhttpRequest/);
  assert.match(meta, /@connect\s+webvpn\.hebmu\.edu\.cn/);
  assert.doesNotMatch(meta, /@require\b/);
  assert.doesNotMatch(meta, /@resource\b/);
  assert.doesNotMatch(meta, /@grant\s+GM_notification/);
});

test("HebMU WebVPN keeper targets the verified protected probe URL", () => {
  const script = readScript();

  assert.match(
    script,
    /https:\/\/webvpn\.hebmu\.edu\.cn\/https\/77726476706e69737468656265737421fcfe43d22f356a5d6b468ca88d1b203b\/\?wrdrecordvisit=1782040210000/,
  );
  assert.match(script, /GM_xmlhttpRequest\(/);
  assert.doesNotMatch(script, /GM_openInTab\(/);
});
