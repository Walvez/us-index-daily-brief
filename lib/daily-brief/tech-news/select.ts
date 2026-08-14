import type { TechNewsCandidate } from "./types";

export function normalizedUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "ref" || key === "source") {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    const result = url.toString();
    return result.length > 1 && result.endsWith("/")
      ? result.slice(0, -1)
      : result;
  } catch {
    return null;
  }
}

/**
 * AI HOT already curates and orders items, so selection is defensive only:
 * valid http(s) URL, non-empty title/source, URL/title dedupe, then take the
 * first `limit` items preserving AI HOT order.
 */
export function selectTechNews(
  candidates: TechNewsCandidate[],
  options: { limit?: number } = {},
): TechNewsCandidate[] {
  const limit = Math.min(10, Math.max(1, options.limit ?? 10));
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const selected: TechNewsCandidate[] = [];

  for (const item of candidates) {
    if (selected.length >= limit) break;
    const url = normalizedUrl(item.sourceUrl);
    if (!url) continue;
    const title = item.sourceTitle.trim();
    if (!title || !item.sourceName.trim()) continue;
    const titleKey = title.toLowerCase().trim();
    if (seenUrls.has(url) || seenTitles.has(titleKey)) continue;
    seenUrls.add(url);
    seenTitles.add(titleKey);
    selected.push({ ...item, sourceUrl: url, sourceTitle: title });
  }
  return selected;
}
