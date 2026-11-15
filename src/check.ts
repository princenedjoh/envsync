import { findDuplicates, type EnvEntry } from "./parse.js";

export type IssueKind =
  | "missing"
  | "empty"
  | "invalid"
  | "committed" // the env file is tracked by git
  | "duplicate"
  | "extra"
  | "unignored"; // the env file isn't covered by .gitignore

export interface Issue {
  kind: IssueKind;
  key: string;
  message: string;
}

/** Issue kinds that are warnings, not failures. */
export const WARNINGS: ReadonlySet<IssueKind> = new Set(["extra", "duplicate", "unignored"]);

type Validator = (v: string, arg?: string) => boolean;

const validators: Record<string, Validator> = {
  string: () => true,
  number: (v) => v.trim() !== "" && !Number.isNaN(Number(v)),
  integer: (v) => /^-?\d+$/.test(v),
  boolean: (v) => /^(true|false|0|1|yes|no)$/i.test(v),
  url: (v) => {
    try {
      new URL(v);
      return true;
    } catch {
      return false;
    }
  },
  port: (v) => /^\d+$/.test(v) && Number(v) > 0 && Number(v) < 65536,
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  json: (v) => {
    try {
      JSON.parse(v);
      return true;
    } catch {
      return false;
    }
  },
  enum: (v, arg = "") => arg.split("|").includes(v),
};

/** Parse `enum(a|b)` style type annotations into name + argument. */
function readType(t: string): { name: string; arg?: string } {
  const m = /^([a-z]+)(?:\((.*)\))?$/i.exec(t);
  return m ? { name: m[1].toLowerCase(), arg: m[2] } : { name: t.toLowerCase() };
}

export function isKnownType(t: string): boolean {
  return readType(t).name in validators;
}

function show(value: string, secret: boolean) {
  return secret ? "(hidden)" : `"${value.length > 40 ? value.slice(0, 37) + "…" : value}"`;
}

export function checkEnv(
  schema: EnvEntry[],
  actual: EnvEntry[],
  opts: { strict?: boolean } = {},
): Issue[] {
  const issues: Issue[] = [];
  // last definition wins, same as dotenv
  const have = new Map(actual.map((e) => [e.key, e]));
  const known = new Set(schema.map((e) => e.key));

  for (const spec of schema) {
    const a = spec.annotations;
    const optional = a.optional === true;
    const secret = a.secret === true;
    const found = have.get(spec.key);
    if (!found) {
      if (!optional) issues.push({ kind: "missing", key: spec.key, message: "not set" });
      continue;
    }
    if (found.value === "") {
      if (!optional) issues.push({ kind: "empty", key: spec.key, message: "has no value" });
      continue;
    }
    if (typeof a.type === "string") {
      const { name, arg } = readType(a.type);
      const check = validators[name];
      if (!check) {
        issues.push({ kind: "invalid", key: spec.key, message: `unknown type "${a.type}" in example` });
      } else if (!check(found.value, arg)) {
        const expected = name === "enum" ? `one of ${arg?.split("|").join(", ")}` : name;
        issues.push({ kind: "invalid", key: spec.key, message: `expected ${expected}, got ${show(found.value, secret)}` });
      }
    }
    if (typeof a.pattern === "string") {
      let re: RegExp | null = null;
      try {
        re = new RegExp(`^(?:${a.pattern})$`);
      } catch {
        issues.push({ kind: "invalid", key: spec.key, message: `bad @pattern in example: ${a.pattern}` });
      }
      if (re && !re.test(found.value)) {
        issues.push({ kind: "invalid", key: spec.key, message: `does not match /${a.pattern}/, got ${show(found.value, secret)}` });
      }
    }
    if (typeof a.min === "string" && found.value.length < Number(a.min)) {
      issues.push({ kind: "invalid", key: spec.key, message: `must be at least ${a.min} characters` });
    }
  }

  for (const [key, lines] of findDuplicates(actual)) {
    issues.push({ kind: "duplicate", key, message: `defined on lines ${lines.join(", ")}; the last one wins` });
  }

  if (opts.strict) {
    for (const key of have.keys()) {
      if (!known.has(key)) issues.push({ kind: "extra", key, message: "not declared in the example file" });
    }
  }
  return issues;
}

export function hasFailures(issues: Issue[]): boolean {
  return issues.some((i) => !WARNINGS.has(i.kind));
}
