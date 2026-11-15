import { describe, expect, it } from "vitest";
import { parseEnv, findDuplicates, checkEnv, hasFailures, buildExample, fillMissing, diffKeys } from "../src/index.js";

const kinds = (issues: { kind: string; key: string }[]) => issues.map((i) => `${i.kind}:${i.key}`);

describe("parseEnv", () => {
  it("parses keys, quotes, export and trailing comments", () => {
    const e = parseEnv(`export A=1\nB="two words" # @type=url\nC='x'\n# note\nD=`);
    expect(e.map((x) => [x.key, x.value])).toEqual([
      ["A", "1"],
      ["B", "two words"],
      ["C", "x"],
      ["D", ""],
    ]);
    expect(e[1].annotations.type).toBe("url");
    expect(e[1].inline).toBe("# @type=url");
    expect(e[3].comments).toEqual(["# note"]);
  });

  it("handles escapes, hashes inside quotes and empty values with comments", () => {
    const e = parseEnv(`A="say \\"hi\\"\\n"\nB="has # hash"\nC= # @optional\nD=a#b`);
    expect(e[0].value).toBe('say "hi"\n');
    expect(e[1].value).toBe("has # hash");
    expect(e[2].value).toBe("");
    expect(e[2].annotations.optional).toBe(true);
    expect(e[3].value).toBe("a#b");
  });

  it("reads multiline quoted values", () => {
    const e = parseEnv(`KEY="-----BEGIN-----\nabc\n-----END-----"\nNEXT=1`);
    expect(e[0].value).toBe("-----BEGIN-----\nabc\n-----END-----");
    expect(e[1]).toMatchObject({ key: "NEXT", value: "1", line: 4 });
  });

  it("finds duplicate keys", () => {
    expect([...findDuplicates(parseEnv(`A=1\nB=2\nA=3`))]).toEqual([["A", [1, 3]]]);
  });

  it("handles CRLF and junk lines", () => {
    expect(parseEnv("A=1\r\nnot a line\r\nB=2").map((e) => e.key)).toEqual(["A", "B"]);
  });
});

describe("checkEnv", () => {
  const schema = parseEnv(
    [
      "PORT=3000 # @type=port",
      "DSN= # @optional",
      "URL= # @type=url",
      "NAME=",
      "MODE= # @type=enum(dev|prod)",
      "REGION= # @pattern=[a-z]{2}-\\d",
      "KEY= # @secret @min=8",
      "CFG= # @type=json",
    ].join("\n"),
  );
  const ok = parseEnv(`PORT=80\nURL=https://a.io\nNAME=x\nMODE=dev\nREGION=eu-1\nKEY=12345678\nCFG={"a":1}`);

  it("passes a valid env", () => {
    expect(checkEnv(schema, ok)).toEqual([]);
  });

  it("flags missing, empty and invalid values", () => {
    const issues = checkEnv(schema, parseEnv(`PORT=99999\nURL=nope\nNAME=\nMODE=staging\nREGION=x\nKEY=short\nCFG={`));
    expect(kinds(issues)).toEqual([
      "invalid:PORT",
      "invalid:URL",
      "empty:NAME",
      "invalid:MODE",
      "invalid:REGION",
      "invalid:KEY",
      "invalid:CFG",
    ]);
    expect(issues.find((i) => i.key === "MODE")!.message).toContain("one of dev, prod");
  });

  it("never prints secret values", () => {
    const issues = checkEnv(parseEnv("KEY= # @secret @type=url"), parseEnv("KEY=super-secret"));
    expect(issues[0].message).not.toContain("super-secret");
  });

  it("reports extras only in strict mode, and duplicates as warnings", () => {
    const actual = parseEnv(`PORT=80\nURL=https://a.io\nNAME=x\nMODE=dev\nREGION=eu-1\nKEY=12345678\nCFG=1\nOTHER=1\nNAME=y`);
    expect(kinds(checkEnv(schema, actual))).toEqual(["duplicate:NAME"]);
    expect(kinds(checkEnv(schema, actual, { strict: true }))).toEqual(["duplicate:NAME", "extra:OTHER"]);
    expect(hasFailures(checkEnv(schema, actual, { strict: true }))).toBe(false);
  });

  it("flags unknown types and bad patterns in the example", () => {
    const issues = checkEnv(parseEnv("A= # @type=uuid\nB= # @pattern=(["), parseEnv("A=x\nB=y"));
    expect(issues.map((i) => i.message)).toEqual([expect.stringContaining("unknown type"), expect.stringContaining("bad @pattern")]);
  });
});

describe("buildExample", () => {
  it("blanks values but keeps comments and prior defaults", () => {
    expect(buildExample(`# db\nDB=secret\nPORT=8080\n`, `PORT=3000\n`)).toBe(`# db\nDB=\nPORT=3000\n`);
  });

  it("keeps inline annotations from the existing example", () => {
    expect(buildExample(`PORT=8080\n`, `PORT=3000 # @type=port\n`)).toBe(`PORT=3000 # @type=port\n`);
  });

  it("preserves keys that only the example has", () => {
    expect(buildExample(`A=1\n`, `A=\nB=default # @optional\n`)).toBe(`A=\n\n# Not in .env yet\nB=default # @optional\n`);
  });

  it("collapses multiline values and duplicate keys", () => {
    expect(buildExample(`KEY="line1\nline2"\nA=1\nA=2\n`)).toBe(`KEY=\nA=\n`);
  });
});

describe("fillMissing", () => {
  it("adds missing keys from the example, skipping optional ones", () => {
    const { content, added } = fillMissing(`A=1\nB=2 # @optional\nC=3\n`, `A=x\n`);
    expect(added).toEqual(["C"]);
    expect(content).toBe(`A=x\nC=3\n`);
  });

  it("creates content from scratch and quotes values with spaces", () => {
    expect(fillMissing(`GREETING="hello world"\n`, "").content).toBe(`GREETING="hello world"\n`);
  });
});

describe("diffKeys", () => {
  it("splits keys by side", () => {
    expect(diffKeys("A=\nB=", "B=1\nC=2")).toEqual({ onlyInEnv: ["C"], onlyInExample: ["A"], shared: ["B"] });
  });
});
