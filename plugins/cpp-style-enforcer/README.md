# cpp-style-enforcer

A C++ style plugin based on the **Google C++ Style Guide**. Claude Code hooks run clang-format, cpplint, line-ending repair and UTF-8 BOM normalization at the end of an edit round and before commits, and treat new and old files differently.

## Parity with the Codex edition

Both editions follow the same rules: **record edits while they happen and process them together when the round ends; new files and new projects get the full set while tracked files keep their original encoding and format by default; Visual Studio projects stay CRLF; the commit check lints the Git index without touching the working tree; third-party directories are neither formatted nor linted**.

| Capability | Claude Code edition | Codex edition |
|---|---|---|
| Post-edit processing | `PostToolUse` only records the touched C++ files; the main agent finishes them at `Stop`, a subagent at its own `SubagentStop` | `PostToolUse` records, `Stop` processes per turn |
| Pending-edit buckets | `session_id` + `agent_id` (Claude has no turn_id; a subagent's edits are finished by that subagent) | `session_id` + `turn_id` |
| Commit check | `PreToolUse:Bash/PowerShell` detects a real `git commit` and lints a snapshot of the Git index | `PreToolUse:Bash`, also index-snapshot based |
| Project config | `.claude-cpp-style/cpp-style.json` + `~/.claude/cpp-style-template.json` | `.codex-cpp-style/`, also reads `.claude-cpp-style/` |
| Dependency install | detect only, never auto `pip/npm install` | same |

## How it works

| Hook | Script | What it does |
|---|---|---|
| SessionStart | `hooks/js/session_start.js` | Only makes sure the global template exists (copied from the factory default on first run, never overwritten). **Writes no project files.** |
| PostToolUse (built-in edits / Agentic Patch / MCP batch patches) | `hooks/js/post_edit.js` | Records the touched C++ files under `CLAUDE_PLUGIN_DATA`; never rewrites files; failed tool results are not recorded |
| Stop / SubagentStop | `hooks/js/stop_check.js` | Per file: clang-format -> BOM (new files only) -> line endings -> cpplint. When something was rewritten or a violation remains it returns `decision:block` once, asking Claude to review the final diff and re-run verification |
| PreToolUse (Bash / PowerShell) | `hooks/js/pre_commit.js` | Recognizes `git`, `git.exe`, absolute paths, `cmd /c` and the PowerShell `&` operator, and only checks the staged C++ files of a real `git commit` |

Why defer to Stop: rewriting a file between edits makes Claude's next `Edit` fail with "file has been modified" and re-read over and over, and processing everything together avoids formatting the same file several times. Formatting can change include order, so the closing report asks Claude to re-run the relevant build/tests.

- When `stop_hook_active=true` (the follow-up after a block) the result is only reported through `systemMessage`, so it never loops.
- Finalization has an internal 45 s deadline; files that did not fit are put back in the queue for the next stop and listed as unchecked, never silently dropped.
- When `CLAUDE_PLUGIN_DATA` is missing (manual install) the pending records go to the system temp directory, never the plugin root.

> No prompts: it is on by default after installation. A project can turn it off with `enabled:false`.

## Configuration

Two layers with the same shape; the project layer overrides the global layer field by field:

1. **Global template** `~/.claude/cpp-style-template.json`: defaults for every project (created on first SessionStart, **never overwritten**).
2. **Project override** `<project root>/.claude-cpp-style/cpp-style.json`: write only the fields you want to change. It is created on demand the first time a C++ file is actually processed in that project, and added to `.gitignore`.

Schema:

```json
{
  "enabled": true,
  "mode": "incremental",
  "lineEnding": "preserve",
  "checks": { "clangFormat": true, "cpplint": true, "bom": true },
  "legacyChecks": { "clangFormat": false, "cpplint": false, "bom": false }
}
```

| Field | Meaning |
|---|---|
| `enabled` | `false` turns off all processing for the project (a complete no-op; files are untouched) |
| `mode` | `incremental` (only new files get the full set) / `full` (every file gets the full set; tracked files still keep their BOM state) |
| `lineEnding` | `preserve` (default, keep the majority line ending) / `lf` / `crlf`. Visual Studio source projects are always CRLF |
| `checks.clangFormat` | Formatting (whole file; Visual Studio projects keep `#include` order) |
| `checks.cpplint` | cpplint style check (violations are reported at the end of the round / block the commit) |
| `checks.bom` | Add a UTF-8 BOM to new files; tracked files keep their encoding |
| `legacyChecks.*` | Switches for tracked files (already in HEAD) under `incremental`; everything is off by default and `bom` is kept for compatibility only |

Missing `checks` fields default to `true` and missing `legacyChecks` fields default to `false`. A corrupt or missing config falls back to hard-coded safe defaults and never crashes. A `legacyChecks.bom: true` left in an old global template does not add a BOM to tracked files. The removed copyright-header settings (`checks.copyright`, `copyrightInfo`) are ignored if they are still present in an old config.

## Three behaviours (new vs. old is "is the file in HEAD?")

| Scenario | Behaviour |
|---|---|
| New project / `mode:full` | Full set: clang-format + cpplint; new files get a BOM |
| New file in an old project (not in HEAD, including untracked or `git add`ed but uncommitted) | Same full set (whole-file formatting + BOM) |
| Tracked file in an old project (`incremental` and already in HEAD) | Original encoding, BOM and format are kept; only the basic line-ending repair runs |

Outside a git repo every file counts as "new". The cpplint header-guard root is, in order, the Git root, the session cwd that contains the file, or the file's own directory, so guards never contain machine-specific absolute paths.

## Details

- **clang-format**: new files are formatted as a whole (`-style=file -fallback-style=Google`). Old files are formatted only with an explicit `legacyChecks.clangFormat:true`, only on the lines git changed, reading the project's `.clang-format` (`--sort-includes=false`) instead of overriding indentation with an inline Google style.
- **Visual Studio source projects** (an ancestor directory has `.sln`/`.slnx`/`.vcxproj` and the nearest level has no `CMakeLists.txt`): dependency-sensitive `#include` order is kept and cpplint's `build/include_order` is switched off; line endings are forced to CRLF, including files that were wrongly converted to LF. VS files generated by CMake do not count as native VS projects.
- **Line endings**: independent of clang-format and `legacyChecks`; only line-ending bytes are replaced and a missing final newline is added, with encoding and BOM preserved, UTF-16 handled in its own encoding, and the Git index untouched.
- **Auto-generated `.clang-format`**: when the full set runs and neither the project root nor any parent directory has `.clang-format`/`_clang-format`, a `BasedOnStyle: Google` file is generated. It is not generated when a parent already provides one (so an inherited style is not shadowed), never overwrites an existing file, and is skipped outside git.
- **cpplint**: the bundled `cpplint.py` reads files as `utf-8-sig`, so a BOM is ignored and **the check never writes a file** (mtime, BOM and line endings stay unchanged). When Python/cpplint is unavailable, times out, or cannot read its config, a `runtime/*` entry is reported instead of pretending there were no violations. `legal/copyright` is always suppressed because this plugin does not manage copyright headers. `build/header_guard` and `build/include_subdir` are advisory; everything else is a hard failure.
- **Commit check**: staged files are listed with `git diff --cached -z` (spaces, non-ASCII names and special characters survive), written together with every `CPPLINT.cfg` in the index into a temporary snapshot, and checked there, so **the staged content is what counts, not the working tree**. If the staged files cannot be listed, the snapshot cannot be created or cleaned up, or the check crashes, the commit is **rejected** with the reason.
- **Third-party directories**: excluded by whole path segment: `3rd`, `3rdparty`, `third_party`, `third-party`, `thirdpart`, the common misspellings `thridpart`/`thridparty`, `vendor`, `external`, `deps`, `packages` and build-output directories. A directory name that merely contains one of them (for example `vendor_manager`) is not excluded.
- **Local opt-out** of `#include` sorting: wrap the lines in `// clang-format off` / `// clang-format on`.
- **Protocol safety**: always exit 0; stdout is either empty or a single JSON object.

## Dependencies

**Prerequisite: bring your own Python 3 and Node.js** (the plugin installs neither). It only detects dependencies at run time and never runs `npm install` or `pip install` inside a hook.

| Dependency | Required | Used for | Notes |
|---|---|---|---|
| Node.js 18+ | yes | hook runtime | bring your own |
| Python 3 | yes | the bundled `cpplint.py`; `python -m clang_format` | Probe order: Windows `py -3` -> `python` -> `python3`; macOS/Linux `python3` -> `python`; each candidate is verified to be Python 3. Override with `CPP_STYLE_PYTHON` / `CPP_STYLE_PYTHON_ARGS` |
| cpplint | bundled | C++ style check | `hooks/js/cpplint/cpplint.py` |
| clang-format | for formatting | formatting | Found on PATH, as `python -m clang_format`, or in the Python Scripts directory; missing means formatting is skipped |
| `iconv-lite` | for GBK files | GBK -> UTF-8 transcoding | missing means GBK files skip the BOM step (not transcoded, not damaged) |

- **Manual prewarm**: `node hooks/js/lib/ensure_deps.js --prewarm` tries to install the optional dependencies; ordinary hook paths never install anything.
- **Does not pollute the plugin cache**: failure markers and pending records go to `CLAUDE_PLUGIN_DATA`, or the system temp directory when it is missing; nothing is written to the marketplace plugin root.

## Commands

- `/cpp-style-setup` - view or edit the global template, or write an override for the current project.

## Installation

### Marketplace (recommended)

```
/plugin marketplace add IBinary6/claude-toolshop
/plugin install cpp-style-enforcer@claude-toolshop
```

Restart Claude Code after installing; it is active by default.

### Manual install

See [docs/MANUAL_INSTALL.md](docs/MANUAL_INSTALL.md).

## Verification

```bash
npm test
claude plugin validate --strict .
```

## License

MIT
