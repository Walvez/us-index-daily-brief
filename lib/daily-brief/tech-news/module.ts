import type { BriefContext, ModuleResult } from "../types";
import { collectTechNewsCandidates } from "./collect";
import { selectTechNews } from "./select";
import { summarizeTechNews, type TechNewsLlm } from "./summarize";
import type { TechNewsModuleData } from "./types";
import type { SourceDef } from "../../sources/types";
import type { RawArticle } from "../../sources/types";

export interface TechNewsModuleOptions {
  enabled: boolean;
  limit: number;
  windowHours: number;
  sourceDefs?: SourceDef[];
  fetcher?: (source: SourceDef) => Promise<RawArticle[]>;
  /**
   * null = forced factual fallback; undefined = production default (GitHub Models
   * when token present); function = injectable runner.
   */
  llm?: TechNewsLlm | null;
  /** Test injection for the production-default GitHub Models path. */
  defaultRunner?: TechNewsLlm;
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
    const { candidates, sourceFailures } = await collectTechNewsCandidates(
      options.sourceDefs,
      options.fetcher,
    );
    const selected = selectTechNews(candidates, {
      now: context.now,
      windowHours: options.windowHours,
      limit: options.limit,
    });

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
                ? `no items after filter; source failures: ${sourceFailures.length}`
                : "no items after filter",
          },
        ],
        generatedAt,
      };
    }

    const items = await summarizeTechNews(selected, {
      llm: options.llm,
      defaultRunner: options.defaultRunner,
    });
    const anyFallback = items.some((item) => item.summaryStatus === "fallback");
    const partialSources = sourceFailures.length > 0;
    const status =
      anyFallback || partialSources ? "degraded" : "success";

    return {
      moduleId: "tech-news",
      status,
      data: {
        items,
        windowHours: options.windowHours,
        candidateCount: candidates.length,
      },
      userMessage:
        status === "degraded"
          ? anyFallback
            ? "部分科技摘要使用原文标题摘录"
            : "部分科技新闻源暂不可用"
          : undefined,
      diagnostics:
        sourceFailures.length > 0
          ? [
              {
                code: "source-failures",
                message: `${sourceFailures.length} source(s) failed`,
              },
            ]
          : undefined,
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
