import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Browsers and iOS ask for these fixed paths on their own; serve the
  // app's real icons instead of a 404.
  async rewrites() {
    return [
      { source: "/apple-touch-icon.png", destination: "/apple-icon.png" },
      { source: "/apple-touch-icon-precomposed.png", destination: "/apple-icon.png" },
    ];
  },
};

export default nextConfig;
