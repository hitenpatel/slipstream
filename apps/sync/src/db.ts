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

/**
 * Workspace invite. The token is the document id and is used in the
 * /join/<token> URL. `usedBy` flips to the joining userId on claim;
 * single-use tokens once consumed cannot be redeemed again.
 */
export type InviteDoc = {
  _id: string; // random opaque token
  workspaceId: string;
  invitedBy: string; // userId of the creator (whose email shows on the join page)
  createdAt: number;
  expiresAt: number;
  usedBy?: string;
  usedAt?: number;
};

export interface SlipstreamDb {
  client: MongoClient;
  db: Db;
  entities: Collection<EntityDoc>;
  clients: Collection<ClientDoc>;
  counters: Collection<CounterDoc>;
  accounts: Collection<AccountDoc>;
  sessions: Collection<SessionDoc>;
  invites: Collection<InviteDoc>;
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
  const invites = db.collection<InviteDoc>("invites");

  const out: SlipstreamDb = {
    client,
    db,
    entities,
    clients,
    counters,
    accounts,
    sessions,
    invites,
    async close() {
      await client.close();
    },
    async ensureIndexes() {
      await entities.createIndex({ workspaceId: 1, version: 1 });
      await entities.createIndex({ kind: 1, projectId: 1 });
      await accounts.createIndex({ email: 1 }, { unique: true });
      // expire sessions automatically when expiresAt passes
      await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      // expire invites the same way
      await invites.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await invites.createIndex({ workspaceId: 1 });
    },
  };

  return out;
}
