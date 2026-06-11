/**
 * The poke channel is the seam between "something might be new" and "go pull".
 * Production wires a `WebSocketPokeChannel` to `/api/sync`; tests pass a
 * `ManualPokeChannel` they can fire directly.
 *
 * The channel doesn't carry data — it just nudges. The pull happens over HTTPS
 * via the Transport, so a dropped or restarted socket loses nothing.
 */
export interface PokeChannel {
  /** Called every time the server sends a poke or the socket reconnects. */
  onPoke(handler: () => void): void;
  /** Tear-down. Safe to call multiple times. */
  close(): void;
}

export class ManualPokeChannel implements PokeChannel {
  private handlers = new Set<() => void>();
  onPoke(h: () => void): void {
    this.handlers.add(h);
  }
  fire(): void {
    for (const h of this.handlers) h();
  }
  close(): void {
    this.handlers.clear();
  }
}

export interface WebSocketPokeChannelOptions {
  url: string;
  /**
   * WebSocket constructor (defaults to `globalThis.WebSocket`). Tests inject
   * the `ws` package's constructor to run under Node without jsdom.
   */
  WebSocketCtor?: typeof globalThis.WebSocket;
  /** initial backoff ms. defaults to 250. */
  minBackoffMs?: number;
  /** ceiling on backoff ms. defaults to 30s. */
  maxBackoffMs?: number;
  /** how long to wait before a poke triggers a sync. mostly for tests. defaults to 0. */
  debounceMs?: number;
  /** test seam — defaults to setTimeout/clearTimeout. */
  schedule?: (cb: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

type AnyWebSocketCtor = new (url: string) => globalThis.WebSocket;

export class WebSocketPokeChannel implements PokeChannel {
  private socket: globalThis.WebSocket | null = null;
  private handlers = new Set<() => void>();
  private closed = false;
  private backoff: number;
  private readonly minBackoff: number;
  private readonly maxBackoff: number;
  private readonly schedule: (cb: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private reconnectHandle: unknown | null = null;
  private debounceHandle: unknown | null = null;
  private readonly debounceMs: number;
  private readonly url: string;
  private readonly WSCtor: AnyWebSocketCtor;

  constructor(opts: WebSocketPokeChannelOptions) {
    this.url = opts.url;
    this.WSCtor = (opts.WebSocketCtor ?? (globalThis as { WebSocket?: AnyWebSocketCtor }).WebSocket) as AnyWebSocketCtor;
    if (!this.WSCtor) {
      throw new Error("no WebSocket implementation available");
    }
    this.minBackoff = opts.minBackoffMs ?? 250;
    this.maxBackoff = opts.maxBackoffMs ?? 30_000;
    this.debounceMs = opts.debounceMs ?? 0;
    this.backoff = this.minBackoff;
    this.schedule = opts.schedule ?? ((cb, ms) => setTimeout(cb, ms));
    this.cancel = opts.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.connect();
  }

  onPoke(h: () => void): void {
    this.handlers.add(h);
  }

  close(): void {
    this.closed = true;
    if (this.reconnectHandle !== null) {
      this.cancel(this.reconnectHandle);
      this.reconnectHandle = null;
    }
    if (this.debounceHandle !== null) {
      this.cancel(this.debounceHandle);
      this.debounceHandle = null;
    }
    if (this.socket) {
      const s = this.socket;
      this.socket = null;
      try {
        s.close();
      } catch {
        // ignore
      }
    }
    this.handlers.clear();
  }

  private connect(): void {
    if (this.closed) return;
    const socket = new this.WSCtor(this.url);
    this.socket = socket;

    socket.onopen = () => {
      // a fresh connection is itself a "you might be behind" signal — fire one
      // poke so the engine pulls anything missed during the disconnect window
      this.backoff = this.minBackoff;
      this.firePoke();
    };

    socket.onmessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)) as {
          type?: string;
        };
        if (msg.type === "poke") this.firePoke();
      } catch {
        // junk frames are ignored
      }
    };

    const handleEnd = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.closed) return;
      this.reconnectHandle = this.schedule(() => {
        this.reconnectHandle = null;
        this.backoff = Math.min(this.maxBackoff, this.backoff * 2);
        this.connect();
      }, this.backoff);
    };

    socket.onclose = handleEnd;
    socket.onerror = handleEnd;
  }

  private firePoke(): void {
    if (this.debounceMs <= 0) {
      for (const h of this.handlers) h();
      return;
    }
    if (this.debounceHandle !== null) return;
    this.debounceHandle = this.schedule(() => {
      this.debounceHandle = null;
      for (const h of this.handlers) h();
    }, this.debounceMs);
  }
}
