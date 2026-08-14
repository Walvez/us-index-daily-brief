import { fetchSource } from "../sources/dispatch";
import { sources } from "../sources/registry";
import type { RawArticle, SourceDef } from "../sources/types";

export interface MarketNews extends RawArticle {
  sourceName: string;
  publishedAt: Date;
}

const KEYWORDS = [
  "federal reserve",
  " fed ",
  "interest rate",
  "inflation",
  "jobs",
  "payroll",
  "treasury",
  "tariff",
  "trade",
  "nasdaq",
  "s&p 500",
  "wall street",
  "nvidia",
  "apple",
  "microsoft",
  "amazon",
  "alphabet",
  "google",
  "meta",
  "tesla",
];

function normalizedUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "ref" || key === "source") {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function normalizedTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

export function selectRelevantNews(
  articles: MarketNews[],
  now = new Date(),
  options: { windowHours?: number } = {},
): MarketNews[] {
  const windowHours = options.windowHours ?? 30;
  const oldest = now.getTime() - windowHours * 60 * 60 * 1000;
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();

  return articles
    .filter((article) => {
      const timestamp = article.publishedAt.getTime();
      if (!Number.isFinite(timestamp) || timestamp < oldest || timestamp > now.getTime()) {
        return false;
      }
      const haystack = ` ${article.title} ${article.excerpt ?? ""} `.toLowerCase();
      return KEYWORDS.some((keyword) => haystack.includes(keyword));
    })
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .map((article) => {
      const url = normalizedUrl(article.url);
      const title = normalizedTitle(article.title);
      return { article, url, title };
    })
    .filter(({ url, title }) => {
      if (!url || seenUrls.has(url) || seenTitles.has(title)) return false;
      seenUrls.add(url);
      seenTitles.add(title);
      return true;
    })
    .map(({ article, url }) => ({ ...article, url: url! }))
    .slice(0, 12);
}

export async function fetchMarketNews(
  sourceDefs: SourceDef[] = sources,
  fetcher: (source: SourceDef) => Promise<RawArticle[]> = fetchSource,
): Promise<MarketNews[]> {
  const enabled = sourceDefs.filter(
    (source) => source.enabled !== false && source.category === "finance",
  );
  const batches = await Promise.all(
    enabled.map(async (source) => {
      try {
        const articles = await fetcher(source);
        return articles
          .filter((article): article is RawArticle & { publishedAt: Date } =>
            article.publishedAt instanceof Date,
          )
          .map((article) => ({ ...article, sourceName: source.name }));
      } catch {
        return [];
      }
    }),
  );
  return batches.flat();
}
