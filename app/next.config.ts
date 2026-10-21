import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // The viewer's container image (docker/viewer.Dockerfile) runs the
  // standalone output: the built pages plus only the modules they import.
  // The tracing root is the workspace root, so the traced files keep the
  // repository's layout (app/ and packages/) inside .next/standalone.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, ".."),
  // The two packages ship TypeScript source, not a build; Next compiles them
  // with the app (see packages/types/README.md). The pages are a client of the
  // hub through @armature/client, like any plugin.
  transpilePackages: ["@armature/types", "@armature/client"],
};

export default nextConfig;
