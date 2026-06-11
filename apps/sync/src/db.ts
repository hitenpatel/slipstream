import { MongoClient, type Collection, type Db } from "mongodb";
import type { Entity } from "@slipstream/protocol";

export type EntityDoc = Entity & { _id: string };
export type ClientDoc = { _id: string; lastMutationID: number };
export type CounterDoc = { _id: "global"; seq: number };
/** account is the credential record; the in-engine User entity holds the profile. */
export type AccountDoc = {
  _id: string; // userId — same as the User entity's id
  email: string;
  passwordHash: string;
  workspaceId: string;
  createdAt: number;
};
export type SessionDoc = {
  _id: string; // random opaque token
  userId: string;
  workspaceId: string;
  createdAt: number;
  expiresAt: number;
};

export interface SlipstreamDb {
  client: MongoClient;
  db: Db;
  entities: Collection<EntityDoc>;
  clients: Collection<ClientDoc>;
  counters: Collection<CounterDoc>;
  accounts: Collection<AccountDoc>;
  sessions: Collection<SessionDoc>;
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
  const accounts = db.collection<AccountDoc>("accounts");
  const sessions = db.collection<SessionDoc>("sessions");

  const out: SlipstreamDb = {
    client,
    db,
    entities,
    clients,
    counters,
    accounts,
    sessions,
    async close() {
      await client.close();
    },
    async ensureIndexes() {
      await entities.createIndex({ workspaceId: 1, version: 1 });
      await entities.createIndex({ kind: 1, projectId: 1 });
      await accounts.createIndex({ email: 1 }, { unique: true });
      // expire sessions automatically when expiresAt passes
      await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    },
  };

  return out;
}
