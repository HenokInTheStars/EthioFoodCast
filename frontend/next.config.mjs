/**
 * Next config. `output: "standalone"` is opt-in (NEXT_OUTPUT=standalone) so that
 * Vercel's own build output mode stays in control; set it only when containerising.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Pin the file-tracing root to this directory. Without it Next walks up looking
// for lockfiles and, if it finds one above frontend/ (a stray npm run in the Python
// backend directory leaves exactly that), it traces from there instead. That
// silently changes the standalone layout the Dockerfile copies from: server.js
// ends up nested one level down and `node server.js` cannot find it.
const here = dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  outputFileTracingRoot: here,
};

export default nextConfig;
