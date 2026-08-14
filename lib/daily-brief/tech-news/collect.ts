import {
  fetchAihotHotTopics,
  type AihotArticle,
} from "../../sources/aihot";
import type { TechNewsCandidate } from "./types";

export interface CollectTechNewsOptions {
  window: "24h" | "7d";
  limit: number;
  /** Injectable fetcher for tests. Defaults to AI HOT selected items. */
  articlesFetcher?: (
    options: { window: "24h" | "7d"; limit: number },
  ) => Promise<AihotArticle[]>;
}

export async function collectTechNewsCandidates(
  options: CollectTechNewsOptions,
): Promise<{ candidates: TechNewsCandidate[]; sourceFailures: string[] }> {
  const fetcher = options.articlesFetcher ?? fetchAihotHotTopics;
  try {
    const articles = await fetcher({
      window: options.window,
      limit: options.limit,
    });
    const candidates: TechNewsCandidate[] = articles.map((article) => ({
      sourceId: "aihot:" + article.id,
      sourceName: article.sourceName,
      sourceTitle: article.title,
      sourceUrl: article.url,
      originalUrl: article.originalUrl,
      publishedAt: article.publishedAt,
      summary: article.summary,
      rank: article.rank,
    }));
    return { candidates, sourceFailures: [] };
  } catch {
    return { candidates: [], sourceFailures: ["aihot"] };
  }
}
