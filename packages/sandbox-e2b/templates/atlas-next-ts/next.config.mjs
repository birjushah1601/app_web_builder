/** @type {import('next').NextConfig} */
const nextConfig = {
  // E2B's preview iframe loads the sandbox over the e2b.app subdomain.
  // Allow any host so dev-server's CSRF-style host check doesn't reject
  // requests routed through E2B's port-forwarding domain.
  allowedDevOrigins: ["*.e2b.app", "*.e2b.dev"]
};
export default nextConfig;
