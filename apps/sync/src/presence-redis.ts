import { randomBytes } from "node:crypto";
import type { WebSocket } from "ws";
import type {
  PresenceFocus,
  PresenceUser,
  ServerMessage,
} from "@slipstream/protocol";
import type { AuthedSession } from "./auth.js";
import { sameFocus, type PresenceBroker } from "./presence.js";

/**
 * Minimal structural type the broker uses. Both `ioredis.Redis` and
 * `ioredis-mock` satisfy this — declaring it here decouples the broker from
 * the ioredis type tree and lets tests pass either implementation.
 */
export interface RedisLike {
  hset(key: string, field: string, value: string): Promise<unknown>;
  hdel(key: string, field: string): Promise<unknown>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;
  on(event: "message", listener: (channel: string, message: string) => void): unknown;
  disconnect(): void;
}

/**
 * Redis-backed broker. Each sync instance:
 *
 *   1. Stores its sockets' presence entries under a workspace-scoped Redis hash
 *      `presence:<workspaceId>`, keyed by `<instanceId>:<socketId>`.
 *   2. Subscribes to the workspace's `presence:<workspaceId>:changed` and
 *      `poke:<workspaceId>` pub/sub channels.
 *   3. On any local change, writes the hash + publishes a small notification.
 *   4. On any incoming pub/sub message, refreshes its local snapshot from the
 *      hash and fans out to its local sockets.
 *
 * This means a user connected to sync-A can see the avatar of a user connected
 * to sync-B as long as both instances point at the same Redis. Pokes fan out
 * the same way: a push on sync-A nudges every client across the cluster.
 *
 * Failure modes:
 *
 * - Redis goes away: in-flight publishes throw; the catch swallows; presence
 *   stops fanning out across instances but local fan-out still works. A
 *   future M7e could surface this as an operator alert.
 * - An instance crashes: its hash entries are left orphaned until another
 *   change to that workspace causes a rebuild. A future improvement is per-
 *   entry TTL + heartbeat; for the M7d scope the "vacuum on next change"
 *   pattern is good enough.
 */
export class RedisPresenceBroker implements PresenceBroker {
  /** Stable id for this process, written into each hash field so we can
   *  tell our own entries apart from other instances'. */
  readonly instanceId: string = randomBytes(8).toString("hex");

  /** Local socket → {session, socketId, last published payload} mapping. */
  private locals = new Map<
    WebSocket,
    { session: AuthedSession; email: string; socketId: string }
  >();
  /** Per-workspace count of local sockets — used to subscribe/unsubscribe
   *  to/from a workspace's pub/sub channels lazily. */
  private workspaceLocalCount = new Map<string, number>();

  constructor(
    private readonly pub: RedisLike,
    private readonly sub: RedisLike,
  ) {
    this.sub.on("message", (channel, msg) => {
      void this.onChannelMessage(channel, msg);
    });
  }

  size(): number {
    return this.locals.size;
  }

  async close(): Promise<void> {
    // Best-effort: drop hash entries owned by this instance and disconnect.
    for (const ws of [...this.locals.keys()]) await this.remove(ws);
    this.pub.disconnect();
    this.sub.disconnect();
  }

  async add(socket: WebSocket, session: AuthedSession, email: string): Promise<void> {
    const socketId = randomBytes(8).toString("hex");
    this.locals.set(socket, { session, email, socketId });
    await this.ensureSubscribed(session.workspaceId);

    const entry = {
      userId: session.userId,
      email,
      focus: null as PresenceFocus,
      updatedAt: Date.now(),
    };
    await this.pub.hset(
      this.hashKey(session.workspaceId),
      this.field(socketId),
      JSON.stringify(entry),
    );
    await this.publishChange(session.workspaceId);
  }

  async remove(socket: WebSocket): Promise<void> {
    const local = this.locals.get(socket);
    if (!local) return;
    this.locals.delete(socket);
    try {
      await this.pub.hdel(this.hashKey(local.session.workspaceId), this.field(local.socketId));
      await this.publishChange(local.session.workspaceId);
    } catch {
      // Redis unhappy — local cleanup already done.
    }
    await this.maybeUnsubscribe(local.session.workspaceId);
  }

  async setFocus(socket: WebSocket, focus: PresenceFocus): Promise<void> {
    const local = this.locals.get(socket);
    if (!local) return;

    const key = this.hashKey(local.session.workspaceId);
    const fieldKey = this.field(local.socketId);
    const existingRaw = await this.pub.hget(key, fieldKey);
    const existing = existingRaw
      ? (JSON.parse(existingRaw) as { focus: PresenceFocus })
      : { focus: null as PresenceFocus };
    if (sameFocus(existing.focus, focus)) return;

    const entry = {
      userId: local.session.userId,
      email: local.email,
      focus,
      updatedAt: Date.now(),
    };
    await this.pub.hset(key, fieldKey, JSON.stringify(entry));
    await this.publishChange(local.session.workspaceId);
  }

