import { defineConfig } from "vite";
import zigar from "rollup-plugin-zigar";

export default defineConfig({
  plugins: [
    zigar({
      optimize: "ReleaseFast",
      embedWASM: true,
      topLevelAwait: true,
      ignoreBuildFile: true,
    }),
  ],
});
