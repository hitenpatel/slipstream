/** @type {import('next').NextConfig} */
const SYNC_ORIGIN = process.env.NEXT_PUBLIC_SYNC_URL ?? "http://localhost:8787";

const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@slipstream/client", "@slipstream/protocol", "@slipstream/ui"],
  experimental: {
    // Cache Components, React Compiler etc. are enabled with M4 once the
    // authenticated app surface lands. M0 keeps the surface small on purpose.
  },
  // Traefik routes /api/{push,pull,sync,auth} to the sync container in prod,
  // so these rewrites are only consulted in dev and in the e2e harness, where
  // web and sync live on different ports on the same box.
  async rewrites() {
    return [
      { source: "/api/push", destination: `${SYNC_ORIGIN}/api/push` },
      { source: "/api/pull", destination: `${SYNC_ORIGIN}/api/pull` },
    ];
  },
};

export default nextConfig;
