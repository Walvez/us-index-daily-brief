import type { BriefCommentary } from "../index-brief/commentary";
import type { IndexBriefReport } from "../index-brief/render";
import type {
  AdviceResult,
  MarketContext,
  ValuationContext,
} from "../index-brief/types";
import { editionWeekdayLabel } from "./edition";
import type { MarketModuleData } from "./market-module";
import type { TechNewsItem, TechNewsModuleData } from "./tech-news/types";
import type { DailyBriefReport, ModuleResult, ModuleStatus } from "./types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function colorForMove(value: number): string {
  if (value > 0) return "#b42318";
  if (value < 0) return "#067647";
  return "#475467";
}

function formatPublishedAt(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function findModule<T>(
  report: DailyBriefReport,
  id: string,
): ModuleResult<T> | undefined {
  return report.modules.find((module) => module.moduleId === id) as
    | ModuleResult<T>
    | undefined;
}

function degradationNotice(report: DailyBriefReport): string {
  // Only surface degraded/failed module notices. Skipped (disabled) and
  // success-with-stale-label cases are handled inside section bodies.
  const notes = report.modules
    .filter(
      (module) => module.status === "degraded" || module.status === "failed",
    )
    .map((module) => module.userMessage)
    .filter(
      (message): message is string => !!message && message.trim().length > 0,
    );

  const unique = [...new Set(notes)];
  if (unique.length === 0) return "";
  return `<tr><td style="padding:12px 24px 0;">
    <div style="padding:12px 14px;background:#fffaeb;border:1px solid #fedf89;border-radius:8px;color:#7a2e0e;font-size:13px;line-height:1.6;">
      ${unique.map((note) => escapeHtml(note)).join(" · ")}
    </div>
  </td></tr>`;
}

function valuationSection(valuation: ValuationContext): string {
  if (valuation.status === "unavailable") {
    return `<tr><td style="padding:20px 24px;border-top:1px solid #e4e7ec;">
      <h2 style="margin:0 0 10px;font-size:18px;color:#101828;">估值观察</h2>
      <p style="margin:0;color:#667085;">${escapeHtml(valuation.message)}</p>
    </td></tr>`;
  }

  const names = {
    nasdaq100: "纳斯达克100",
    sp500: "标普500",
  } as const;
  const items = valuation.snapshot.indices
    .map(
      (item) => `<div style="padding:12px 0;border-bottom:1px solid #e4e7ec;">
        <div style="font-weight:700;color:#101828;">${names[item.id]}</div>
        <div style="margin-top:5px;color:#344054;font-size:13px;line-height:1.7;">
          预期 PE ${formatNumber(item.forwardPe)} · 10年均值 ${formatNumber(item.tenYearAveragePe)}
        </div>
        <div style="color:#667085;font-size:13px;line-height:1.7;">
          相对均值 ${item.premiumPct >= 0 ? "+" : ""}${formatNumber(item.premiumPct, 1)}% · ${item.temperature}
        </div>
      </div>`,
    )
    .join("");

  return `<tr><td style="padding:20px 24px;border-top:1px solid #e4e7ec;">
    <h2 style="margin:0 0 4px;font-size:18px;color:#101828;">估值观察</h2>
    ${items}
    <p style="margin:10px 0 0;color:#667085;font-size:12px;line-height:1.6;">
      数据日期 ${escapeHtml(valuation.snapshot.asOf)}；估值为定期发布数据，并非昨夜实时值。PE 百分位历史样本积累中。
    </p>
  </td></tr>`;
}

function marketSection(
  market: MarketContext,
  advice: AdviceResult,
  commentary: BriefCommentary,
  valuation: ValuationContext,
  staleLabel?: string,
): string {
  const rows = market.indices
    .map(({ name, symbol, metrics }) => {
      const move = `${metrics.pct1Day >= 0 ? "+" : ""}${formatNumber(metrics.pct1Day)}%`;
      return `<tr>
        <td style="padding:12px 8px;border-bottom:1px solid #e4e7ec;"><strong>${escapeHtml(name)}</strong><br><span style="color:#667085;font-size:12px;">${escapeHtml(symbol)}</span></td>
        <td style="padding:12px 8px;border-bottom:1px solid #e4e7ec;text-align:right;">${formatNumber(metrics.close)}</td>
        <td style="padding:12px 8px;border-bottom:1px solid #e4e7ec;text-align:right;color:${colorForMove(metrics.pct1Day)};font-weight:700;">${move}</td>
        <td style="padding:12px 8px;border-bottom:1px solid #e4e7ec;text-align:right;">${formatNumber(metrics.drawdown60)}%</td>
      </tr>`;
    })
    .join("");

  const drivers = commentary.drivers.length
    ? commentary.drivers
        .map(
          (driver) => `<li style="margin:0 0 14px;">
          <a href="${escapeHtml(driver.url)}" style="color:#175cd3;font-weight:700;text-decoration:none;">${escapeHtml(driver.title)}</a>
          <div style="margin-top:4px;color:#475467;">${escapeHtml(driver.explanation)}</div>
          <div style="margin-top:3px;color:#98a2b3;font-size:12px;">${driver.relationship === "direct" ? "直接事实" : "可能相关"}</div>
        </li>`,
        )
        .join("")
    : '<li style="color:#667085;">本次没有筛选到足够可靠的相关新闻。</li>';

  const macro = [
    market.vix == null ? null : `VIX ${formatNumber(market.vix, 1)}`,
    market.treasury10y == null
      ? null
      : `10年期美债 ${formatNumber(market.treasury10y, 2)}%`,
    market.dxy == null ? null : `美元指数 ${formatNumber(market.dxy, 2)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const dateLine = staleLabel
    ? `${escapeHtml(staleLabel)}`
    : `${escapeHtml(market.marketDate)} 美股收盘`;

  return `
        <tr><td style="padding:8px 24px 4px;">
          <h2 style="margin:0;font-size:18px;color:#101828;">一、市场与定投观察</h2>
        </td></tr>
        <tr><td style="padding:12px 24px;">
          <div style="font-size:13px;color:#667085;">${dateLine}</div>
          <h3 style="margin:8px 0 10px;font-size:20px;line-height:1.35;color:#101828;">${escapeHtml(commentary.headline)}</h3>
          <p style="margin:0;color:#344054;line-height:1.7;">${escapeHtml(commentary.summary)}</p>
        </td></tr>
        <tr><td style="padding:12px 24px;">
          <div style="padding:16px;border-left:4px solid #1570ef;background:#eff8ff;">
            <div style="font-size:12px;color:#175cd3;">定投观察</div>
            <div style="margin-top:5px;font-size:18px;font-weight:700;color:#101828;">${escapeHtml(advice.label)}</div>
            ${advice.highVolatility ? '<div style="margin-top:8px;color:#b54708;">近期波动偏高，避免因单日新闻改变长期计划。</div>' : ""}
          </div>
        </td></tr>
        <tr><td style="padding:8px 24px 18px;">
          <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead><tr style="color:#667085;background:#f9fafb;">
              <th style="padding:9px 8px;text-align:left;">指数</th>
              <th style="padding:9px 8px;text-align:right;">收盘</th>
              <th style="padding:9px 8px;text-align:right;">昨夜</th>
              <th style="padding:9px 8px;text-align:right;">60日回撤</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
          ${macro ? `<p style="margin:12px 0 0;color:#667085;font-size:13px;">${escapeHtml(macro)}</p>` : ""}
        </td></tr>
        ${valuationSection(valuation)}
        <tr><td style="padding:20px 24px;border-top:1px solid #e4e7ec;">
          <h2 style="margin:0 0 14px;font-size:18px;color:#101828;">昨夜发生了什么</h2>
          <ul style="margin:0;padding-left:20px;line-height:1.55;">${drivers}</ul>
        </td></tr>`;
}

function marketFailedSection(message: string): string {
  return `
        <tr><td style="padding:8px 24px 4px;">
          <h2 style="margin:0;font-size:18px;color:#101828;">一、市场与定投观察</h2>
        </td></tr>
        <tr><td style="padding:16px 24px 20px;">
          <p style="margin:0;color:#667085;line-height:1.7;">${escapeHtml(message || "市场数据暂不可用")}</p>
        </td></tr>`;
}

function techItemHtml(item: TechNewsItem): string {
  const summary =
    item.summaryStatus === "generated" && item.aiSummary
      ? item.aiSummary
      : item.factualExcerpt || "详见原文。";
  const time = formatPublishedAt(item.publishedAt);
  return `<li style="margin:0 0 16px;">
    <a href="${escapeHtml(item.sourceUrl)}" style="color:#175cd3;font-weight:700;text-decoration:none;">${escapeHtml(item.sourceTitle)}</a>
    <div style="margin-top:4px;color:#475467;line-height:1.65;">${escapeHtml(summary)}</div>
    <div style="margin-top:3px;color:#98a2b3;font-size:12px;">
      ${escapeHtml(item.sourceName)}${time ? ` · ${escapeHtml(time)}` : ""}${
        item.summaryStatus === "fallback" ? " · 原文摘录" : ""
      }
    </div>
  </li>`;
}

function techNewsSection(module: ModuleResult<TechNewsModuleData>): string {
  if (module.status === "skipped") {
    return "";
  }
  if (module.status === "failed" || !module.data?.items?.length) {
    return `
        <tr><td style="padding:8px 24px 4px;border-top:1px solid #e4e7ec;">
          <h2 style="margin:0;font-size:18px;color:#101828;">二、AI／科技动态</h2>
        </td></tr>
        <tr><td style="padding:16px 24px 20px;">
          <p style="margin:0;color:#667085;line-height:1.7;">${escapeHtml(module.userMessage || "科技新闻暂不可用")}</p>
        </td></tr>`;
  }

  const items = module.data.items.map(techItemHtml).join("");
  return `
        <tr><td style="padding:8px 24px 4px;border-top:1px solid #e4e7ec;">
          <h2 style="margin:0;font-size:18px;color:#101828;">二、AI／科技动态</h2>
        </td></tr>
        <tr><td style="padding:12px 24px 20px;">
          <ul style="margin:0;padding-left:20px;line-height:1.55;">${items}</ul>
        </td></tr>`;
}

function overviewLine(report: DailyBriefReport): string {
  const market = findModule<MarketModuleData>(report, "market");
  const tech = findModule<TechNewsModuleData>(report, "tech-news");
  const parts: string[] = [];

  if (market?.status === "success" && market.data) {
    const moves = market.data.report.market.indices
      .map(
        (index) =>
          `${index.name} ${index.metrics.pct1Day >= 0 ? "+" : ""}${formatNumber(index.metrics.pct1Day)}%`,
      )
      .join("，");
    parts.push(moves);
  } else if (market?.status === "failed") {
    parts.push("市场模块暂不可用");
  }

  if (tech?.status === "success" || tech?.status === "degraded") {
    const n = tech.data?.items.length ?? 0;
    if (n > 0) parts.push(`科技动态 ${n} 条`);
  } else if (tech?.status === "failed") {
    parts.push("科技新闻暂不可用");
  }

  return parts.join(" · ") || "个人每日简报";
}

function reportBody(report: DailyBriefReport): string {
  const weekday = editionWeekdayLabel(report.editionDate, report.timeZone);
  const market = findModule<MarketModuleData>(report, "market");
  const tech = findModule<TechNewsModuleData>(report, "tech-news");

  let marketHtml = "";
  if (!market || market.status === "skipped") {
    marketHtml = "";
  } else if (market.status === "failed" || !market.data) {
    marketHtml = marketFailedSection(market.userMessage || "市场数据暂不可用");
  } else {
    const { report: marketReport, staleLabel } = market.data;
    marketHtml = marketSection(
      marketReport.market,
      marketReport.advice,
      marketReport.commentary,
      marketReport.valuation,
      staleLabel,
    );
  }

  const techHtml = tech ? techNewsSection(tech) : "";

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;">
    <tr><td align="center" style="padding:20px 12px;background:#f2f4f7;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:680px;border-collapse:collapse;background:#ffffff;border:1px solid #e4e7ec;">
        <tr><td style="padding:26px 24px 12px;">
          <div style="font-size:13px;color:#667085;">${escapeHtml(report.editionDate)} · ${escapeHtml(weekday)}</div>
          <h1 style="margin:8px 0 10px;font-size:26px;line-height:1.25;color:#101828;">个人每日简报</h1>
          <p style="margin:0;color:#344054;line-height:1.7;">${escapeHtml(overviewLine(report))}</p>
        </td></tr>
        ${degradationNotice(report)}
        ${marketHtml}
        ${techHtml}
        <tr><td style="padding:18px 24px;background:#f9fafb;color:#667085;font-size:12px;line-height:1.65;border-top:1px solid #e4e7ec;">
          场外基金通常存在净值确认时差和 T+2 流程，最终结果还会受到人民币汇率、基金限购、申购确认时间及跟踪误差影响。本报告只分析指数与公开新闻，不预测下一交易日，也不构成投资建议。
        </td></tr>
      </table>
    </td></tr>
  </table>`;
}

export function renderEmailHtml(report: DailyBriefReport): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>个人每日简报</title></head><body style="margin:0;background:#f2f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">${reportBody(report)}</body></html>`;
}

export function renderFullHtml(report: DailyBriefReport): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(report.editionDate)} 个人每日简报</title>
  <style>body{margin:0;background:#f2f4f7;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}a:hover{text-decoration:underline!important}</style>
</head>
<body>${reportBody(report)}</body>
</html>`;
}

/** Whether the report has enough content to justify sending an email. */
export function shouldSendReport(report: DailyBriefReport): boolean {
  return report.modules.some((module) => {
    if (module.status === "success" || module.status === "degraded") {
      return true;
    }
    return false;
  });
}

export function moduleStatuses(
  report: DailyBriefReport,
): Record<string, ModuleStatus> {
  return Object.fromEntries(
    report.modules.map((module) => [module.moduleId, module.status]),
  );
}
