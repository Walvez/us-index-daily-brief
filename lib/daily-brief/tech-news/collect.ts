import { fetchSource } from "../../sources/dispatch";
import { sources } from "../../sources/registry";
import type { RawArticle, SourceDef } from "../../sources/types";
import type { TechNewsCandidate } from "./types";

/** Prefer stable AI/tech blogs and communities; X/AttentionVC is optional, not sole. */
const DEFAULT_TECH_SOURCE_IDS = [
  "openai-news",
  "deepmind-blog",
  "huggingface-blog",
  "huggingface-papers",
  "tldr-ai",
  "smol-ai-news",
  "latent-space",
  "mit-tech-review-ai",
  "hackernews",
  "github-trending",
  "v2ex-hot",
  "linuxdo",
  // X-derived feed is allowed only alongside other sources.
  "attentionvc-ai",
] as const;

function isTechSource(source: SourceDef): boolean {
  if (source.enabled === false) return false;
  if (source.category !== "tech") return false;
  return (DEFAULT_TECH_SOURCE_IDS as readonly string[]).includes(source.id);
}

export async function collectTechNewsCandidates(
  sourceDefs: SourceDef[] = sources,
  fetcher: (source: SourceDef) => Promise<RawArticle[]> = fetchSource,
): Promise<{ candidates: TechNewsCandidate[]; sourceFailures: string[] }> {
  const enabled = sourceDefs.filter(isTechSource);
  const sourceFailures: string[] = [];
  const batches = await Promise.all(
    enabled.map(async (source) => {
      try {
        const articles = await fetcher(source);
        return articles
          .filter(
            (article): article is RawArticle & { publishedAt: Date } =>
              article.publishedAt instanceof Date &&
              Number.isFinite(article.publishedAt.getTime()),
          )
          .map(
            (article): TechNewsCandidate => ({
              sourceId: source.id,
              sourceName: source.name,
              sourceTitle: article.title,
              sourceUrl: article.url,
              publishedAt: article.publishedAt.toISOString(),
              factualExcerpt: article.excerpt,
            }),
          );
      } catch {
        sourceFailures.push(source.id);
        return [];
      }
    }),
  );
  return { candidates: batches.flat(), sourceFailures };
}
