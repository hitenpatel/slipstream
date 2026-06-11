// The web app talks to the sync server through the public origin so the
// session cookie is sent. Public env var (NEXT_PUBLIC_*) so it's available on
// both server and client.
export const SYNC_ORIGIN =
  process.env.NEXT_PUBLIC_SYNC_URL ?? "http://localhost:8787";