  async pokeAll(except?: WebSocket): Promise<void> {
    // Fan out across the cluster. Each workspace this instance has clients
    // in publishes its own poke; subscribed instances will deliver to their
    // own locals.
    const sentWorkspaces = new Set<string>();
    for (const local of this.locals.values()) {
      const w = local.session.workspaceId;
      if (sentWorkspaces.has(w)) continue;
      sentWorkspaces.add(w);
      try {
        await this.pub.publish(
          this.pokeChannel(w),
          JSON.stringify({ except: except ? this.locals.get(except)?.socketId : null }),
        );
      } catch {
        // ignore — best-effort cluster fan-out
      }
    }
  }

  // ---------- helpers ----------

  private hashKey(workspaceId: string): string {
    return `presence:${workspaceId}`;
  }
  private field(socketId: string): string {
    return `${this.instanceId}:${socketId}`;
  }
  private changedChannel(workspaceId: string): string {
    return `presence:${workspaceId}:changed`;
  }
  private pokeChannel(workspaceId: string): string {
    return `poke:${workspaceId}`;
  }

  private async ensureSubscribed(workspaceId: string): Promise<void> {
    const before = this.workspaceLocalCount.get(workspaceId) ?? 0;
    this.workspaceLocalCount.set(workspaceId, before + 1);
    if (before > 0) return;
    await this.sub.subscribe(this.changedChannel(workspaceId), this.pokeChannel(workspaceId));
  }

  private async maybeUnsubscribe(workspaceId: string): Promise<void> {
    const before = this.workspaceLocalCount.get(workspaceId) ?? 0;
    const after = Math.max(0, before - 1);
    if (after > 0) {
      this.workspaceLocalCount.set(workspaceId, after);
      return;
    }
    this.workspaceLocalCount.delete(workspaceId);
    try {
      await this.sub.unsubscribe(
        this.changedChannel(workspaceId),
        this.pokeChannel(workspaceId),
      );
    } catch {
      // ignore — the connection may already be closing
    }
  }

  private async publishChange(workspaceId: string): Promise<void> {
    try {
      await this.pub.publish(this.changedChannel(workspaceId), "1");
    } catch {
      // ignore — best-effort
    }
  }

  private async onChannelMessage(channel: string, _msg: string): Promise<void> {
    if (channel.startsWith("presence:") && channel.endsWith(":changed")) {
      const workspaceId = channel.slice("presence:".length, -":changed".length);
      await this.fanOutPresence(workspaceId);
      return;
    }
    if (channel.startsWith("poke:")) {
      const workspaceId = channel.slice("poke:".length);
      let except: string | null = null;
      try {
        const body = JSON.parse(_msg) as { except: string | null };
        except = body.except;
      } catch {
        // not JSON — treat as no exclusion
      }
      this.fanOutPoke(workspaceId, except);
    }
  }

  private async fanOutPresence(workspaceId: string): Promise<void> {
    const users = await this.snapshotWorkspaceUsers(workspaceId);
    const msg: ServerMessage = { type: "presence", users };
    const payload = JSON.stringify(msg);
    for (const [socket, local] of this.locals) {
      if (local.session.workspaceId !== workspaceId) continue;
      try {
        socket.send(payload);
      } catch {
        // closing socket
      }
    }
  }

  private fanOutPoke(workspaceId: string, exceptSocketId: string | null): void {
    const msg: ServerMessage = { type: "poke" };
    const payload = JSON.stringify(msg);
    for (const [socket, local] of this.locals) {
      if (local.session.workspaceId !== workspaceId) continue;
      if (exceptSocketId && local.socketId === exceptSocketId) continue;
      try {
        socket.send(payload);
      } catch {
        // closing socket
      }
    }
  }

  private async snapshotWorkspaceUsers(workspaceId: string): Promise<PresenceUser[]> {
    const all = await this.pub.hgetall(this.hashKey(workspaceId));
    const byUser = new Map<string, PresenceUser>();
    for (const raw of Object.values(all)) {
      let entry: PresenceUser;
      try {
        entry = JSON.parse(raw) as PresenceUser;
      } catch {
        continue;
      }
      const existing = byUser.get(entry.userId);
      if (!existing || existing.updatedAt < entry.updatedAt) {
        byUser.set(entry.userId, entry);
      }
    }
    return Array.from(byUser.values()).sort((a, b) => a.email.localeCompare(b.email));
  }
}
