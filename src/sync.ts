import { parseEnv } from "./parse.js";

const KEY_LINE = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_.-]*)\s*=/;

/** Render an example line, keeping a value only if it's a harmless default. */
function exampleLine(prefix: string, key: string, value: string, comment: string) {
  const v = /\s|#|"/.test(value) ? JSON.stringify(value) : value;
  return `${prefix}${key}=${v}${comment ? " " + comment : ""}`;
}

/**
 * Build `.env.example` content from a real `.env`, blanking every value but
 * keeping comments and ordering. Defaults and inline annotations from the
 * existing example are kept, and keys only the example has are preserved.
 */
export function buildExample(env: string, existingExample = ""): string {
  const previous = new Map(parseEnv(existingExample).map((e) => [e.key, e]));
  const envKeys = new Set(parseEnv(env).map((e) => e.key));
  const out: string[] = [];
  const written = new Set<string>();
  const lines = env.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const m = KEY_LINE.exec(raw);
    if (!m) {
      out.push(raw);
      continue;
    }
    // skip continuation lines of a multiline quoted value
    const rest = raw.slice(m[0].length).trim();
    const q = rest[0];
    if ((q === '"' || q === "'" || q === "`") && rest.indexOf(q, 1) === -1) {
      while (i + 1 < lines.length && !lines[++i].includes(q));
    }
    if (written.has(m[2])) continue;
    written.add(m[2]);
    const prev = previous.get(m[2]);
    out.push(exampleLine(m[1], m[2], prev?.value ?? "", prev?.inline ?? ""));
  }

  const orphans = [...previous.values()].filter((e) => !envKeys.has(e.key));
  if (orphans.length > 0) {
    while (out.length && out[out.length - 1].trim() === "") out.pop();
    out.push("", "# Not in .env yet");
    for (const e of orphans) {
      out.push(exampleLine("", e.key, e.value, e.inline ?? ""));
    }
  }
  return out.join("\n").replace(/\n*$/, "\n");
}

/** Append keys that exist in the example but not in `.env`. Returns the new text and the added keys. */
export function fillMissing(example: string, env: string): { content: string; added: string[] } {
  const have = new Set(parseEnv(env).map((e) => e.key));
  const added: string[] = [];
  let content = env === "" ? "" : env.replace(/\n*$/, "\n");
  for (const e of parseEnv(example)) {
    if (have.has(e.key) || e.annotations.optional === true) continue;
    content += exampleLine("", e.key, e.value, "") + "\n";
    added.push(e.key);
    have.add(e.key);
  }
  return { content, added };
}

export interface KeyDiff {
  onlyInEnv: string[];
  onlyInExample: string[];
  shared: string[];
}

export function diffKeys(example: string, env: string): KeyDiff {
  const ex = new Set(parseEnv(example).map((e) => e.key));
  const en = new Set(parseEnv(env).map((e) => e.key));
  return {
    onlyInEnv: [...en].filter((k) => !ex.has(k)),
    onlyInExample: [...ex].filter((k) => !en.has(k)),
    shared: [...ex].filter((k) => en.has(k)),
  };
}
