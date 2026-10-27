import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // A self-contained server for the Docker image (.next/standalone).
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // Headers on every page: no framing (clickjacking), no MIME sniffing, no referrer leaks, no camera/microphone/location.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  async redirects() {
    return [{ source: "/", destination: "/tickets", permanent: false }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
