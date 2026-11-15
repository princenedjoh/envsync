#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { relative, resolve, basename } from "node:path";
import { parseEnv } from "./parse.js";
import { checkEnv, hasFailures, WARNINGS, type Issue } from "./check.js";
import { buildExample, diffKeys, fillMissing } from "./sync.js";
import { ENV_NAMES, EXAMPLE_NAMES, findFirst, findTargets, gitExposure } from "./scan.js";

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === "string" ? __VERSION__ : "dev";
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = paint(31);
const green = paint(32);
const yellow = paint(33);
const dim = paint(2);
const bold = paint(1);

const HELP = `${bold("envsync")} - keep .env files honest

${bold("Usage")}
  envsync check [dir]     validate .env against .env.example
  envsync diff  [dir]     show keys that exist on only one side
  envsync sync  [dir]     write .env.example from .env (values blanked)
  envsync fill  [dir]     add keys missing from .env, using example defaults
  envsync scan  [dir]     check every app under a monorepo root

${bold("Options")}
  -e, --env <file>       env file to check (default: .env, then .env.local)
  -x, --example <file>   example file (default: .env.example/.sample/.template)
      --strict           also flag keys not declared in the example
      --json             machine-readable output
      --depth <n>        how deep scan looks (default 4)
      --no-git-check     skip the "is .env committed?" check
  -q, --quiet            only print problems
  -v, --version          print version
  -h, --help             show this help

${bold("Annotations")} (comments in .env.example)
  PORT=3000            # @type=port
  NODE_ENV=            # @type=enum(development|production|test)
  API_KEY=             # @secret @min=32
  REGION=              # @pattern=[a-z]{2}-[a-z]+-\\d
  SENTRY_DSN=          # @optional
  Types: string number integer boolean url port email json enum(...)

Exit code is 1 when a check fails, 2 on usage errors.`;

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      env: { type: "string", short: "e" },
      example: { type: "string", short: "x" },
      strict: { type: "boolean" },
      json: { type: "boolean" },
      depth: { type: "string", default: "4" },
      "no-git-check": { type: "boolean" },
      quiet: { type: "boolean", short: "q" },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });
} catch (e) {
  console.error(red((e as Error).message));
  process.exit(2);
}
const { values, positionals } = parsed;
const [command, target = "."] = positionals;
const root = resolve(target);

function fail(msg: string): never {
  console.error(red(msg));
  process.exit(2);
}

function label(i: Issue) {
  const l = i.kind.padEnd(9);
  return WARNINGS.has(i.kind) ? yellow(l) : red(l);
}

function exampleFile(dir: string): string {
  if (values.example) {
    const p = resolve(dir, values.example);
    if (!existsSync(p)) fail(`Example file not found: ${p}`);
    return p;
  }
  return findFirst(dir, EXAMPLE_NAMES) ?? fail(`No ${EXAMPLE_NAMES.join(" / ")} found in ${dir}`);
}

function envFile(dir: string, mustExist: boolean): string | null {
  if (values.env) {
    const p = resolve(dir, values.env);
    if (mustExist && !existsSync(p)) fail(`Env file not found: ${p}`);
    return p;
  }
  return findFirst(dir, ENV_NAMES);
}

function audit(example: string, env: string | null): Issue[] {
  if (!env || !existsSync(env)) {
    return [{ kind: "missing", key: "(file)", message: `no ${values.env ?? ".env"} found; run \`envsync fill\` to create one` }];
  }
  const issues = checkEnv(parseEnv(readFileSync(example, "utf8")), parseEnv(readFileSync(env, "utf8")), {
    strict: values.strict,
  });
  if (!values["no-git-check"]) {
    const exposure = gitExposure(env);
    if (exposure === "tracked") {
      issues.unshift({ kind: "committed", key: basename(env), message: "is committed to git; remove it with `git rm --cached` and rotate its secrets" });
    } else if (exposure === "not-ignored") {
      issues.unshift({ kind: "unignored", key: basename(env), message: "is not in .gitignore" });
    }
  }
  return issues;
}

function printIssues(issues: Issue[], indent = "") {
  for (const i of issues) console.log(`${indent}${label(i)} ${bold(i.key)} ${dim(i.message)}`);
}

