import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // zxing-wasm učitava .wasm sa diska (nije na Next-ovoj podrazumevanoj listi; sharp jeste).
  serverExternalPackages: ["zxing-wasm"],
};

export default nextConfig;
