import test from "node:test";
import assert from "node:assert/strict";
import { loadDailyBriefConfig } from "../../lib/daily-brief/config";

test("defaults keep tech-news disabled and market enabled", () => {
  const config = loadDailyBriefConfig({});
  assert.equal(config.marketEnabled, true);
  assert.equal(config.techNewsEnabled, false);
  assert.equal(config.timeZone, "Asia/Taipei");
  assert.equal(config.techNewsLimit, 5);
  assert.equal(config.techNewsWindow, "24h");
});

test("BRIEF_MODULES opt-in enables tech-news safely", () => {
  const config = loadDailyBriefConfig({
    BRIEF_MODULES: "market,tech-news",
  });
  assert.equal(config.marketEnabled, true);
  assert.equal(config.techNewsEnabled, true);
});

test("TECH_NEWS_ENABLED flag works without BRIEF_MODULES", () => {
  const config = loadDailyBriefConfig({
    TECH_NEWS_ENABLED: "true",
    TECH_NEWS_LIMIT: "3",
    TECH_NEWS_WINDOW: "7d",
  });
  assert.equal(config.techNewsEnabled, true);
  assert.equal(config.techNewsLimit, 3);
  assert.equal(config.techNewsWindow, "7d");
});

test("clamps tech news limit and defaults window to 24h", () => {
  const config = loadDailyBriefConfig({
    TECH_NEWS_LIMIT: "99",
    TECH_NEWS_WINDOW: "invalid",
  });
  assert.equal(config.techNewsLimit, 5);
  assert.equal(config.techNewsWindow, "24h");
});