function runCheck() {
  const example = exampleFile(root);
  const env = envFile(root, false);
  const issues = audit(example, env);
  if (values.json) console.log(JSON.stringify({ example, env, issues }, null, 2));
  else if (issues.length === 0) {
    if (!values.quiet) console.log(green(`✓ ${basename(env!)} matches ${basename(example)}`));
  } else printIssues(issues);
  process.exit(hasFailures(issues) ? 1 : 0);
}

function runDiff() {
  const example = exampleFile(root);
  const env = envFile(root, true);
  const d = diffKeys(readFileSync(example, "utf8"), env && existsSync(env) ? readFileSync(env, "utf8") : "");
  if (values.json) {
    console.log(JSON.stringify(d, null, 2));
  } else {
    for (const k of d.onlyInExample) console.log(`${red("-")} ${k} ${dim("only in " + basename(example))}`);
    for (const k of d.onlyInEnv) console.log(`${green("+")} ${k} ${dim("only in " + basename(env ?? ".env"))}`);
    if (d.onlyInEnv.length + d.onlyInExample.length === 0 && !values.quiet) console.log(green("✓ same keys on both sides"));
  }
  process.exit(d.onlyInExample.length > 0 ? 1 : 0);
}

function runSync() {
  const env = envFile(root, true);
  if (!env || !existsSync(env)) fail(`No .env found in ${root}`);
  const examplePath = values.example ? resolve(root, values.example) : findFirst(root, EXAMPLE_NAMES) ?? resolve(root, ".env.example");
  const prev = existsSync(examplePath) ? readFileSync(examplePath, "utf8") : "";
  const next = buildExample(readFileSync(env, "utf8"), prev);
  if (next === prev) {
    if (!values.quiet) console.log(green(`✓ ${basename(examplePath)} already up to date`));
    return;
  }
  writeFileSync(examplePath, next);
  const d = diffKeys(prev, next);
  if (!values.quiet) {
    console.log(green(`✓ wrote ${basename(examplePath)}`) + (d.onlyInEnv.length ? dim(` (+${d.onlyInEnv.join(", ")})`) : ""));
  }
}

function runFill() {
  const example = exampleFile(root);
  const envPath = envFile(root, false) ?? resolve(root, values.env ?? ".env");
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const { content, added } = fillMissing(readFileSync(example, "utf8"), current);
  if (added.length === 0) {
    if (!values.quiet) console.log(green("✓ nothing to add"));
    return;
  }
  writeFileSync(envPath, content);
  console.log(green(`✓ added ${added.length} key(s) to ${basename(envPath)}: `) + added.join(", "));
}

function runScan() {
  const depth = Number(values.depth);
  if (!Number.isInteger(depth) || depth < 0) fail("--depth must be a non-negative integer");
  const targets = findTargets(root, depth);
  if (targets.length === 0) {
    if (!values.quiet) console.log(dim(`No ${EXAMPLE_NAMES[0]} files found under ${root}`));
    return;
  }
  const report = targets.map((t) => ({
    dir: relative(root, t.dir) || ".",
    example: relative(root, t.example),
    env: t.env ? relative(root, t.env) : null,
    issues: audit(t.example, t.env),
  }));
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const r of report) {
      const failed = hasFailures(r.issues);
      if (values.quiet && r.issues.length === 0) continue;
      console.log(`${failed ? red("✗") : r.issues.length ? yellow("!") : green("✓")} ${bold(r.dir)}`);
      printIssues(r.issues, "    ");
    }
    const bad = report.filter((r) => hasFailures(r.issues)).length;
    console.log(dim(`\n${report.length} app(s) checked, ${bad} with problems`));
  }
  process.exit(report.some((r) => hasFailures(r.issues)) ? 1 : 0);
}

if (values.version) console.log(VERSION);
else if (values.help || !command) console.log(HELP);
else if (command === "check") runCheck();
else if (command === "diff") runDiff();
else if (command === "sync") runSync();
else if (command === "fill") runFill();
else if (command === "scan") runScan();
else {
  console.error(red(`Unknown command: ${command}\n`));
  console.log(HELP);
  process.exit(2);
}
