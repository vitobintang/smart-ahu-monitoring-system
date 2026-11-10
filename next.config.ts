import type { NextConfig } from "next";

const enforceHttps = process.env.ENFORCE_HTTPS_REDIRECT === "true";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "three"],
  },
  async headers() {
    return [
      {
        source: "/ahu/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=2592000",
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
        ],
      },
    ];
  },
  async redirects() {
    const routes = [
      // /ahu UI routes renamed to /devices (fleet now includes AC devices).
      // NOTE: single-segment ids only, so public asset paths like /ahu/logo.png stay untouched.
      { source: "/ahu", destination: "/devices", permanent: false },
      { source: "/ahu/:id((?!.*\\.).+)", destination: "/devices/:id", permanent: false },
    ];
    if (!enforceHttps) return routes;
    return [
      ...routes,
      {
        source: "/:path*",
        has: [
          { type: "header", key: "x-forwarded-proto", value: "http" },
          { type: "header", key: "host", value: "(?<host>.*)" },
        ],
        destination: "https://:host/:path*",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;