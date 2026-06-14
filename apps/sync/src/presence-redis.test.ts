import { describe, expect, it } from "vitest";
import RedisMock from "ioredis-mock";
import type { WebSocket } from "ws";
import type { PresenceFocus, ServerMessage } from "@slipstream/protocol";
import { RedisPresenceBroker } from "./presence-redis.js";

/**
 * Fake WebSocket — broker only calls `socket.send(string)` on it. We capture
 * each frame so the test can assert on the messages a client received.
 */
class FakeWS {
  sent: ServerMessage[] = [];
  send(payload: string): void {
    try {
      this.sent.push(JSON.parse(payload));
    } catch {
      // ignore — broker only sends JSON
    }
  }
  asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }
  /** Wait for at least one message of the given type to arrive. */
  async waitFor(type: ServerMessage["type"], timeoutMs = 1500): Promise<ServerMessage> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = this.sent.find((m) => m.type === type);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`no ${type} in ${timeoutMs}ms — got ${this.sent.map((m) => m.type).join(",")}`);
  }
  /** Last message of the given type. */
  last(type: ServerMessage["type"]): ServerMessage | undefined {
    return [...this.sent].reverse().find((m) => m.type === type);
  }
}

/**
 * ioredis-mock shares state across instances when each `new RedisMock()` is
 * constructed without options. That gives us a true two-process simulation:
 * each "instance" gets its own pair of pub/sub clients, but they all see the
 * same hash data + pub/sub channels.
 *
 * Real Redis has a couple of behavioural differences ioredis-mock papers
 * over (no actual TCP, no AUTH), but for the broker's interaction surface
 * (hset / hgetall / hdel / publish / subscribe / message events) it's the
 * authoritative spec — the same calls work identically on a real server.
 */
function newBroker(): RedisPresenceBroker {
  const pub = new RedisMock();
  const sub = new RedisMock();
  return new RedisPresenceBroker(pub, sub);
}

const aliceSession = {
  token: "alice-tok",
  userId: "alice",
  workspaceId: "ws-a",
};
const bobSession = {
  token: "bob-tok",
  userId: "bob",
  workspaceId: "ws-a", // same workspace
};
const eveSession = {
  token: "eve-tok",
  userId: "eve",
  workspaceId: "ws-b", // different workspace — should be isolated
};

describe("RedisPresenceBroker", () => {
  it("broadcasts presence across two instances in the same workspace", async () => {
    const instanceA = newBroker();
    const instanceB = newBroker();

    const aliceWS = new FakeWS();
    const bobWS = new FakeWS();

    await instanceA.add(aliceWS.asWebSocket(), aliceSession, "alice@x");
    await instanceB.add(bobWS.asWebSocket(), bobSession, "bob@x");

    // Both should eventually see both users in the workspace.
    const alicePresence = (await aliceWS.waitFor("presence")) as Extract<
      ServerMessage,
      { type: "presence" }
    >;
    const bobPresence = (await bobWS.waitFor("presence")) as Extract<
      ServerMessage,
      { type: "presence" }
    >;
    expect(alicePresence.users.map((u) => u.userId).sort()).toEqual(["alice", "bob"]);
    expect(bobPresence.users.map((u) => u.userId).sort()).toEqual(["alice", "bob"]);

    await instanceA.close();
    await instanceB.close();
  });

  it("isolates presence by workspace", async () => {
    const instanceA = newBroker();
    const instanceB = newBroker();

    const aliceWS = new FakeWS();
    const eveWS = new FakeWS();

    await instanceA.add(aliceWS.asWebSocket(), aliceSession, "alice@x");
    await instanceB.add(eveWS.asWebSocket(), eveSession, "eve@y");

    await aliceWS.waitFor("presence");
    await eveWS.waitFor("presence");

    const aliceUsers = (aliceWS.last("presence") as Extract<ServerMessage, { type: "presence" }>).users;
    const eveUsers = (eveWS.last("presence") as Extract<ServerMessage, { type: "presence" }>).users;
    expect(aliceUsers.map((u) => u.userId)).toEqual(["alice"]);
    expect(eveUsers.map((u) => u.userId)).toEqual(["eve"]);

    await instanceA.close();
    await instanceB.close();
  });

  it("propagates focus changes across instances", async () => {
    const instanceA = newBroker();
    const instanceB = newBroker();

    const aliceWS = new FakeWS();
    const bobWS = new FakeWS();

    await instanceA.add(aliceWS.asWebSocket(), aliceSession, "alice@x");
    await instanceB.add(bobWS.asWebSocket(), bobSession, "bob@x");

    await aliceWS.waitFor("presence");
    await bobWS.waitFor("presence");
    aliceWS.sent.length = 0;
    bobWS.sent.length = 0;

    // Alice focuses an issue. Bob (connected to instance B) should see it
    // via the Redis pub/sub fan-out.
    const focus: PresenceFocus = { kind: "issue", id: "issue-1" };
    await instanceA.setFocus(aliceWS.asWebSocket(), focus);

    const bobUpdate = (await bobWS.waitFor("presence")) as Extract<
      ServerMessage,
      { type: "presence" }
    >;
    const alice = bobUpdate.users.find((u) => u.userId === "alice");
    expect(alice?.focus).toEqual({ kind: "issue", id: "issue-1" });

    await instanceA.close();
    await instanceB.close();
  });

  it("fans pokes out across instances", async () => {
    const instanceA = newBroker();
    const instanceB = newBroker();

    const aliceWS = new FakeWS();
    const bobWS = new FakeWS();

    await instanceA.add(aliceWS.asWebSocket(), aliceSession, "alice@x");
    await instanceB.add(bobWS.asWebSocket(), bobSession, "bob@x");
    await aliceWS.waitFor("presence");
    await bobWS.waitFor("presence");

    await instanceA.pokeAll();

    await aliceWS.waitFor("poke");
    await bobWS.waitFor("poke");

    await instanceA.close();
    await instanceB.close();
  });

  it("dedupes by userId across multiple tabs of the same user", async () => {
    const instanceA = newBroker();
    const instanceB = newBroker();

    // Two tabs for Alice, one on each instance.
    const aliceTabA = new FakeWS();
    const aliceTabB = new FakeWS();

    await instanceA.add(aliceTabA.asWebSocket(), aliceSession, "alice@x");
    await instanceB.add(aliceTabB.asWebSocket(), aliceSession, "alice@x");

    await aliceTabA.waitFor("presence");
    await aliceTabB.waitFor("presence");

    const presence = (aliceTabB.last("presence") as Extract<ServerMessage, { type: "presence" }>).users;
    expect(presence.map((u) => u.userId)).toEqual(["alice"]); // one Alice, not two

    await instanceA.close();
    await instanceB.close();
  });

  it("removes presence and re-broadcasts on disconnect", async () => {
    const instanceA = newBroker();
    const instanceB = newBroker();

    const aliceWS = new FakeWS();
    const bobWS = new FakeWS();

    await instanceA.add(aliceWS.asWebSocket(), aliceSession, "alice@x");
    await instanceB.add(bobWS.asWebSocket(), bobSession, "bob@x");
    await aliceWS.waitFor("presence");
    await bobWS.waitFor("presence");
    bobWS.sent.length = 0;

    await instanceA.remove(aliceWS.asWebSocket());

    const update = (await bobWS.waitFor("presence")) as Extract<
      ServerMessage,
      { type: "presence" }
    >;
    expect(update.users.map((u) => u.userId)).toEqual(["bob"]); // Alice gone

    await instanceA.close();
    await instanceB.close();
  });
});
