/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The container builder for this app runs `npm install --workspaces=false`
  // inside `apps/react-chat-window`. Next.js will detect node_modules normally.
  experimental: {}
};

export default nextConfig;
