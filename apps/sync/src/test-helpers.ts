import { MongoMemoryReplSet } from "mongodb-memory-server";
import { connect, type SlipstreamDb } from "./db.js";

/**
 * Start an in-memory single-node replica set. Mongo transactions need a
 * replica set even with one member, so this is the lightest setup that lets
 * the engine's push transaction actually run.
 */
export async function startMemoryDb(): Promise<{ db: SlipstreamDb; stop: () => Promise<void> }> {
  const replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const uri = replset.getUri();
  const db = await connect(uri, "slipstream-test");
  await db.ensureIndexes();
  return {
    db,
    stop: async () => {
      await db.close();
      await replset.stop();
    },
  };
}
