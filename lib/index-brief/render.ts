import type { BriefCommentary } from "./commentary";
import type { AdviceResult, MarketContext } from "./types";

export interface IndexBriefReport {
  market: MarketContext;
  advice: AdviceResult;
  commentary: BriefCommentary;
  generatedAt: string;
}

export interface RenderOptions {
  reportUrl?: string;
}

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

function reportBody(report: IndexBriefReport, options: RenderOptions): string {
  const rows = report.market.indices
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

  const drivers = report.commentary.drivers.length
    ? report.commentary.drivers
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
    report.market.vix == null ? null : `VIX ${formatNumber(report.market.vix, 1)}`,
    report.market.treasury10y == null
      ? null
      : `10年期美债 ${formatNumber(report.market.treasury10y, 2)}%`,
    report.market.dxy == null ? null : `美元指数 ${formatNumber(report.market.dxy, 2)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const fullLink = options.reportUrl
    ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(options.reportUrl)}" style="display:inline-block;color:#175cd3;font-weight:700;text-decoration:none;">查看完整报告 →</a></p>`
    : "";

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;">
    <tr><td align="center" style="padding:20px 12px;background:#f2f4f7;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:680px;border-collapse:collapse;background:#ffffff;border:1px solid #e4e7ec;">
        <tr><td style="padding:26px 24px 12px;">
          <div style="font-size:13px;color:#667085;">${escapeHtml(report.market.marketDate)} 美股收盘</div>
          <h1 style="margin:8px 0 10px;font-size:26px;line-height:1.25;color:#101828;">${escapeHtml(report.commentary.headline)}</h1>
          <p style="margin:0;color:#344054;line-height:1.7;">${escapeHtml(report.commentary.summary)}</p>
        </td></tr>
        <tr><td style="padding:12px 24px;">
          <div style="padding:16px;border-left:4px solid #1570ef;background:#eff8ff;">
            <div style="font-size:12px;color:#175cd3;">定投观察</div>
            <div style="margin-top:5px;font-size:18px;font-weight:700;color:#101828;">${escapeHtml(report.advice.label)}</div>
            ${report.advice.highVolatility ? '<div style="margin-top:8px;color:#b54708;">近期波动偏高，避免因单日新闻改变长期计划。</div>' : ""}
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
        <tr><td style="padding:20px 24px;border-top:1px solid #e4e7ec;">
          <h2 style="margin:0 0 14px;font-size:18px;color:#101828;">昨夜发生了什么</h2>
          <ul style="margin:0;padding-left:20px;line-height:1.55;">${drivers}</ul>
          ${fullLink}
        </td></tr>
        <tr><td style="padding:18px 24px;background:#f9fafb;color:#667085;font-size:12px;line-height:1.65;">
          场外基金通常存在净值确认时差和 T+2 流程，最终结果还会受到人民币汇率、基金限购、申购确认时间及跟踪误差影响。本报告只分析指数与公开新闻，不预测下一交易日，也不构成投资建议。
        </td></tr>
      </table>
    </td></tr>
  </table>`;
}

export function renderEmailHtml(
  report: IndexBriefReport,
  options: RenderOptions = {},
): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>美股指数每日简报</title></head><body style="margin:0;background:#f2f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">${reportBody(report, options)}</body></html>`;
}

export function renderFullHtml(report: IndexBriefReport): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(report.market.marketDate)} 美股指数每日简报</title>
  <style>body{margin:0;background:#f2f4f7;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}a:hover{text-decoration:underline!important}</style>
</head>
<body>${reportBody(report, {})}</body>
</html>`;
}
