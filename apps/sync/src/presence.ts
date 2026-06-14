import type { WebSocket } from "ws";
import type {
  PresenceFocus,
  PresenceUser,
  ServerMessage,
} from "@slipstream/protocol";
import type { AuthedSession } from "./auth.js";

/**
 * Registry of every authenticated WebSocket, plus the user it belongs to and
 * where in the app they're currently focused.
 *
 * Two implementations:
 *
 * - `InProcessPresenceBroker` (the M3 default): everything lives in this
 *   process's memory. Suitable when a single sync instance handles all
 *   connections — the homelab demo and `pnpm dev`.
 *
 * - `RedisPresenceBroker` (M7d): presence state lives in Redis hashes and
 *   pokes/changes fan out over Redis pub/sub. Multiple sync instances
 *   behind a load balancer see each other's clients; horizontal scale-out
 *   is just "add another container and point it at the same Redis".
 *
 * Both implement the same `PresenceBroker` interface, so the server wires
 * one or the other based on the `REDIS_URL` env var without callers
 * caring which is active.
 */
export interface PresenceBroker {
  /** Register an authenticated socket. */
  add(socket: WebSocket, session: AuthedSession, email: string): Promise<void>;
  /** Remove a socket on close/error. */
  remove(socket: WebSocket): Promise<void>;
  /** Update where a socket is focused. */
  setFocus(socket: WebSocket, focus: PresenceFocus): Promise<void>;
  /** Fan out a `poke` to every connected client, optionally excluding one. */
  pokeAll(except?: WebSocket): Promise<void>;
  /** Local connection count for the health endpoint. */
  size(): number;
  /** Optional teardown for backed implementations that hold resources. */
  close?(): Promise<void>;
}

/**
 * In-process implementation. Identical behaviour to the M3-era class. No
 * cross-instance coordination; sufficient for single-instance deployments.
 */
export class InProcessPresenceBroker implements PresenceBroker {
  private entries = new Map<
    WebSocket,
    {
      session: AuthedSession;
      email: string;
      focus: PresenceFocus;
      updatedAt: number;
    }
  >();

  async add(socket: WebSocket, session: AuthedSession, email: string): Promise<void> {
    this.entries.set(socket, {
      session,
      email,
      focus: null,
      updatedAt: Date.now(),
    });
    this.broadcastWorkspacePresence(session.workspaceId);
  }

  async remove(socket: WebSocket): Promise<void> {
    const entry = this.entries.get(socket);
    this.entries.delete(socket);
    if (entry) this.broadcastWorkspacePresence(entry.session.workspaceId);
  }

  size(): number {
    return this.entries.size;
  }

  async setFocus(socket: WebSocket, focus: PresenceFocus): Promise<void> {
    const entry = this.entries.get(socket);
    if (!entry) return;
    if (sameFocus(entry.focus, focus)) return;
    entry.focus = focus;
    entry.updatedAt = Date.now();
    this.broadcastWorkspacePresence(entry.session.workspaceId);
  }

  async pokeAll(except?: WebSocket): Promise<void> {
    const msg: ServerMessage = { type: "poke" };
    const payload = JSON.stringify(msg);
    for (const socket of this.entries.keys()) {
      if (socket === except) continue;
      try {
        socket.send(payload);
      } catch {
        // closing socket — leave cleanup to the close handler
      }
    }
  }

  private broadcastWorkspacePresence(workspaceId: string): void {
    const users = this.snapshotWorkspaceUsers(workspaceId);
    const msg: ServerMessage = { type: "presence", users };
    const payload = JSON.stringify(msg);
    for (const [socket, entry] of this.entries) {
      if (entry.session.workspaceId !== workspaceId) continue;
      try {
        socket.send(payload);
      } catch {
        // ignore — cleanup on close
      }
    }
  }

  private snapshotWorkspaceUsers(workspaceId: string): PresenceUser[] {
    // Most-recent-wins dedupe by userId.
    const byUser = new Map<string, PresenceUser>();
    for (const entry of this.entries.values()) {
      if (entry.session.workspaceId !== workspaceId) continue;
      const existing = byUser.get(entry.session.userId);
      const candidate: PresenceUser = {
        userId: entry.session.userId,
        email: entry.email,
        focus: entry.focus,
        updatedAt: entry.updatedAt,
      };
      if (!existing || existing.updatedAt < entry.updatedAt) {
        byUser.set(entry.session.userId, candidate);
      }
    }
    return Array.from(byUser.values()).sort((a, b) => a.email.localeCompare(b.email));
  }
}

function sameFocus(a: PresenceFocus, b: PresenceFocus): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.kind === b.kind && a.id === b.id;
}

export { sameFocus };
