/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@threadsponder/shared'],
  output: 'standalone',
};

module.exports = nextConfig;
