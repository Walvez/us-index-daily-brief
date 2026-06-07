import test from "node:test";
import assert from "node:assert/strict";
import {
  renderEmailHtml,
  renderFullHtml,
} from "../../lib/index-brief/render";
import { reportFixture } from "./fixtures";

test("renders a single-column mobile email with source links and caveats", () => {
  const html = renderEmailHtml(reportFixture, {
    reportUrl: "https://example.github.io/brief/2026-06-05/2026-06-05.html",
  });
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /max-width:\s*680px/);
  assert.match(html, /正常定投，可按习惯略微增加/);
  assert.match(html, /T\+2/);
  assert.match(html, /汇率/);
  assert.match(html, /限购/);
  assert.match(html, /查看完整报告/);
  assert.doesNotMatch(html, /position:\s*fixed/);
});

test("escapes external text and attributes", () => {
  const html = renderEmailHtml(reportFixture);
  assert.match(html, /Fed &lt;statement&gt;/);
  assert.match(html, /x=1&amp;y=2/);
  assert.doesNotMatch(html, /Fed <statement>/);
});

test("renders a full document suitable for GitHub Pages", () => {
  const html = renderFullHtml(reportFixture);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /美股指数每日简报/);
  assert.match(html, /2026-06-05/);
});
