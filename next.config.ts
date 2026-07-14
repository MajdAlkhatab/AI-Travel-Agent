import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tells Next.js not to bundle native binaries, fixing the Turbopack build error
  serverExternalPackages: ['@resvg/resvg-js', 'sharp'],
  
  // Tells Vercel to ignore ESLint and TypeScript errors during build
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;