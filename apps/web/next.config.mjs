/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@slipstream/client", "@slipstream/protocol", "@slipstream/ui"],
  experimental: {
    // Cache Components, React Compiler etc. are enabled with M4 once the
    // authenticated app surface lands. M0 keeps the surface small on purpose.
  },
};

export default nextConfig;
