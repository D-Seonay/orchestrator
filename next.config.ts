import type { NextConfig } from 'next';

const config: NextConfig = {
  experimental: {
    instrumentationHook: true,
  },
};

export default config;
