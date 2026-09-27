import { builtinModules } from "node:module";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const nodeBuiltins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

export default defineConfig({
  plugins: [{
    name: "reasongraph-cli-executable",
    closeBundle: () => chmodSync(fileURLToPath(new URL("./dist/cli.js", import.meta.url)), 0o755),
  }],
  build: {
    target: "node20",
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      input: "src/cli.ts",
      external: (id) => nodeBuiltins.has(id),
      output: {
        format: "es",
        entryFileNames: "cli.js",
      },
    },
  },
});
