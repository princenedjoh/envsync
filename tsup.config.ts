import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("./package.json", "utf8"));

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm"],
  dts: { entry: "src/index.ts" },
  clean: true,
  target: "node20",
  define: { __VERSION__: JSON.stringify(version) },
});
