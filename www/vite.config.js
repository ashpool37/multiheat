import { defineConfig } from "vite";
import zigar from "rollup-plugin-zigar";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  plugins: [
    zigar({
      optimize: "ReleaseFast",
      embedWASM: true,
      topLevelAwait: true,
      ignoreBuildFile: true,
      multithreaded: false,
    }),
  ],
}));
