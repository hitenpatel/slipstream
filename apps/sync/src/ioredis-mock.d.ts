/**
 * Type shim for ioredis-mock (the package ships JS only). The mock is used
 * only inside tests; the RedisLike structural type in presence-redis.ts is
 * what the broker actually requires, so we can declare RedisMock as a thin
 * class with no enumerated members and let structural typing do the rest.
 */
declare module "ioredis-mock" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const RedisMock: new (options?: unknown) => any;
  export default RedisMock;
}
