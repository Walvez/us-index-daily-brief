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
  /** ISO timestamp aligned to the AI HOT timeline (see timelineValue). */
  publishedAt: string;
}

interface AihotItemPayload {
  id: string;
  title?: string;
  originalTitle?: string | null;
  summary?: string | null;
  source?: { name?: string };
  links?: { aihot?: string; original?: string | null };
  publishedAt?: string | null;
  discoveredAt?: string;
  category?: string | null;
  score?: number | null;
  selected?: boolean;
}

const BASE_URL = "https://aihot.virxact.com";
const USER_AGENT = "aihot-skill/1.3.0 (+https://aihot.virxact.com/aihot-skill/)";
const BACKFILL_GAP_MS = 72 * 60 * 60 * 1000;

export interface FetchAihotOptions {
  window?: "24h" | "7d";
  limit?: number;
  fetcher?: typeof fetch;
}

export async function fetchAihotSelected(
  options: FetchAihotOptions = {},
): Promise<AihotArticle[]> {
  const window = options.window ?? "24h";
  const limit = Math.min(100, Math.max(1, options.limit ?? 10));
  const fetcher = options.fetcher ?? fetch;

  const url =
    BASE_URL + "/api/v1/items?mode=selected&window=" + window +
    "&limit=" + limit;
  const response = await fetcher(url, {
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error("AI HOT HTTP " + response.status);
  }

  const payload = (await response.json()) as { items?: AihotItemPayload[] };
  return (payload.items ?? [])
    .map(mapItem)
    .filter(
      (item): item is AihotArticle =>
        item.title.length > 0 &&
        item.url.length > 0 &&
        item.publishedAt.length > 0,
    );
}

function mapItem(item: AihotItemPayload): AihotArticle {
  const sourceName = (item.source?.name ?? "").trim();
  return {
    id: item.id,
    title: (item.title ?? "").trim(),
    sourceName: sourceName.length > 0 ? sourceName : "AI HOT",
    url: (item.links?.aihot ?? "").trim(),
    originalUrl: (item.links?.original ?? "").trim() || undefined,
    summary: (item.summary ?? "").trim() || undefined,
    publishedAt: timelineValue(item) ?? "",
  };
}

/**
 * Timeline value consistent with AI HOT default by=timeline window: use
 * discoveredAt unless the item is a historical backfill (published more than
 * 72h before discovery), in which case use publishedAt.
 */
function timelineValue(item: AihotItemPayload): string | null {
  const discovered = Date.parse(item.discoveredAt ?? "");
  const published = Date.parse(item.publishedAt ?? "");
  if (!Number.isFinite(discovered)) return item.publishedAt ?? null;
  if (Number.isFinite(published) && discovered - published > BACKFILL_GAP_MS) {
    return item.publishedAt ?? null;
  }
  return item.discoveredAt ?? null;
}
