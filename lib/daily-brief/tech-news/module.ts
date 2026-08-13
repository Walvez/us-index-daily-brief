import type { AihotArticle } from "../../sources/aihot";
import type { BriefContext, ModuleResult } from "../types";
import { collectTechNewsCandidates } from "./collect";
import { selectTechNews } from "./select";
import type { TechNewsItem, TechNewsModuleData } from "./types";

export interface TechNewsModuleOptions {
  enabled: boolean;
  limit: number;
  window: "24h" | "7d";
  /** Injectable fetcher for tests. Defaults to AI HOT selected items. */
  articlesFetcher?: (
    options: { window: "24h" | "7d"; limit: number },
  ) => Promise<AihotArticle[]>;
}

export async function runTechNewsModule(
  context: BriefContext,
  options: TechNewsModuleOptions,
): Promise<ModuleResult<TechNewsModuleData>> {
  const generatedAt = context.now.toISOString();

  if (!options.enabled) {
    return {
      moduleId: "tech-news",
      status: "skipped",
      userMessage: "科技新闻模块未启用",
      generatedAt,
    };
  }

  try {
    const { candidates, sourceFailures } = await collectTechNewsCandidates({
      window: options.window,
      limit: options.limit,
      articlesFetcher: options.articlesFetcher,
    });
    const selected = selectTechNews(candidates, { limit: options.limit });

    if (selected.length === 0) {
      return {
        moduleId: "tech-news",
        status: "failed",
        userMessage: "科技新闻暂不可用",
        diagnostics: [
          {
            code: "tech-news-empty",
            message:
              sourceFailures.length > 0
                ? "AI HOT unavailable: " + sourceFailures.join(", ")
                : "no items after filter",
          },
        ],
        generatedAt,
      };
    }

    const items: TechNewsItem[] = selected.map((item) => ({
      sourceTitle: item.sourceTitle,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl,
      originalUrl: item.originalUrl,
      publishedAt: item.publishedAt,
      summary: item.summary,
      summaryStatus: item.summary ? "curated" : "fallback",
    }));

    return {
      moduleId: "tech-news",
      status: "success",
      data: {
        items,
        window: options.window,
        candidateCount: candidates.length,
      },
      generatedAt,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "tech-news module failed";
    return {
      moduleId: "tech-news",
      status: "failed",
      userMessage: "科技新闻暂不可用",
      diagnostics: [{ code: "tech-news-failed", message }],
      generatedAt,
    };
  }
}
