import type { ClientSession } from "mongodb";
import type { Entity, EntityKind, EntityWriteHints, Tx } from "@slipstream/protocol";
import type { SlipstreamDb } from "./db.js";

/**
 * Server-side Tx. Reads and writes go through a MongoDB ClientSession so the
 * push handler can wrap a whole batch of mutators in one withTransaction call.
 *
 * The mutator never knows about Mongo — it just sees Tx. That's the point.
 *
 * Reads are buffered: within one transaction, multiple gets for the same entity
 * return the same buffered value, and a put updates the buffer so a later get
 * sees what the mutator just wrote. The buffer is flushed at the end of the
 * mutator batch by `flush`.
 */
export class MongoTx implements Tx {
  private readonly puts = new Map<string, Entity>();
  private readonly dels = new Map<string, { kind: EntityKind; id: string }>();
  private readonly reads = new Map<string, Entity | undefined>();

  constructor(
    private readonly db: SlipstreamDb,
    private readonly session: ClientSession,
    readonly hints: EntityWriteHints,
  ) {}

  static key(kind: EntityKind | string, id: string): string {
    return `${kind}:${id}`;
  }

  get<K extends EntityKind>(kind: K, id: string): (Entity & { kind: K }) | undefined {
    const k = MongoTx.key(kind, id);
    if (this.dels.has(k)) return undefined;
    if (this.puts.has(k)) {
      const e = this.puts.get(k)!;
      return e.kind === kind ? (e as Entity & { kind: K }) : undefined;
    }
    if (this.reads.has(k)) {
      const e = this.reads.get(k);
      return e && e.kind === kind ? (e as Entity & { kind: K }) : undefined;
    }
    // First read; we have to go to Mongo synchronously-from-the-mutator's-POV.
    // The mutator API is synchronous by design — to support that we pre-load
    // before running each mutator (see prefetch). If we get here it's a miss.
    return undefined;
  }

  put(entity: Entity): void {
    const k = MongoTx.key(entity.kind, entity.id);
    this.puts.set(k, entity);
    this.dels.delete(k);
  }

  del(kind: EntityKind, id: string): void {
    const k = MongoTx.key(kind, id);
    this.dels.set(k, { kind, id });
    this.puts.delete(k);
  }

  /**
   * Pre-load any entities the mutator might reference. The protocol's mutators
   * always look entities up by id, so the caller knows which ids to prefetch
   * based on the mutation args. For M1 we keep it simple: prefetch by (kind, id)
   * pairs the handler is told about; mutators that don't touch a known id are
   * unaffected.
   */
  async prefetch(refs: Array<{ kind: EntityKind; id: string }>): Promise<void> {
    const missing = refs.filter((r) => !this.reads.has(MongoTx.key(r.kind, r.id)));
    if (missing.length === 0) return;
    const ids = missing.map((r) => r.id);
    const docs = await this.db.entities
      .find({ _id: { $in: ids } }, { session: this.session })
      .toArray();
    const byId = new Map(docs.map((d) => [d._id, d]));
    for (const r of missing) {
      const doc = byId.get(r.id);
      if (doc && doc.kind === r.kind) {
        // strip _id (we store it as both id and _id) before exposing to mutators
        const { _id, ...rest } = doc;
        void _id;
        this.reads.set(MongoTx.key(r.kind, r.id), rest as Entity);
      } else {
        this.reads.set(MongoTx.key(r.kind, r.id), undefined);
      }
    }
  }

  /**
   * Apply buffered puts and dels to Mongo inside the current session. The
   * caller is responsible for the transaction lifecycle.
   */
  async flush(): Promise<void> {
    const ops: Promise<unknown>[] = [];
    for (const entity of this.puts.values()) {
      // The Mongo replacement doc shouldn't carry _id; the filter already pins
      // it. We cast the entity itself to the doc type since the entity carries
      // every field of EntityDoc except _id.
      ops.push(
        this.db.entities.replaceOne(
          { _id: entity.id },
          entity as unknown as Parameters<typeof this.db.entities.replaceOne>[1],
          { upsert: true, session: this.session },
        ),
      );
    }
    for (const { kind, id } of this.dels.values()) {
      ops.push(this.db.entities.deleteOne({ _id: id, kind }, { session: this.session }));
    }
    await Promise.all(ops);
    this.puts.clear();
    this.dels.clear();
  }
}
