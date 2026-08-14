/**
 * AI HOT (aihot.virxact.com) anonymous read-only integration.
 *
 * AI HOT already curates Chinese AI news with Chinese summaries, so the
 * tech-news module consumes it directly without a local LLM translation step.
 * Follows the AI HOT skill contract: anonymous, no API key, links.aihot as the
 * primary link, and timeline-aligned timestamps.
 */

export interface AihotArticle {
  id: string;
  title: string;
  sourceName: string;
  /** AI HOT Chinese reading page (primary link). */
  url: string;
  /** Third-party original link, when available. */
  originalUrl?: string;
  /** AI HOT Chinese summary (may be absent). */
  summary?: string;
  /** ISO timestamp from the hot-topics latestAt field. */
  publishedAt: string;
  rank?: number;
  storyId?: string;
}

const BASE_URL = "https://aihot.virxact.com";
const USER_AGENT = "aihot-skill/1.3.0 (+https://aihot.virxact.com/aihot-skill/)";

export interface FetchAihotOptions {
  window?: "24h" | "7d";
  limit?: number;
  fetcher?: typeof fetch;
}

export async function fetchAihotHotTopics(
  options: FetchAihotOptions = {},
): Promise<AihotArticle[]> {
  const limit = Math.min(10, Math.max(1, options.limit ?? 10));
  const fetcher = options.fetcher ?? fetch;

  const response = await fetcher(BASE_URL + "/api/v1/hot-topics", {
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error("AI HOT HTTP " + response.status);
  }

  const payload = (await response.json()) as { items?: AihotHotTopicPayload[] };
  const ranked = (payload.items ?? [])
    .slice()
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    .map(mapHotTopic)
    .filter(
      (item): item is AihotArticle =>
        item.title.length > 0 &&
        item.url.length > 0 &&
        item.publishedAt.length > 0,
    );

  const selected = ranked.slice(0, limit);
  await Promise.all(
    selected.map(async (item) => {
      if (!item.storyId) return;
      const story = await fetchAihotStory(item.storyId, fetcher);
      if (story) item.summary = story;
    }),
  );
  return selected;
}

interface AihotHotTopicPayload {
  rank?: number;
  id?: string;
  title?: string;
  source?: { name?: string };
  links?: { aihot?: string; original?: string | null; story?: string | null };
  latestAt?: string;
}

function storyIdFromUrl(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.hostname !== "aihot.virxact.com") return undefined;
    const match = url.pathname.match(/^\/story\/([^/]+)$/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function mapHotTopic(item: AihotHotTopicPayload): AihotArticle {
  const sourceName = (item.source?.name ?? "").trim();
  return {
    id: (item.id ?? "").trim() || String(item.rank ?? ""),
    title: (item.title ?? "").trim(),
    sourceName: sourceName.length > 0 ? sourceName : "AI HOT",
    url: (item.links?.aihot ?? "").trim(),
    originalUrl: (item.links?.original ?? "").trim() || undefined,
    publishedAt: item.latestAt ?? "",
    rank: item.rank,
    storyId: storyIdFromUrl(item.links?.story),
  };
}

async function fetchAihotStory(
  publicId: string,
  fetcher: typeof fetch,
): Promise<string | undefined> {
  try {
    const response = await fetcher(BASE_URL + "/api/v1/stories/" + publicId, {
      headers: {
        accept: "application/json",
        "user-agent": USER_AGENT,
      },
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as {
      story?: { latest?: string | null; digest?: string | null };
    };
    const latest = payload.story?.latest?.trim();
    if (latest) return latest;
    const digest = payload.story?.digest?.trim();
    if (!digest) return undefined;
    return digest.split("\n")[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** @deprecated kept as an alias so older tests/imports keep compiling during the switch. */
export const fetchAihotSelected = fetchAihotHotTopics;
