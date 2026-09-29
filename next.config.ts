import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emits .next/standalone with a minimal server.js and only the traced
  // node_modules, so the Docker runtime stage stays small.
  output: 'standalone',
  // Required by `'use cache'` / `cacheLife` in lib/stats.
  cacheComponents: true,
};

export default nextConfig;
