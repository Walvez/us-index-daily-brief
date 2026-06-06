import test from "node:test";
import assert from "node:assert/strict";
import { fetchTickerData } from "../../lib/trading/yahoo";

test("forwards the supplied AbortSignal to fetch", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let receivedSignal: AbortSignal | null | undefined;

  globalThis.fetch = async (_input, init) => {
    receivedSignal = init?.signal;
    return { ok: false } as Response;
  };

  try {
    const result = await fetchTickerData("TEST", controller.signal);

    assert.equal(result, null);
    assert.equal(receivedSignal, controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
