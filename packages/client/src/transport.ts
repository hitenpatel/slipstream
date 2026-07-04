import type { PullRequest, PullResponse, PushRequest, PushResponse } from "@slipstream/protocol";

/**
 * Transport is the seam between the engine and the network. Production wires
 * `HttpTransport` to the sync server's HTTPS endpoints; tests pass a transport
 * that calls the server's handlers in-process.
 */
export interface Transport {
  push(req: PushRequest): Promise<PushResponse>;
  pull(req: PullRequest): Promise<PullResponse>;
}

export class HttpTransport implements Transport {
  constructor(
    private readonly baseUrl: string,
    // The default must stay a free call: assigning the native fetch here and
    // invoking it as `this.fetchImpl(...)` makes the browser see HttpTransport
    // as the receiver and throw "Illegal invocation" before any network I/O.
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async push(req: PushRequest): Promise<PushResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/push`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`push failed: ${res.status}`);
    return (await res.json()) as PushResponse;
  }

  async pull(req: PullRequest): Promise<PullResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/pull`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`pull failed: ${res.status}`);
    return (await res.json()) as PullResponse;
  }
}
