import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "server/index": "src/server/index.ts",
    "client/index": "src/client/index.ts",
    "react/index": "src/react/index.tsx",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  treeshake: true,
  splitting: false,
  sourcemap: true,
  // Peer/host packages are resolved from the consumer, never bundled.
  external: ["better-auth", "@better-auth/core", "react", "react-dom", "react/jsx-runtime"],
});
