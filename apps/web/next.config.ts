import type { NextConfig } from "next";

/**
 * Served under /weather so joalavedra.com can proxy the whole app to this
 * deployment with a path rewrite, the same way /sett is wired. Local dev runs
 * at http://localhost:3000/weather for the same reason.
 */
const config: NextConfig = {
  basePath: "/weather",
  serverExternalPackages: ["@weather/core"],
};

export default config;
