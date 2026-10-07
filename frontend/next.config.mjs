/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the app is served as plain files. No server runtime, no CDN assets.
  output: "export",
  reactStrictMode: true,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
