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
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function normalizedTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Source quality tier for AI/technology digest selection. */
export type SourceTier = "official" | "media" | "community" | "x" | "other";

const SOURCE_TIER: Record<string, SourceTier> = {
  "openai-news": "official",
  "deepmind-blog": "official",
  "huggingface-blog": "official",
  "huggingface-papers": "official",
  "tldr-ai": "media",
  "smol-ai-news": "media",
  "latent-space": "media",
  "mit-tech-review-ai": "media",
  hackernews: "community",
  "github-trending": "community",
  "v2ex-hot": "community",
  linuxdo: "community",
  "attentionvc-ai": "x",
};

const TIER_RANK: Record<SourceTier, number> = {
  official: 0,
  media: 1,
  community: 2,
  other: 2,
  x: 3,
};

/** Per-source caps so one community/X feed cannot monopolize the digest. */
const SOURCE_CAPS: Record<string, number> = {
  "attentionvc-ai": 1,
  "v2ex-hot": 1,
  linuxdo: 1,
  hackernews: 2,
  "github-trending": 1,
};

const DEFAULT_COMMUNITY_CAP = 1;

/**
 * Conservative off-topic / promotional / pure community-chatter filters.
 * Applied only as keyword heuristics — never invents relevance with AI.
 */
const OFF_TOPIC_PATTERNS: RegExp[] = [
  /厨娘/,
  /师妹/,
  /拍照/,
  /晒图/,
  /图片分享/,
  /今日打卡/,
  /求推荐服务器/,
  /服务器促销/,
  /优惠码/,
  /邀请码/,
  /invite\s*code/i,
  /签到领/,
  /水贴/,
  /交友/,
  /相亲/,
  /美女/,
  /自拍/,
  /拼车/,
  /出闲置/,
];

export function sourceTier(sourceId: string): SourceTier {
  return SOURCE_TIER[sourceId] ?? "other";
}

export function isPrimaryTier(tier: SourceTier): boolean {
  return tier === "official" || tier === "media";
}

export function isOffTopicCandidate(item: TechNewsCandidate): boolean {
  const haystack = `${item.sourceTitle}\n${item.factualExcerpt ?? ""}`;
  return OFF_TOPIC_PATTERNS.some((pattern) => pattern.test(haystack));
}

function sourceCap(sourceId: string, tier: SourceTier): number {
  if (SOURCE_CAPS[sourceId] != null) return SOURCE_CAPS[sourceId]!;
  // Caps target community/X monopoly; official/media may contribute more within limit.
  if (tier === "official" || tier === "media") return 3;
  return DEFAULT_COMMUNITY_CAP;
}

type Ranked = {
  item: TechNewsCandidate;
  published: number;
  url: string;
  tier: SourceTier;
};

function filterAndRank(
  candidates: TechNewsCandidate[],
  now: Date,
  windowHours: number,
): Ranked[] {
  const oldest = now.getTime() - windowHours * 60 * 60 * 1000;
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const ranked: Ranked[] = [];

  for (const item of candidates) {
    const published = Date.parse(item.publishedAt);
    const url = normalizedUrl(item.sourceUrl);
    if (!url) continue;
    if (!Number.isFinite(published)) continue;
    if (published < oldest || published > now.getTime()) continue;
    if (!item.sourceTitle.trim() || !item.sourceName.trim()) continue;
    if (isOffTopicCandidate(item)) continue;

    const title = normalizedTitle(item.sourceTitle);
    if (seenUrls.has(url) || seenTitles.has(title)) continue;
    seenUrls.add(url);
    seenTitles.add(title);

    ranked.push({
      item: {
        ...item,
        sourceUrl: url,
        sourceTitle: item.sourceTitle.trim(),
        sourceName: item.sourceName.trim(),
      },
      published,
      url,
      tier: sourceTier(item.sourceId),
    });
  }

  ranked.sort((a, b) => {
    const tierDelta = TIER_RANK[a.tier] - TIER_RANK[b.tier];
    if (tierDelta !== 0) return tierDelta;
    return b.published - a.published;
  });
  return ranked;
}

function takeWithCaps(
  pool: Ranked[],
  limit: number,
  counts: Map<string, number>,
): Ranked[] {
  const selected: Ranked[] = [];
  for (const entry of pool) {
    if (selected.length >= limit) break;
    const used = counts.get(entry.item.sourceId) ?? 0;
    if (used >= sourceCap(entry.item.sourceId, entry.tier)) continue;
    counts.set(entry.item.sourceId, used + 1);
    selected.push(entry);
  }
  return selected;
}

/**
 * Deterministic filter: time window, valid http(s) URL, URL/title dedupe,
 * conservative off-topic filter, source tiers/diversity, limit 3–5.
 *
 * Priority: official company/research + established AI media first;
 * communities and X are supplemental and never sole when non-community
 * candidates exist. Each community/X source is capped; when any non-X
 * candidate remains available the digest includes at least one non-X item.
 * Every surviving URL is provenance from an input candidate.
 */
export function selectTechNews(
  candidates: TechNewsCandidate[],
  options: {
    now?: Date;
    windowHours?: number;
    limit?: number;
  } = {},
): TechNewsCandidate[] {
  const now = options.now ?? new Date();
  const windowHours = options.windowHours ?? 30;
  const limit = Math.min(5, Math.max(1, options.limit ?? 5));

  const ranked = filterAndRank(candidates, now, windowHours);
  if (ranked.length === 0) return [];

  const primary = ranked.filter((entry) => isPrimaryTier(entry.tier));
  const supplemental = ranked.filter((entry) => !isPrimaryTier(entry.tier));
  const counts = new Map<string, number>();

  let selected: Ranked[];
  if (primary.length > 0) {
    // Prefer primary; fill remaining slots from community/X only as supplement.
    selected = takeWithCaps(primary, limit, counts);
    if (selected.length < limit) {
      selected = selected.concat(
        takeWithCaps(supplemental, limit - selected.length, counts),
      );
    }
  } else {
    // Fallback: only community/X/other tiers have data.
    selected = takeWithCaps(ranked, limit, counts);
  }

  // Guarantee at least one non-X item when any non-X candidate exists.
  const hasNonX = ranked.some((entry) => entry.tier !== "x");
  const selectedAllX =
    selected.length > 0 && selected.every((entry) => entry.tier === "x");
  if (hasNonX && selectedAllX) {
    const replacement = ranked.find((entry) => entry.tier !== "x");
    if (replacement) {
      selected = [replacement, ...selected.slice(1)].slice(0, limit);
    }
  }

  // Communities must not be the sole tier when primary candidates exist
  // (already enforced by primary-first). Re-assert non-community presence.
  const hasPrimary = primary.length > 0;
  const selectedOnlyCommunity =
    selected.length > 0 &&
    selected.every(
      (entry) => entry.tier === "community" || entry.tier === "x",
    );
  if (hasPrimary && selectedOnlyCommunity) {
    const replacement = primary[0];
    selected = [replacement, ...selected.slice(1)].slice(0, limit);
  }

  return selected.map((entry) => entry.item);
}

/** Ensure every item URL is in the allowed candidate set (AI must not invent links). */
export function assertUrlProvenance(
  urls: string[],
  allowed: Iterable<string>,
): boolean {
  const set = new Set(allowed);
  return urls.every((url) => set.has(url));
}
