export interface EnvEntry {
  key: string;
  value: string;
  line: number;
  /** Comment lines directly above the entry plus any trailing comment. */
  comments: string[];
  /** The comment on the same line as the entry, if any. */
  inline?: string;
  /** Annotations such as `@type=url` or `@optional`, read from comments. */
  annotations: Record<string, string | true>;
}

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;

function unescapeDouble(s: string): string {
  return s.replace(/\\([nrt"\\])/g, (_, c: string) => ({ n: "\n", r: "\r", t: "\t" })[c] ?? c);
}

function readAnnotations(comments: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (const c of comments) {
    for (const m of c.matchAll(/@([a-z]+)(?:[=\s]+([^\s@#]+))?/gi)) {
      out[m[1].toLowerCase()] = m[2] ?? true;
    }
  }
  return out;
}

/**
 * Parse dotenv content. Supports `export`, single/double/backtick quotes,
 * escapes in double quotes, multiline quoted values, and inline comments.
 */
export function parseEnv(content: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  const lines = content.split(/\r?\n/);
  let pending: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const trimmed = text.trim();
    if (trimmed === "") {
      pending = [];
      continue;
    }
    if (trimmed.startsWith("#")) {
      pending.push(trimmed);
      continue;
    }
    const m = LINE.exec(text);
    if (!m) continue;

    const startLine = i + 1;
    let raw = m[2].trim();
    let value: string;
    let trailing = "";
    const q = raw[0];

    if (q === '"' || q === "'" || q === "`") {
      let body = raw.slice(1);
      let end = findClose(body, q);
      // multiline: keep consuming lines until the quote closes
      while (end === -1 && i + 1 < lines.length) {
        body += "\n" + lines[++i];
        end = findClose(body, q);
      }
      if (end === -1) end = body.length;
      value = body.slice(0, end);
      if (q === '"') value = unescapeDouble(value);
      trailing = body.slice(end + 1).trim();
    } else if (raw.startsWith("#")) {
      value = "";
      trailing = raw;
    } else {
      const hash = raw.search(/\s#/);
      value = hash === -1 ? raw : raw.slice(0, hash).trim();
      trailing = hash === -1 ? "" : raw.slice(hash).trim();
    }

    const comments = trailing.startsWith("#") ? [...pending, trailing] : pending;
    entries.push({
      key: m[1],
      value,
      line: startLine,
      comments,
      inline: trailing.startsWith("#") ? trailing : undefined,
      annotations: readAnnotations(comments),
    });
    pending = [];
  }
  return entries;
}

function findClose(body: string, q: string): number {
  for (let j = 0; j < body.length; j++) {
    if (body[j] === "\\" && q === '"') {
      j++;
      continue;
    }
    if (body[j] === q) return j;
  }
  return -1;
}

/** Keys declared more than once, with every line they appear on. */
export function findDuplicates(entries: EnvEntry[]): Map<string, number[]> {
  const seen = new Map<string, number[]>();
  for (const e of entries) seen.set(e.key, [...(seen.get(e.key) ?? []), e.line]);
  return new Map([...seen].filter(([, lines]) => lines.length > 1));
}
