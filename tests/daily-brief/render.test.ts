import test from "node:test";
import assert from "node:assert/strict";
import {
  renderEmailHtml,
  renderFullHtml,
  shouldSendReport,
} from "../../lib/daily-brief/render";
import { dailyBriefFixture, marketModuleDataFixture } from "./fixtures";
import type { ModuleResult } from "../../lib/daily-brief/types";
import type { MarketModuleData } from "../../lib/daily-brief/market-module";
import type { TechNewsModuleData } from "../../lib/daily-brief/tech-news/types";

test("renders mobile personal brief with market then tech sections", () => {
  const html = renderEmailHtml(dailyBriefFixture());
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /max-width:\s*680px/);
  assert.match(html, /个人每日简报/);
  assert.match(html, /一、市场与定投观察/);
  assert.match(html, /二、AI 热点榜/);
  assert.match(html, /正常定投，可按习惯略微增加/);
  assert.match(html, /T\+2/);
  assert.match(html, /汇率/);
  assert.match(html, /限购/);
  assert.match(html, /估值观察/);
  assert.match(html, /预期 PE 23\.40/);
  assert.match(html, /最近交易日 2026-06-05/);
  assert.match(html, /OpenAI 发布产品更新/);
  assert.doesNotMatch(html, /查看完整报告|github\.io|REPORT_BASE_URL/);
  assert.doesNotMatch(html, /position:\s*fixed/);
});

test("escapes external text and attributes", () => {
  const html = renderEmailHtml(dailyBriefFixture());
  assert.match(html, /Fed &lt;statement&gt;/);
  assert.match(html, /OpenAI &lt;launch&gt;/);
  assert.match(html, /x=1&amp;y=2/);
  assert.doesNotMatch(html, /Fed <statement>/);
});

test("shows concise degradation notice only when needed", () => {
  const ok = renderEmailHtml(dailyBriefFixture());
  // Stale market label is a userMessage on success — may appear in notice or section.
  assert.match(ok, /最近交易日/);

  const techFailed = dailyBriefFixture({
    modules: [
      dailyBriefFixture().modules[0],
      {
        moduleId: "tech-news",
        status: "failed",
        userMessage: "科技新闻暂不可用",
        generatedAt: "2026-06-06T00:05:00.000Z",
      } satisfies ModuleResult<TechNewsModuleData>,
    ],
  });
  const html = renderEmailHtml(techFailed);
  assert.match(html, /科技新闻暂不可用/);
  assert.match(html, /一、市场与定投观察/);
});

test("market-only report omits tech section when skipped", () => {
  const report = dailyBriefFixture({
    modules: [
      dailyBriefFixture().modules[0],
      {
        moduleId: "tech-news",
        status: "skipped",
        userMessage: "科技新闻模块未启用",
        generatedAt: "2026-06-06T00:05:00.000Z",
      },
    ],
  });
  const html = renderEmailHtml(report);
  assert.match(html, /一、市场与定投观察/);
  assert.doesNotMatch(html, /二、AI 热点榜/);
  assert.doesNotMatch(html, /科技新闻模块未启用/);
});

test("shouldSendReport requires at least one success/degraded module", () => {
  assert.equal(shouldSendReport(dailyBriefFixture()), true);
  assert.equal(
    shouldSendReport(
      dailyBriefFixture({
        modules: [
          {
            moduleId: "market",
            status: "failed",
            userMessage: "市场数据暂不可用",
            generatedAt: "2026-06-06T00:05:00.000Z",
          },
          {
            moduleId: "tech-news",
            status: "failed",
            userMessage: "科技新闻暂不可用",
            generatedAt: "2026-06-06T00:05:00.000Z",
          },
        ],
      }),
    ),
    false,
  );
});

test("renders full archival document", () => {
  const html = renderFullHtml(dailyBriefFixture());
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /个人每日简报/);
  assert.match(html, /2026-06-06/);
});

test("weekend edition renders weekly market recap instead of overnight review", () => {
  const report = dailyBriefFixture({
    editionDate: "2026-06-06",
    modules: [
      {
        moduleId: "market",
        status: "success",
        data: {
          ...marketModuleDataFixture,
          editionKind: "weekend",
        },
        generatedAt: "2026-06-06T00:05:00.000Z",
      } satisfies ModuleResult<MarketModuleData>,
      dailyBriefFixture().modules[1],
    ],
  });
  const html = renderEmailHtml(report);
  assert.match(html, /本周市场回顾/);
  assert.match(html, /本周大事/);
  assert.match(html, />本周</);
  assert.doesNotMatch(html, /昨夜发生了什么/);
});
