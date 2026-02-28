import type { PaperSource } from "./types.js";

const S2_API_BASE = "https://api.semanticscholar.org/graph/v1";

/**
 * Search Semantic Scholar for papers related to a manipulation technique.
 */
export async function searchPapers(
  techniqueName: string,
  limit: number = 5,
  apiKey?: string
): Promise<PaperSource[]> {
  const query = `${techniqueName} propaganda manipulation rhetoric`;
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    fields: "paperId,title,url,year,abstract",
  });

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  const res = await fetch(
    `${S2_API_BASE}/paper/search?${params.toString()}`,
    { headers }
  );

  if (!res.ok) {
    throw new Error(`Semantic Scholar API error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    data?: Array<{
      paperId?: string;
      title?: string;
      url?: string;
      year?: number;
      abstract?: string;
    }>;
  };

  const papers = data?.data ?? [];
  return papers
    .filter((p) => p.paperId && p.title)
    .map((p) => ({
      paperId: p.paperId!,
      title: p.title!,
      url: p.url ?? `https://www.semanticscholar.org/paper/${p.paperId}`,
      year: p.year,
      abstract: p.abstract,
    }));
}
