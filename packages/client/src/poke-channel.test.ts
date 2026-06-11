import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualPokeChannel, WebSocketPokeChannel } from "./poke-channel.js";

describe("ManualPokeChannel", () => {
  it("fires every registered handler on fire()", () => {
    const ch = new ManualPokeChannel();
    const h1 = vi.fn();
    const h2 = vi.fn();
    ch.onPoke(h1);
    ch.onPoke(h2);
    ch.fire();
    ch.fire();
    expect(h1).toHaveBeenCalledTimes(2);
    expect(h2).toHaveBeenCalledTimes(2);
  });

  it("close() clears handlers so further fires are no-ops", () => {
    const ch = new ManualPokeChannel();
    const h = vi.fn();
    ch.onPoke(h);
    ch.close();
    ch.fire();
    expect(h).toHaveBeenCalledTimes(0);
  });
});

/**
 * A fake WebSocket that lets the test drive open/close/message synchronously.
 * The poke channel only touches onopen/onmessage/onclose/onerror and close().
 */
class FakeWS {
  static instances: FakeWS[] = [];
  url: string;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
  }

  emitOpen() {
    this.onopen?.();
  }
  emitMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  emitClose() {
    this.closed = true;
    this.onclose?.();
  }
  close() {
    this.closed = true;
  }
}

describe("WebSocketPokeChannel", () => {
  beforeEach(() => {
    FakeWS.instances = [];
  });
  afterEach(() => {
    FakeWS.instances = [];
  });

  it("fires onPoke when the server sends a {type:'poke'} frame", () => {
    const fired = vi.fn();
    const ch = new WebSocketPokeChannel({
      url: "ws://x/api/sync",
      WebSocketCtor: FakeWS as unknown as typeof WebSocket,
    });
    ch.onPoke(fired);
    const ws = FakeWS.instances[0]!;
    ws.emitOpen(); // open fires its own poke (resync after connect)
    expect(fired).toHaveBeenCalledTimes(1);
    ws.emitMessage({ type: "poke" });
    expect(fired).toHaveBeenCalledTimes(2);
    ws.emitMessage({ type: "hello", cookie: 7 }); // not a poke
    expect(fired).toHaveBeenCalledTimes(2);
    ch.close();
  });

  it("reconnects with exponential backoff after the socket closes", () => {
    const scheduled: Array<{ cb: () => void; ms: number }> = [];
    const schedule = (cb: () => void, ms: number) => {
      const entry = { cb, ms };
      scheduled.push(entry);
      return entry;
    };
    const cancel = () => {
      // tests don't rely on cancel here
    };

    const ch = new WebSocketPokeChannel({
      url: "ws://x/api/sync",
      WebSocketCtor: FakeWS as unknown as typeof WebSocket,
      schedule,
      cancel,
      minBackoffMs: 100,
      maxBackoffMs: 1000,
    });

    // 1st socket opens, server kills it
    FakeWS.instances[0]!.emitOpen();
    FakeWS.instances[0]!.emitClose();
    expect(scheduled.length).toBe(1);
    expect(scheduled[0]!.ms).toBe(100);

    // simulate timer firing — channel should connect again
    scheduled[0]!.cb();
    expect(FakeWS.instances.length).toBe(2);

    // 2nd socket drops without ever opening — backoff doubles
    FakeWS.instances[1]!.emitClose();
    expect(scheduled.length).toBe(2);
    expect(scheduled[1]!.ms).toBe(200);

    scheduled[1]!.cb();
    FakeWS.instances[2]!.emitClose();
    expect(scheduled[2]!.ms).toBe(400);

    // ceiling kicks in after enough doublings
    scheduled[2]!.cb();
    FakeWS.instances[3]!.emitClose();
    expect(scheduled[3]!.ms).toBe(800);

    scheduled[3]!.cb();
    FakeWS.instances[4]!.emitClose();
    expect(scheduled[4]!.ms).toBe(1000); // capped at max

    ch.close();
  });

  it("resets backoff to min after a successful open", () => {
    const scheduled: Array<{ cb: () => void; ms: number }> = [];
    const schedule = (cb: () => void, ms: number) => {
      const e = { cb, ms };
      scheduled.push(e);
      return e;
    };

    const ch = new WebSocketPokeChannel({
      url: "ws://x",
      WebSocketCtor: FakeWS as unknown as typeof WebSocket,
      schedule,
      cancel: () => {},
      minBackoffMs: 100,
    });

    // close before open — backoff doubles
    FakeWS.instances[0]!.emitClose();
    expect(scheduled[0]!.ms).toBe(100);
    scheduled[0]!.cb();
    FakeWS.instances[1]!.emitClose();
    expect(scheduled[1]!.ms).toBe(200);
    scheduled[1]!.cb();
    // now the third attempt actually opens
    FakeWS.instances[2]!.emitOpen();
    // ...and is then closed; backoff should be back to min
    FakeWS.instances[2]!.emitClose();
    expect(scheduled[2]!.ms).toBe(100);
    ch.close();
  });

  it("close() prevents further reconnects", () => {
    const scheduled: Array<{ cb: () => void; ms: number }> = [];
    const ch = new WebSocketPokeChannel({
      url: "ws://x",
      WebSocketCtor: FakeWS as unknown as typeof WebSocket,
      schedule: (cb, ms) => {
        const e = { cb, ms };
        scheduled.push(e);
        return e;
      },
      cancel: () => {},
      minBackoffMs: 100,
    });
    FakeWS.instances[0]!.emitOpen();
    ch.close();
    FakeWS.instances[0]!.emitClose();
    expect(scheduled.length).toBe(0); // no reconnect scheduled
  });
});
