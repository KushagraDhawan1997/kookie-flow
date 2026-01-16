import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@kushagradhawan/kookie-flow'],
  experimental: {
    // Enable if needed
  },
};

export default nextConfig;
