import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A production build writes to the same .next the dev server is serving from,
  // which silently breaks it: the app keeps rendering but stops hydrating, so
  // every page looks fine and nothing responds. Twice this session that cost a
  // real debugging detour. `npm run build:check` sets NEXT_DIST_DIR so a
  // verification build lands somewhere harmless instead.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The repo root carries its own lockfile for the program and the SDK; pin the
  // trace root here so Next stops guessing between the two.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  // The Anchor browser build and @solana/web3.js both assume a global `Buffer`
  // and none of the node builtins. Provide the first, stub the rest.
  webpack: (config, { webpack, isServer }) => {
    config.plugins.push(
      new webpack.ProvidePlugin({
        Buffer: ["buffer", "Buffer"],
      })
    );
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        path: false,
        os: false,
        crypto: false,
        stream: false,
        zlib: false,
        http: false,
        https: false,
      };
    }
    return config;
  },
  eslint: {
    // The build gate here is `tsc`, not lint rules.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
