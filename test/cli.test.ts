import { describe, expect, it, beforeAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve("dist/cli.js");
const run = (cwd: string, ...args: string[]) => {
  const r = spawnSync("node", [cli, ...args], { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  return { code: r.status, out: r.stdout + r.stderr };
};

function project(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "envsync-"));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "ignore" });
});

describe("cli", () => {
  it("check passes and fails with the right exit codes", () => {
    const good = project({ ".env.example": "A= # @type=number\n", ".env": "A=1\n" });
    expect(run(good, "check", "--no-git-check")).toMatchObject({ code: 0 });
    const bad = project({ ".env.example": "A= # @type=number\nB=\n", ".env": "A=x\n" });
    const r = run(bad, "check", "--no-git-check");
    expect(r.code).toBe(1);
    expect(r.out).toContain("invalid");
    expect(r.out).toContain("missing");
  });

  it("check --json returns structured issues", () => {
    const dir = project({ ".env.example": "A=\n", ".env": "" });
    const r = run(dir, "check", "--json", "--no-git-check");
    expect(JSON.parse(r.out).issues[0]).toMatchObject({ kind: "missing", key: "A" });
  });

  it("supports custom env and example paths", () => {
    const dir = project({ "config/prod.example": "A=\n", ".env.production": "A=1\n" });
    expect(run(dir, "check", "-e", ".env.production", "-x", "config/prod.example", "--no-git-check").code).toBe(0);
  });

  it("warns when .env is not git-ignored and fails when committed", () => {
    const dir = project({ ".env.example": "A=\n", ".env": "A=1\n" });
    execFileSync("git", ["init", "-q"], { cwd: dir });
    let r = run(dir, "check");
    expect(r.code).toBe(0);
    expect(r.out).toContain("not in .gitignore");
    execFileSync("git", ["add", ".env"], { cwd: dir });
    r = run(dir, "check");
    expect(r.code).toBe(1);
    expect(r.out).toContain("committed to git");
  });

  it("sync and fill write files", () => {
    const dir = project({ ".env": "A=secret\nB=2\n", ".env.example": "A=\nZ=1\n" });
    run(dir, "sync");
    expect(readFileSync(join(dir, ".env.example"), "utf8")).toBe("A=\nB=\n\n# Not in .env yet\nZ=1\n");
    run(dir, "fill");
    expect(readFileSync(join(dir, ".env"), "utf8")).toBe("A=secret\nB=2\nZ=1\n");
  });

  it("scan walks a monorepo and skips node_modules", () => {
    const dir = project({
      "apps/web/.env.example": "A=\n",
      "apps/web/.env": "A=1\n",
      "apps/api/.env.example": "B=\n",
      "node_modules/x/.env.example": "C=\n",
    });
    const r = run(dir, "scan", "--json", "--no-git-check");
    const report = JSON.parse(r.out);
    expect(report.map((x: { dir: string }) => x.dir).sort()).toEqual(["apps/api", "apps/web"]);
    expect(r.code).toBe(1);
  });

  it("rejects unknown commands and options with exit 2", () => {
    const dir = project({});
    expect(run(dir, "nope").code).toBe(2);
    expect(run(dir, "check", "--bogus").code).toBe(2);
  });
});
