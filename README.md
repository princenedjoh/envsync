# envsync

[![npm](https://img.shields.io/npm/v/@princenedjoh/envsync)](https://www.npmjs.com/package/@princenedjoh/envsync)
[![CI](https://github.com/princenedjoh/envsync/actions/workflows/ci.yml/badge.svg)](https://github.com/princenedjoh/envsync/actions/workflows/ci.yml)

Validate `.env` files against `.env.example`, keep them in sync, and check every app in a monorepo. Zero dependencies.

```sh
npm i -g @princenedjoh/envsync   # installs the `envsync` command
```

```sh
npx @princenedjoh/envsync check          # validate .env against .env.example
npx @princenedjoh/envsync scan .         # check every app under a monorepo root
npx @princenedjoh/envsync diff           # keys that exist on only one side
npx @princenedjoh/envsync sync           # regenerate .env.example from .env (values blanked)
npx @princenedjoh/envsync fill           # add keys missing from .env, using example defaults
```

```
$ envsync scan
✗ apps/api
    committed .env is committed to git; remove it with `git rm --cached` and rotate its secrets
    missing   DATABASE_URL not set
    invalid   PORT expected port, got "99999"
    invalid   JWT_SECRET must be at least 32 characters
✓ apps/web
! packages/worker
    duplicate REDIS_URL defined on lines 1, 3; the last one wins

3 app(s) checked, 1 with problems
```

## Rules live in `.env.example`

Describe each key with comment annotations. The example file stays a plain dotenv file that every other tool understands.

```sh
PORT=3000            # @type=port
NODE_ENV=            # @type=enum(development|production|test)
DATABASE_URL=        # @type=url
API_KEY=             # @secret @min=32
REGION=              # @pattern=[a-z]{2}-[a-z]+-\d
FEATURES=            # @type=json
SENTRY_DSN=          # @optional
```

| Annotation | Meaning |
| --- | --- |
| `@type=…` | `string` `number` `integer` `boolean` `url` `port` `email` `json` `enum(a\|b)` |
| `@pattern=…` | the whole value must match this regex |
| `@min=n` | minimum length |
| `@optional` | may be missing or empty |
| `@secret` | never print the value in error messages |

## What it checks

- missing and empty keys, and values that fail their type, pattern or length
- keys defined twice (warning)
- `.env` committed to git (failure) or not in `.gitignore` (warning)
- with `--strict`, keys that aren't declared in the example (warning)

## Commands

| Command | What it does |
| --- | --- |
| `check [dir]` | validate one app |
| `scan [dir]` | find every `.env.example` below `dir` (skips `node_modules`, build output, native folders) and check each |
| `diff [dir]` | list keys present on only one side |
| `sync [dir]` | rewrite the example from `.env`, blanking values but keeping defaults, annotations and example-only keys |
| `fill [dir]` | append missing required keys to `.env` (creates it if needed) |

## Options

| Flag | Effect |
| --- | --- |
| `-e, --env <file>` | env file to use (default `.env`, then `.env.local`) |
| `-x, --example <file>` | example file (default `.env.example`, `.sample`, `.template`, `.dist`) |
| `--strict` | report undeclared keys |
| `--json` | machine-readable output |
| `--depth <n>` | how deep `scan` searches (default 4) |
| `--no-git-check` | skip the git exposure check |
| `-q, --quiet` | only print problems |

Exit codes: `0` ok (warnings allowed), `1` a check failed, `2` usage error.

## In CI and git hooks

```yaml
# GitHub Actions
- run: npx @princenedjoh/envsync scan --no-git-check --example .env.example --env .env.ci
```

```sh
# .husky/pre-commit
npx @princenedjoh/envsync scan -q
```

## API

```ts
import { parseEnv, checkEnv, hasFailures } from "@princenedjoh/envsync";

const issues = checkEnv(parseEnv(exampleText), parseEnv(envText), { strict: true });
if (hasFailures(issues)) process.exit(1);
```

## License

MIT
