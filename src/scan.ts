import { readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", ".expo", ".turbo", "Pods", "ios", "android", "vendor", "coverage"]);
export const EXAMPLE_NAMES = [".env.example", ".env.sample", ".env.template", ".env.dist"];
export const ENV_NAMES = [".env", ".env.local"];

export interface EnvTarget {
  dir: string;
  example: string;
  env: string | null;
}

export function findFirst(dir: string, names: readonly string[]): string | null {
  const name = names.find((n) => existsSync(join(dir, n)));
  return name ? join(dir, name) : null;
}

export function findTargets(root: string, maxDepth = 4): EnvTarget[] {
  const found: EnvTarget[] = [];
  const walk = (dir: string, depth: number) => {
    const example = findFirst(dir, EXAMPLE_NAMES);
    if (example) found.push({ dir, example, env: findFirst(dir, ENV_NAMES) });
    if (depth >= maxDepth) return;
    let children;
    try {
      children = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const c of children) {
      if (c.isDirectory() && !SKIP.has(c.name)) walk(join(dir, c.name), depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

export type GitExposure = "ignored" | "tracked" | "not-ignored" | "no-git";

/** Is this env file safe from being committed? */
export function gitExposure(file: string): GitExposure {
  const cwd = dirname(file);
  const run = (args: string[]) => {
    try {
      execFileSync("git", args, { cwd, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  if (!run(["rev-parse", "--is-inside-work-tree"])) return "no-git";
  if (run(["ls-files", "--error-unmatch", file])) return "tracked";
  return run(["check-ignore", "-q", file]) ? "ignored" : "not-ignored";
}
