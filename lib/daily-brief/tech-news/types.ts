export interface TechNewsCandidate {
  sourceId: string;
  sourceName: string;
  sourceTitle: string;
  sourceUrl: string;
  publishedAt: string;
  factualExcerpt?: string;
}

export type TechNewsSummaryStatus = "generated" | "fallback";

export interface TechNewsItem {
  /** Canonical source title — never replaced by AI rewrite as fact. */
  sourceTitle: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt?: string;
  factualExcerpt?: string;
  aiSummary?: string;
  summaryStatus: TechNewsSummaryStatus;
}

export interface TechNewsModuleData {
  items: TechNewsItem[];
  windowHours: number;
  candidateCount: number;
}
