import type { LlmRunOptions, LlmRunResult } from "../ai/llm";

interface GithubModelsDependencies {
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
}

export async function runGithubModels(
  options: LlmRunOptions,
  dependencies: GithubModelsDependencies = {},
): Promise<LlmRunResult> {
  const env = dependencies.env ?? process.env;
  const token = env.GITHUB_TOKEN?.trim();
  if (!token) throw new Error("GITHUB_TOKEN is required for GitHub Models");

  const model = env.GITHUB_MODELS_MODEL?.trim() || "openai/gpt-4.1";
  const controller = new AbortController();
  const started = Date.now();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 120_000,
  );

  try {
    const response = await (dependencies.fetcher ?? fetch)(
      "https://models.github.ai/inference/chat/completions",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-github-api-version": "2026-03-10",
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 3000,
          messages: [
            { role: "system", content: options.systemPrompt },
            { role: "user", content: options.userPrompt },
          ],
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`GitHub Models HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("GitHub Models returned an empty response");
    return { text, durationMs: Date.now() - started };
  } finally {
    clearTimeout(timeout);
  }
}
