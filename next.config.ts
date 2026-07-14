import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@resvg/resvg-js', 'sharp'],
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;