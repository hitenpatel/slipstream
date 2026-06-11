import { openDB, type IDBPDatabase } from "idb";
import type { Entity, Mutation } from "@slipstream/protocol";

/**
 * Persistent state lives in IndexedDB so the app opens instantly offline:
 *
 *   - `serverBase`    one snapshot of every entity the server has confirmed.
 *                     Keyed by `${kind}:${id}`. Includes tombstones until pruned.
 *   - `outbox`        pending mutations the server hasn't yet confirmed.
 *                     Keyed by client-local id (autoIncrementing? no — we mint
 *                     ourselves so re-saving the same mutation is idempotent).
 *   - `meta`          singleton documents: cookie, clientID, lastMutationID.
 *
 * The store is intentionally tiny — keep the engine's storage surface narrow so
 * it stays trivial to reason about.
 */

const DB_NAME = "slipstream";
const DB_VERSION = 1;

type MetaKey = "cookie" | "clientID" | "lastMutationID";

export interface ClientStorage {
  getMeta(key: MetaKey): Promise<unknown>;
  setMeta(key: MetaKey, value: unknown): Promise<void>;

  loadServerBase(): Promise<Entity[]>;
  putServerEntity(entity: Entity): Promise<void>;
  delServerEntity(kind: string, id: string): Promise<void>;

  loadOutbox(): Promise<Mutation[]>;
  appendOutbox(m: Mutation): Promise<void>;
  dropOutboxUpTo(id: number): Promise<void>;
  clearAll(): Promise<void>;
}

export async function openClientStorage(name: string = DB_NAME): Promise<ClientStorage> {
  const db = await openDB(name, DB_VERSION, {
    upgrade(d) {
      if (!d.objectStoreNames.contains("serverBase")) d.createObjectStore("serverBase");
      if (!d.objectStoreNames.contains("outbox")) d.createObjectStore("outbox", { keyPath: "id" });
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
    },
  });
  return new IdbClientStorage(db);
}

class IdbClientStorage implements ClientStorage {
  constructor(private readonly db: IDBPDatabase) {}

  static key(kind: string, id: string): string {
    return `${kind}:${id}`;
  }

  async getMeta(key: MetaKey): Promise<unknown> {
    return this.db.get("meta", key);
  }
  async setMeta(key: MetaKey, value: unknown): Promise<void> {
    await this.db.put("meta", value, key);
  }

  async loadServerBase(): Promise<Entity[]> {
    return (await this.db.getAll("serverBase")) as Entity[];
  }
  async putServerEntity(entity: Entity): Promise<void> {
    await this.db.put("serverBase", entity, IdbClientStorage.key(entity.kind, entity.id));
  }
  async delServerEntity(kind: string, id: string): Promise<void> {
    await this.db.delete("serverBase", IdbClientStorage.key(kind, id));
  }

  async loadOutbox(): Promise<Mutation[]> {
    const all = (await this.db.getAll("outbox")) as Mutation[];
    return all.sort((a, b) => a.id - b.id);
  }
  async appendOutbox(m: Mutation): Promise<void> {
    await this.db.put("outbox", m);
  }
  async dropOutboxUpTo(id: number): Promise<void> {
    const tx = this.db.transaction("outbox", "readwrite");
    const store = tx.objectStore("outbox");
    let cursor = await store.openCursor();
    while (cursor) {
      const m = cursor.value as Mutation;
      if (m.id <= id) await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }
  async clearAll(): Promise<void> {
    await Promise.all([
      this.db.clear("serverBase"),
      this.db.clear("outbox"),
      this.db.clear("meta"),
    ]);
  }
}

/**
 * An in-memory implementation used by tests and any embedding that wants to
 * skip IndexedDB (e.g. SSR or a deliberate ephemeral session).
 */
export class MemoryClientStorage implements ClientStorage {
  private meta = new Map<string, unknown>();
  private base = new Map<string, Entity>();
  private outbox = new Map<number, Mutation>();

  async getMeta(key: MetaKey): Promise<unknown> {
    return this.meta.get(key);
  }
  async setMeta(key: MetaKey, value: unknown): Promise<void> {
    this.meta.set(key, value);
  }

  async loadServerBase(): Promise<Entity[]> {
    return Array.from(this.base.values());
  }
  async putServerEntity(entity: Entity): Promise<void> {
    this.base.set(IdbClientStorage.key(entity.kind, entity.id), entity);
  }
  async delServerEntity(kind: string, id: string): Promise<void> {
    this.base.delete(IdbClientStorage.key(kind, id));
  }

  async loadOutbox(): Promise<Mutation[]> {
    return Array.from(this.outbox.values()).sort((a, b) => a.id - b.id);
  }
  async appendOutbox(m: Mutation): Promise<void> {
    this.outbox.set(m.id, m);
  }
  async dropOutboxUpTo(id: number): Promise<void> {
    for (const key of this.outbox.keys()) if (key <= id) this.outbox.delete(key);
  }
  async clearAll(): Promise<void> {
    this.meta.clear();
    this.base.clear();
    this.outbox.clear();
  }
}
