import { MongoClient, type Collection, type Db } from "mongodb";
import type { Entity } from "@slipstream/protocol";

export type EntityDoc = Entity & { _id: string };
export type ClientDoc = { _id: string; lastMutationID: number };
export type CounterDoc = { _id: "global"; seq: number };

export interface SlipstreamDb {
  client: MongoClient;
  db: Db;
  entities: Collection<EntityDoc>;
  clients: Collection<ClientDoc>;
  counters: Collection<CounterDoc>;
  close(): Promise<void>;
  ensureIndexes(): Promise<void>;
}

export async function connect(uri: string, dbName = "slipstream"): Promise<SlipstreamDb> {
  const client = new MongoClient(uri, {
    readConcern: { level: "majority" },
    writeConcern: { w: "majority" },
  });
  await client.connect();
  const db = client.db(dbName);
  const entities = db.collection<EntityDoc>("entities");
  const clients = db.collection<ClientDoc>("clients");
  const counters = db.collection<CounterDoc>("counters");

  const out: SlipstreamDb = {
    client,
    db,
    entities,
    clients,
    counters,
    async close() {
      await client.close();
    },
    async ensureIndexes() {
      await entities.createIndex({ workspaceId: 1, version: 1 });
      await entities.createIndex({ kind: 1, projectId: 1 });
    },
  };

  return out;
}
