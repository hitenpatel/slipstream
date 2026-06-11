import { MongoMemoryReplSet } from "mongodb-memory-server";
import { connect, type SlipstreamDb } from "./db.js";
import { PokeBroker } from "./poke.js";

/**
 * Start an in-memory single-node replica set. Mongo transactions need a
 * replica set even with one member, so this is the lightest setup that lets
 * the engine's push transaction actually run.
 */
export async function startMemoryDb(): Promise<{
  db: SlipstreamDb;
  broker: PokeBroker;
  stop: () => Promise<void>;
}> {
  const replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const uri = replset.getUri();
  const db = await connect(uri, "slipstream-test");
  await db.ensureIndexes();
  const broker = new PokeBroker();
  return {
    db,
    broker,
    stop: async () => {
      await db.close();
      await replset.stop();
    },
  };
}
