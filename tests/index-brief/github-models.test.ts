import test from "node:test";
import assert from "node:assert/strict";
import { runGithubModels } from "../../lib/index-brief/github-models";

test("calls GitHub Models with the workflow token", async () => {
  let authorization = "";
  const result = await runGithubModels(
    { systemPrompt: "中文", userPrompt: "翻译", timeoutMs: 1000 },
    {
      env: {
        GITHUB_TOKEN: "test-token",
        GITHUB_MODELS_MODEL: "openai/gpt-4o",
      },
      fetcher: async (_url, init) => {
        authorization =
          new Headers(init?.headers).get("authorization") ?? "";
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "{\"ok\":true}" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  );

  assert.equal(authorization, "Bearer test-token");
  assert.equal(result.text, "{\"ok\":true}");
});

test("rejects missing credentials and empty model output", async () => {
  await assert.rejects(
    () => runGithubModels({ systemPrompt: "x", userPrompt: "y" }, { env: {} }),
    /GITHUB_TOKEN/,
  );
  await assert.rejects(
    () =>
      runGithubModels(
        { systemPrompt: "x", userPrompt: "y" },
        {
          env: { GITHUB_TOKEN: "x" },
          fetcher: async () =>
            new Response(JSON.stringify({ choices: [] }), { status: 200 }),
        },
      ),
    /empty response/,
  );
});

test("rejects non-success API responses without exposing the token", async () => {
  await assert.rejects(
    () =>
      runGithubModels(
        { systemPrompt: "x", userPrompt: "y" },
        {
          env: { GITHUB_TOKEN: "secret-token" },
          fetcher: async () => new Response("rate limited", { status: 429 }),
        },
      ),
    (error: Error) => {
      assert.match(error.message, /HTTP 429/);
      assert.doesNotMatch(error.message, /secret-token/);
      return true;
    },
  );
});
