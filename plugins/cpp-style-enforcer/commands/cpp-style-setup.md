---
description: View or configure cpp-style-enforcer - edit the global template or write an override for the current project
---

# cpp-style-enforcer configuration

This command is an **on-demand configuration tool**: it only views and edits configuration, and asks no interactive questions and blocks nothing. Pick one of the operations below as needed.

## Configuration layers

1. **Global template** `~/.claude/cpp-style-template.json`: defaults for every project (default mode, per-check switches). SessionStart creates it the first time and **never overwrites an existing one**.
2. **Project override** `<project root>/.claude-cpp-style/cpp-style.json`: overrides the global template **field by field** for this project (write only what you want to change). Note that it is the `cpp-style.json` file inside the `.claude-cpp-style` folder.

## Schema (both layers have the same shape)

```json
{
  "enabled": true,
  "mode": "incremental",
  "lineEnding": "preserve",
  "checks": { "clangFormat": true, "cpplint": true, "bom": true },
  "legacyChecks": { "clangFormat": false, "cpplint": false, "bom": false }
}
```

- `enabled`: set to false to turn off all processing for the project.
- `mode`: `incremental` (only new files get the full set) | `full` (every file gets the full set; tracked files still keep their BOM state).
- `lineEnding`: `preserve` (default, keep the majority line ending) | `lf` | `crlf`; Visual Studio source projects are always CRLF.
- `checks.clangFormat`: formatting (Visual Studio projects keep `#include` order); `checks.cpplint`: Google C++ style static check; `checks.bom`: add a UTF-8 BOM to new files (tracked files keep their encoding).
- `legacyChecks.*`: the checks applied to tracked files under `incremental`. All off by default so the original encoding and format are kept; `bom` is kept for compatibility only.
- The copyright-header feature was removed; any `copyright` / `copyrightInfo` keys in old configs are ignored.

## Common operations

- Disable a project: write `{ "enabled": false }` to `.claude-cpp-style/cpp-style.json` at the project root.
- Require every file in a new project to comply: write `{ "mode": "full" }`.
- Skip cpplint for new files: write `{ "checks": { "cpplint": false } }`.
- Lint tracked files too: write `{ "legacyChecks": { "cpplint": true } }`.

## Behaviour cheat sheet

- **When processing runs**: edits are only recorded; the files are processed together when the round ends (Stop, or SubagentStop for a subagent), and Claude is asked to review and re-verify when something was rewritten or a violation remains.
- **New vs. old file** = whether the file already exists in `HEAD`. Under `incremental`, files never committed get the full set; tracked files keep their original encoding and format and only get the basic line-ending repair. Outside a git repo every file counts as new.
- **Third-party directories** (`3rd`, `third_party`, `thridpart`, `vendor`, and so on, matched as whole path segments) are neither formatted nor linted.
- **Local opt-out** of include sorting: wrap the lines in `// clang-format off` / `// clang-format on`.
