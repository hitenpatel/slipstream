import type { Entity, EntityKind, EntityWriteHints } from "./entities.js";
import type { Tx } from "./tx.js";

/**
 * Concrete in-memory Tx. The materialised client view is a Map keyed by
 * `${kind}:${id}` so lookups stay O(1) and the view can be cloned cheaply via
 * structuredClone.
 *
 * `serverBase + unconfirmedOutbox` is computed by starting from a snapshot of
 * the server base view, building a MemoryView around the cloned map, and
 * replaying each outbox mutator against a MemoryTx that wraps it.
 */
export class MemoryView {
  // exported so the client store can snapshot it directly
  readonly entities = new Map<string, Entity>();

  static key(kind: EntityKind | string, id: string): string {
    return `${kind}:${id}`;
  }

  clone(): MemoryView {
    const next = new MemoryView();
    for (const [k, v] of this.entities) next.entities.set(k, structuredClone(v));
    return next;
  }

  applyPut(entity: Entity): void {
    this.entities.set(MemoryView.key(entity.kind, entity.id), entity);
  }

  applyDel(kind: EntityKind | string, id: string): void {
    this.entities.delete(MemoryView.key(kind, id));
  }

  get<K extends EntityKind>(kind: K, id: string): (Entity & { kind: K }) | undefined {
    const e = this.entities.get(MemoryView.key(kind, id));
    return e && e.kind === kind ? (e as Entity & { kind: K }) : undefined;
  }
}

export class MemoryTx implements Tx {
  constructor(
    private readonly view: MemoryView,
    readonly hints: EntityWriteHints,
  ) {}

  get<K extends EntityKind>(kind: K, id: string): (Entity & { kind: K }) | undefined {
    return this.view.get(kind, id);
  }

  put(entity: Entity): void {
    this.view.applyPut(entity);
  }

  del(kind: EntityKind, id: string): void {
    this.view.applyDel(kind, id);
  }
}
