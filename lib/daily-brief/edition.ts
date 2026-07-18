/**
 * Edition dating for the personal daily brief.
 * editionDate is a calendar day in REPORT_TZ (default Asia/Taipei),
 * independent of the US market session date used by the market module.
 */

const DATE_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = DATE_FORMATTER_CACHE.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    DATE_FORMATTER_CACHE.set(timeZone, formatter);
  }
  return formatter;
}

/** YYYY-MM-DD for `now` in the given IANA timezone. */
export function editionDateFor(now: Date, timeZone: string): string {
  return dateFormatter(timeZone).format(now);
}

const WEEKDAY_ZH = [
  "星期日",
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
] as const;

/** Chinese weekday label for an edition date string in the given timezone. */
export function editionWeekdayLabel(
  editionDate: string,
  timeZone: string,
): string {
  // Noon UTC is unambiguous for a YYYY-MM-DD calendar key in Asia timezones.
  const probe = new Date(`${editionDate}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(probe);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const index = map[weekday] ?? probe.getUTCDay();
  return WEEKDAY_ZH[index];
}

export function buildEmailSubject(editionDate: string, modules: string[]): string {
  const hasMarket = modules.includes("market");
  const hasTech = modules.includes("tech-news");
  if (hasMarket && hasTech) {
    return `${editionDate} 个人每日简报｜市场与 AI 科技`;
  }
  if (hasTech) {
    return `${editionDate} 个人每日简报｜AI 科技`;
  }
  if (hasMarket) {
    return `${editionDate} 个人每日简报｜市场`;
  }
  return `${editionDate} 个人每日简报`;
}
