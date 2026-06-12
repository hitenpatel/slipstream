import type { WebSocket } from "ws";
import type {
  PresenceFocus,
  PresenceUser,
  ServerMessage,
} from "@slipstream/protocol";
import type { AuthedSession } from "./auth.js";

/**
 * In-process registry of every authenticated WebSocket, plus the user it
 * belongs to and where in the app they're currently focused.
 *
 * Two public surfaces:
 *
 * - `pokeAll(...)`: fans out a {type:"poke"} message (the M3 behaviour).
 * - `setFocus(socket, focus)`: updates that socket's presence and fans the
 *   new workspace-scoped presence list to everyone in the same workspace.
 *
 * Per-workspace fan-out happens automatically because each socket knows its
 * workspaceId from the session it joined with. Anonymous sockets are a
 * thing of the past — every connection has been auth-gated by the time it
 * lands in `add()`.
 */
export class PresenceBroker {
  private entries = new Map<
    WebSocket,
    {
      session: AuthedSession;
      email: string;
      focus: PresenceFocus;
      updatedAt: number;
    }
  >();

  add(socket: WebSocket, session: AuthedSession, email: string): void {
    this.entries.set(socket, {
      session,
      email,
      focus: null,
      updatedAt: Date.now(),
    });
    // First connection: send them the current presence snapshot of their workspace.
    this.broadcastWorkspacePresence(session.workspaceId);
  }

  remove(socket: WebSocket): void {
    const entry = this.entries.get(socket);
    this.entries.delete(socket);
    if (entry) this.broadcastWorkspacePresence(entry.session.workspaceId);
  }

  size(): number {
    return this.entries.size;
  }

  /**
   * Update a socket's focus, refresh its updatedAt, and broadcast the new
   * workspace presence list. Idempotent on no-op transitions.
   */
  setFocus(socket: WebSocket, focus: PresenceFocus): void {
    const entry = this.entries.get(socket);
    if (!entry) return;
    if (sameFocus(entry.focus, focus)) return;
    entry.focus = focus;
    entry.updatedAt = Date.now();
    this.broadcastWorkspacePresence(entry.session.workspaceId);
  }

  /** Fire a poke to every connected socket. M3-era behaviour preserved. */
  pokeAll(except?: WebSocket): void {
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

  /**
   * Send the current presence snapshot for the workspace to each socket in it.
   * Each user is reported once per userId, collapsing multiple tabs into one
   * entry whose focus matches the most-recently-updated tab.
   */
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
