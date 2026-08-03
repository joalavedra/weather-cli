import type { NextConfig } from "next";

/**
 * Served under /weather so joalavedra.com can proxy the whole app to this
 * deployment with a path rewrite, the same way /sett is wired. Local dev runs
 * at http://localhost:3000/weather for the same reason.
 */
const config: NextConfig = {
  basePath: "/weather",
  /**
   * `@weather/core` is a workspace package, so it must be bundled rather than
   * left external. Marking it external tells Next to resolve it from
   * node_modules at runtime, and a pnpm workspace symlink doesn't survive into
   * a serverless bundle — every route that touched core returned 500 in
   * production while building and running fine locally.
   */
  transpilePackages: ["@weather/core"],
};

export default config;
