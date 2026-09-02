import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
