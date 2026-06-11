import { createStore, type StoreApi } from "zustand/vanilla";
import {
  MemoryTx,
  MemoryView,
  isMutatorName,
  type Entity,
  type EntityKind,
  type Mutation,
  type MutatorName,
  type PatchOp,
  runMutator,
  uuidv7,
} from "@slipstream/protocol";
import type { ClientStorage } from "./storage.js";
import type { Transport } from "./transport.js";

/**
 * The materialised view the UI subscribes to. It is always
 *   serverBase + unconfirmedOutbox
 * recomputed from scratch by `recomputeView`, so the only place state changes
 * is `applyPatch` (server side) and `appendOutbox`/`dropOutboxUpTo` (client
 * side). No-one mutates `view` directly.
 */
export interface EngineState {
  view: MemoryView;
  online: boolean;
  syncing: boolean;
  /** monotonic, client-local — used as the `id` of each new Mutation. */
  nextMutationId: number;
  /** last cookie the server told us about. */
  cookie: number;
  /** uuidv7 for this client, stable across sessions. */
  clientID: string;
}

export interface EngineOptions {
  storage: ClientStorage;
  transport: Transport;
  /** Test seam — defaults to Date.now(). */
  now?: () => number;
  /** Test seam — defaults to uuidv7(). */
  newId?: () => string;
}

export class Engine {
  readonly store: StoreApi<EngineState>;
  private readonly storage: ClientStorage;
  private readonly transport: Transport;
  private readonly now: () => number;
  private readonly newId: () => string;
  /** in-memory copy of serverBase, mirrored to storage. */
  private serverBase = new MemoryView();
  /** in-memory copy of the outbox; the storage layer is the durable copy. */
  private outbox: Mutation[] = [];

  private constructor(opts: EngineOptions, initial: EngineState) {
    this.storage = opts.storage;
    this.transport = opts.transport;
    this.now = opts.now ?? (() => Date.now());
    this.newId = opts.newId ?? uuidv7;
    this.store = createStore<EngineState>(() => initial);
  }

  /**
   * Boot the engine: read clientID + cookie + serverBase + outbox from storage,
   * compute the initial view, and return a ready-to-use Engine. Safe to call on
   * cold start; safe to call multiple times in tests on separate storage.
   */
  static async open(opts: EngineOptions): Promise<Engine> {
    const { storage } = opts;

    let clientID = (await storage.getMeta("clientID")) as string | undefined;
    if (!clientID) {
      clientID = (opts.newId ?? uuidv7)();
      await storage.setMeta("clientID", clientID);
    }
    const cookie = ((await storage.getMeta("cookie")) as number | undefined) ?? 0;

    const initial: EngineState = {
      view: new MemoryView(),
      online: true,
      syncing: false,
      nextMutationId: 1,
      cookie,
      clientID,
    };

    const engine = new Engine(opts, initial);

    // Seed the in-memory base from storage.
    const baseEntities = await storage.loadServerBase();
    for (const e of baseEntities) engine.serverBase.applyPut(e);

    // Seed the outbox.
    engine.outbox = await storage.loadOutbox();
    if (engine.outbox.length > 0) {
      // nextMutationId picks up after the highest seen so optimistic ids don't collide
      const maxId = engine.outbox[engine.outbox.length - 1]!.id;
      engine.store.setState({ nextMutationId: maxId + 1 });
    }

    engine.recomputeView();
    return engine;
  }

  /** Recompute the materialised view: serverBase + unconfirmed outbox replays. */
  private recomputeView(): void {
    const view = this.serverBase.clone();
    for (const m of this.outbox) {
      if (!isMutatorName(m.name)) continue;
      // Optimistic version is 0; the server stamps the real one. updatedAt uses
      // the time the mutation was queued so the UI shows reasonable freshness.
      const tx = new MemoryTx(view, { version: 0, now: this.now() });
      try {
        runMutator(tx, m.name, m.args);
      } catch {
        // a Zod-malformed local mutation is silently dropped from replay; it will
        // be rejected by the server and removed from the outbox on the next ack
      }
    }
    this.store.setState({ view });
  }

  /**
   * Apply a mutation locally and queue it for push. Returns the optimistic
   * Mutation so callers can correlate (used by tests).
   */
  async mutate<N extends MutatorName>(name: N, args: unknown): Promise<Mutation> {
    const state = this.store.getState();
    const m: Mutation = {
      id: state.nextMutationId,
      clientID: state.clientID,
      name,
      args,
    };
    this.outbox.push(m);
    await this.storage.appendOutbox(m);
    this.store.setState({ nextMutationId: state.nextMutationId + 1 });
    this.recomputeView();
    return m;
  }

  /**
   * Apply a pull patch: advance serverBase, drop confirmed outbox mutations,
   * remember the new cookie, recompute the view.
   */
  async applyPatch(patch: PatchOp[], cookie: number, lastMutationID: number): Promise<void> {
    for (const op of patch) {
      if (op.op === "put") {
        if (op.entity.deleted) {
          this.serverBase.applyDel(op.entity.kind, op.entity.id);
          await this.storage.delServerEntity(op.entity.kind, op.entity.id);
        } else {
          this.serverBase.applyPut(op.entity);
          await this.storage.putServerEntity(op.entity);
        }
      } else {
        this.serverBase.applyDel(op.kind, op.id);
        await this.storage.delServerEntity(op.kind, op.id);
      }
    }
    await this.dropConfirmed(lastMutationID);
    if (cookie !== this.store.getState().cookie) {
      await this.storage.setMeta("cookie", cookie);
      this.store.setState({ cookie });
    }
    this.recomputeView();
  }

  private async dropConfirmed(lastMutationID: number): Promise<void> {
    if (lastMutationID <= 0) return;
    this.outbox = this.outbox.filter((m) => m.id > lastMutationID);
    await this.storage.dropOutboxUpTo(lastMutationID);
  }

  /**
   * Push outbox to the server, then pull anything new. Either step may be a
   * no-op (empty outbox; nothing new on server). Sets `syncing` while in flight.
   */
  async sync(): Promise<void> {
    const state = this.store.getState();
    if (state.syncing) return;
    this.store.setState({ syncing: true });
    try {
      // PUSH
      if (this.outbox.length > 0) {
        const res = await this.transport.push({
          clientID: state.clientID,
          mutations: this.outbox,
        });
        await this.dropConfirmed(res.lastMutationID);
      }

      // PULL
      const pulled = await this.transport.pull({
        clientID: state.clientID,
        cookie: this.store.getState().cookie,
      });
      await this.applyPatch(pulled.patch, pulled.cookie, pulled.lastMutationID);
      this.store.setState({ online: true });
    } catch {
      this.store.setState({ online: false });
    } finally {
      this.store.setState({ syncing: false });
    }
  }

  // ---- testing / debugging helpers ----

  /** Test-only: peek at the durable in-memory state. */
  _peek(): { serverBase: MemoryView; outbox: Mutation[] } {
    return { serverBase: this.serverBase, outbox: [...this.outbox] };
  }

  get<K extends EntityKind>(kind: K, id: string): (Entity & { kind: K }) | undefined {
    return this.store.getState().view.get(kind, id);
  }
}
