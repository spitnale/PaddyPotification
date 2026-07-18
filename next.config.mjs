/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produce a self-contained server (.next/standalone/server.js) so the desktop
  // app can bundle + run it via a bundled Node binary — no system Node needed.
  output: 'standalone',
};

export default nextConfig;
