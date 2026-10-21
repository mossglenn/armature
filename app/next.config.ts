import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // The types package ships TypeScript source, not a build; Next compiles it
  // with the app (see packages/types/README.md).
  transpilePackages: ["@armature/types"],
};

export default nextConfig;
