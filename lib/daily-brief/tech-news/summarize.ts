import { extractJson } from "../../ai/json-util";
import type { LlmRunResult } from "../../ai/llm";
import { runGithubModels } from "../../index-brief/github-models";
import { assertUrlProvenance } from "./select";
import type { TechNewsCandidate, TechNewsItem } from "./types";

export type TechNewsLlm = (options: {
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
}) => Promise<LlmRunResult>;

export interface SummarizeTechNewsOptions {
  /**
   * null  — force factual fallback (tests / explicit no-AI).
   * undefined — production default: GitHub Models when GITHUB_TOKEN exists.
   * function — injectable runner.
   */
  llm?: TechNewsLlm | null;
  /**
   * Injectable production-default runner (GitHub Models path).
   * Used only when `llm` is undefined. Tests inject a spy here so the
   * production-default branch is selected without a live network request.
   */
  defaultRunner?: TechNewsLlm;
  /** Injectable env for token presence checks (tests). */
  env?: NodeJS.ProcessEnv;
}

function containsChinese(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

function fallbackItems(candidates: TechNewsCandidate[]): TechNewsItem[] {
  return candidates.map((item) => ({
    sourceTitle: item.sourceTitle,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    publishedAt: item.publishedAt,
    factualExcerpt: item.factualExcerpt,
    summaryStatus: "fallback" as const,
  }));
}

function resolveRunner(
  options: SummarizeTechNewsOptions,
): TechNewsLlm | null {
  const { llm, defaultRunner, env = process.env } = options;

  // Explicit null = forced factual fallback for tests / no-AI.
  if (llm === null) return null;

  // Injectable or production-provided runner.
  if (llm) return llm;

  // undefined llm → production default when a token exists.
  // Do not log or echo the token value.
  const token = env.GITHUB_TOKEN?.trim();
  if (!token) return null;

  if (defaultRunner) return defaultRunner;
  return (opts) => runGithubModels(opts);
}

/**
 * Summarize selected tech candidates in Chinese.
 * On any AI failure, returns factual title/excerpt fallbacks.
 * Output URLs must be a subset of candidate URLs.
 *
 * Semantic distinction for the second argument / options.llm:
 * - null      → forced factual fallback (never call models)
 * - undefined → use GitHub Models when GITHUB_TOKEN is present
 * - function  → use that runner
 *
 * Important: do not default the parameter to `null`, or omitted/undefined
 * production calls become explicit no-AI and never reach GitHub Models.
 */
export async function summarizeTechNews(
  candidates: TechNewsCandidate[],
  llmOrOptions?: TechNewsLlm | null | SummarizeTechNewsOptions,
  maybeOptions?: SummarizeTechNewsOptions,
): Promise<TechNewsItem[]> {
  if (candidates.length === 0) return [];

  let options: SummarizeTechNewsOptions;
  if (
    llmOrOptions === null ||
    typeof llmOrOptions === "function" ||
    llmOrOptions === undefined
  ) {
    options = { ...(maybeOptions ?? {}), llm: llmOrOptions };
  } else {
    options = llmOrOptions;
  }

  const allowedUrls = candidates.map((item) => item.sourceUrl);
  const allowedSet = new Set(allowedUrls);
  const runner = resolveRunner(options);

  if (!runner) {
    return fallbackItems(candidates);
  }

  try {
    const payload = candidates.map((item) => ({
      title: item.sourceTitle,
      url: item.sourceUrl,
      source: item.sourceName,
      publishedAt: item.publishedAt,
      excerpt: item.factualExcerpt ?? "",
    }));

    const { text } = await runner({
      systemPrompt:
        "你是克制的中文科技编辑。只根据输入候选新闻写简短中文摘要。不得编造事实、数字或链接。每条 summary 使用简体中文，40–90 字。输出单一 JSON 对象。",
      userPrompt: [
        '请输出 {"items":[{"url":"...","summary":"..."}]}。',
        "url 必须从输入中原样复制，不得新增或改写链接。",
        "不要改写 sourceTitle；摘要只解释输入标题与摘录。",
        JSON.stringify({ candidates: payload }),
      ].join("\n"),
      timeoutMs: 90_000,
    });

    const parsed = JSON.parse(extractJson(text)) as Record<string, unknown>;
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const byUrl = new Map<string, string>();

    for (const entry of rawItems) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      if (typeof row.url !== "string" || typeof row.summary !== "string") continue;
      if (!allowedSet.has(row.url)) continue;
      const summary = row.summary.trim();
      if (!summary || !containsChinese(summary)) continue;
      byUrl.set(row.url, summary);
    }

    const items: TechNewsItem[] = candidates.map((candidate) => {
      const aiSummary = byUrl.get(candidate.sourceUrl);
      if (aiSummary) {
        return {
          sourceTitle: candidate.sourceTitle,
          sourceName: candidate.sourceName,
          sourceUrl: candidate.sourceUrl,
          publishedAt: candidate.publishedAt,
          factualExcerpt: candidate.factualExcerpt,
          aiSummary,
          summaryStatus: "generated",
        };
      }
      return {
        sourceTitle: candidate.sourceTitle,
        sourceName: candidate.sourceName,
        sourceUrl: candidate.sourceUrl,
        publishedAt: candidate.publishedAt,
        factualExcerpt: candidate.factualExcerpt,
        summaryStatus: "fallback",
      };
    });

    if (
      !assertUrlProvenance(
        items.map((item) => item.sourceUrl),
        allowedUrls,
      )
    ) {
      return fallbackItems(candidates);
    }

    return items;
  } catch {
    return fallbackItems(candidates);
  }
}
