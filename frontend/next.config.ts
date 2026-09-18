import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production"
        ? {
            exclude: ["error", "warn"],
          }
        : false,
  },
  experimental: {
    optimizePackageImports: ["@stellar/stellar-sdk"],
  },
  turbopack: {
    // This app lives in a monorepo whose root also has its own lockfile;
    // pin the workspace root here so Turbopack doesn't have to guess from
    // lockfile detection (which the root's package-lock.json confuses).
    root: path.join(__dirname),
  },
  // Serve the mobile deep-link association files as JSON (issue #261).
  // Apple requires apple-app-site-association to have an application/json
  // content type and no file extension.
  async headers() {
    return [
      {
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
      {
        source: "/.well-known/assetlinks.json",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
    ];
  },
};

export default nextConfig;
