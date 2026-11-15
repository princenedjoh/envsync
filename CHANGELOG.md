# Changelog

## 0.1.0

- `check`, `scan`, `diff`, `sync` and `fill` commands
- annotations in `.env.example`: `@type` (string, number, integer, boolean, url, port, email, json, enum), `@pattern`, `@min`, `@optional`, `@secret`
- detects duplicate keys, `.env` files committed to git, and `.env` files missing from `.gitignore`
- parser handles `export`, quotes, escapes, inline comments and multiline values
- `--json` output and CI-friendly exit codes
