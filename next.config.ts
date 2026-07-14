import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tells Next.js not to bundle native binaries, fixing the Turbopack build error
  serverExternalPackages: ['@resvg/resvg-js', 'sharp'],
};

export default nextConfig;