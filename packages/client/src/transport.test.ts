import { afterEach, describe, expect, it } from "vitest";
import { HttpTransport } from "./transport.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("HttpTransport", () => {
  it("calls the default fetch unbound (regression: browsers throw Illegal invocation on a re-bound native fetch)", async () => {
    // Simulate the browser's this-sensitive native fetch.
    globalThis.fetch = function (this: unknown) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(
        new Response(JSON.stringify({ patch: [], cookie: 0, lastMutationID: 0 })),
      );
    } as typeof fetch;

    const transport = new HttpTransport("");
    const res = await transport.pull({ clientID: "c1", cookie: 0 });
    expect(res).toEqual({ patch: [], cookie: 0, lastMutationID: 0 });
  });
});
