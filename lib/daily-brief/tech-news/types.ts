export interface TechNewsCandidate {
  sourceId: string;
  sourceName: string;
  sourceTitle: string;
  sourceUrl: string;
  originalUrl?: string;
  publishedAt: string;
  /** AI HOT Chinese summary (already curated; no local LLM needed). */
  summary?: string;
}

/** "curated" = source-provided Chinese summary; "fallback" = no summary available. */
export type TechNewsSummaryStatus = "curated" | "fallback";

export interface TechNewsItem {
  sourceTitle: string;
  sourceName: string;
  sourceUrl: string;
  originalUrl?: string;
  publishedAt?: string;
  summary?: string;
  summaryStatus: TechNewsSummaryStatus;
}

export interface TechNewsModuleData {
  items: TechNewsItem[];
  window: "24h" | "7d";
  candidateCount: number;
}
