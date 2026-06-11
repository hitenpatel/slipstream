import type { WebSocket } from "ws";
import type { ServerMessage } from "@slipstream/protocol";

/**
 * Tiny in-process registry mapping clientID → set of open sockets, with one
 * `pokeAll` that fires after a successful push.
 *
 * Workspace-scoped fan-out is the right design (only poke clients who share a
 * workspace with the pusher), but it depends on Memberships, which M4 wires up.
 * For M3 we poke everyone — the protocol stays correct, just slightly chatty.
 */
export class PokeBroker {
  private sockets = new Set<WebSocket>();

  add(socket: WebSocket): void {
    this.sockets.add(socket);
  }

  remove(socket: WebSocket): void {
    this.sockets.delete(socket);
  }

  size(): number {
    return this.sockets.size;
  }

  /** Fire a `poke` to every connected client. The caller decides when. */
  pokeAll(except?: WebSocket): void {
    const msg: ServerMessage = { type: "poke" };
    const payload = JSON.stringify(msg);
    for (const s of this.sockets) {
      if (s === except) continue;
      try {
        s.send(payload);
      } catch {
        // socket likely closing — leave cleanup to the close handler
      }
    }
  }
}
