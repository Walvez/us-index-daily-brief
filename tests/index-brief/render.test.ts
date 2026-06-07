import test from "node:test";
import assert from "node:assert/strict";
import {
  renderEmailHtml,
  renderFullHtml,
} from "../../lib/index-brief/render";
import { reportFixture } from "./fixtures";

test("renders a single-column mobile email with source links and caveats", () => {
  const html = renderEmailHtml(reportFixture);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /max-width:\s*680px/);
  assert.match(html, /正常定投，可按习惯略微增加/);
  assert.match(html, /T\+2/);
  assert.match(html, /汇率/);
  assert.match(html, /限购/);
  assert.match(html, /估值观察/);
  assert.match(html, /预期 PE 23\.40/);
  assert.match(html, /2026-05-05/);
  assert.doesNotMatch(html, /查看完整报告|github\.io|REPORT_BASE_URL/);
  assert.doesNotMatch(html, /position:\s*fixed/);
});

test("renders an unavailable valuation notice without stale numbers", () => {
  const html = renderEmailHtml({
    ...reportFixture,
    valuation: {
      status: "unavailable",
      reason: "stale",
      message: "官方估值数据暂未更新",
    },
  });

  assert.match(html, /官方估值数据暂未更新/);
  assert.doesNotMatch(html, /23\.40/);
});

test("escapes external text and attributes", () => {
  const html = renderEmailHtml(reportFixture);
  assert.match(html, /Fed &lt;statement&gt;/);
  assert.match(html, /x=1&amp;y=2/);
  assert.doesNotMatch(html, /Fed <statement>/);
});

test("renders a full document suitable for private archival", () => {
  const html = renderFullHtml(reportFixture);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /美股指数每日简报/);
  assert.match(html, /2026-06-05/);
});
