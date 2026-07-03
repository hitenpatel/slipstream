import { state } from "./state";

export default async function globalTeardown(): Promise<void> {
  const s = state();
  s.web?.kill("SIGTERM");
  s.sync?.kill("SIGTERM");
  // Give processes a moment to close their ports so a re-run doesn't clash.
  await new Promise((r) => setTimeout(r, 500));
  await s.mongo?.stop();
}
