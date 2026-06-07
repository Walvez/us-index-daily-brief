import { extractJson } from "../ai/json-util";
import { runLlm, type LlmRunResult } from "../ai/llm";
import type { AdviceResult, MarketContext } from "./types";
import type { MarketNews } from "./news";

export interface CommentaryDriver {
  title: string;
  explanation: string;
  url: string;
  relationship: "direct" | "possibly-related";
}

export interface BriefCommentary {
  headline: string;
  summary: string;
  adviceLabel: string;
  drivers: CommentaryDriver[];
}

export interface CommentaryInput {
  market: MarketContext;
  advice: AdviceResult;
  news: MarketNews[];
}

export type CommentaryLlm = (options: {
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
}) => Promise<LlmRunResult>;

function fallbackCommentary(input: CommentaryInput): BriefCommentary {
  const moves = input.market.indices
    .map((index) => `${index.name} ${index.metrics.pct1Day.toFixed(2)}%`)
    .join("，");
  const priorityTerms = [
    "nasdaq",
    "s&p",
    "wall street",
    "federal reserve",
    "fed ",
    "interest rate",
    "jobs",
    "payroll",
    "nvidia",
    "broadcom",
    "apple",
    "microsoft",
    "amazon",
    "alphabet",
    "meta",
    "tesla",
    "chip",
    "semiconductor",
  ];
  const rankedNews = input.news
    .map((article, position) => {
      const title = `${article.title} `.toLowerCase();
      const score = priorityTerms.reduce(
        (total, term) => total + (title.includes(term) ? 1 : 0),
        0,
      );
      return { article, position, score };
    })
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .map(({ article }) => article);
  return {
    headline: "昨夜美股指数复盘",
    summary: `${moves}。规则观察为「${input.advice.label}」。新闻与行情之间未经过模型确认，以下仅列出近期相关信息。`,
    adviceLabel: input.advice.label,
    drivers: rankedNews.slice(0, 5).map((article) => ({
      title: article.title,
      explanation: article.excerpt || "近期市场相关报道，具体影响请查看原文。",
      url: article.url,
      relationship: "possibly-related",
    })),
  };
}

function isRelationship(value: unknown): value is CommentaryDriver["relationship"] {
  return value === "direct" || value === "possibly-related";
}

export async function writeCommentary(
  input: CommentaryInput,
  llm: CommentaryLlm = runLlm,
): Promise<BriefCommentary> {
  const allowedUrls = new Set(input.news.map((article) => article.url));
  const payload = {
    market: input.market,
    advice: input.advice,
    news: input.news.map((article) => ({
      title: article.title,
      url: article.url,
      source: article.sourceName,
      publishedAt: article.publishedAt.toISOString(),
      excerpt: article.excerpt,
    })),
  };

  try {
    const { text } = await llm({
      systemPrompt:
        "你是克制的美股指数复盘编辑。只解释输入数据，不预测下一交易日。必须区分直接事实与可能相关因素。不得修改 advice.label，不得生成输入之外的链接。输出单一 JSON 对象。",
      userPrompt: [
        "请输出：headline、summary、drivers。",
        'drivers 每项包含 title、explanation、url、relationship；relationship 只能是 "direct" 或 "possibly-related"。',
        `固定定投观察结论为「${input.advice.label}」，不得改变。`,
        JSON.stringify(payload),
      ].join("\n"),
      timeoutMs: 120_000,
    });
    const parsed = JSON.parse(extractJson(text)) as Record<string, unknown>;
    const rawDrivers = Array.isArray(parsed.drivers) ? parsed.drivers : [];
    const drivers = rawDrivers
      .filter((driver): driver is Record<string, unknown> =>
        !!driver && typeof driver === "object",
      )
      .filter(
        (driver) =>
          typeof driver.title === "string" &&
          typeof driver.explanation === "string" &&
          typeof driver.url === "string" &&
          allowedUrls.has(driver.url) &&
          isRelationship(driver.relationship),
      )
      .slice(0, 5)
      .map((driver) => ({
        title: driver.title as string,
        explanation: driver.explanation as string,
        url: driver.url as string,
        relationship: driver.relationship as CommentaryDriver["relationship"],
      }));

    if (
      typeof parsed.headline !== "string" ||
      typeof parsed.summary !== "string" ||
      parsed.headline.trim().length === 0 ||
      parsed.summary.trim().length === 0
    ) {
      throw new Error("invalid commentary shape");
    }

    return {
      headline: parsed.headline,
      summary: parsed.summary,
      adviceLabel: input.advice.label,
      drivers,
    };
  } catch {
    return fallbackCommentary(input);
  }
}
