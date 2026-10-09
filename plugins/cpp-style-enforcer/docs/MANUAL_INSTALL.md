# cpp-style-enforcer manual installation

For users who do not use the `/plugin` command: copy the plugin directory to your machine as-is, then register the hooks in `settings.json`.

> **Note**: with a manual install `CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA` are not available, so hook commands use the expanded absolute path. Every script resolves `lib/`, `steps/`, `cpplint.py` and the template through `__dirname`, so **the plugin directory layout must stay unchanged**. When `CLAUDE_PLUGIN_DATA` is missing, pending records and failure markers go to `cpp-style-enforcer/` under the system temp directory.

---

## 1. Prerequisites

| Dependency | Minimum | Required | Used for |
|------------|---------|----------|----------|
| Node.js | 18+ | **yes** | hook runtime |
| Python | 3.x | for cpplint | runs the bundled cpplint.py |
| clang-format | - | for clangFormat | code formatting |

Verify:

```bash
node --version          # >= v18
python --version        # 3.x; on Windows py -3 also works
clang-format --version  # optional; formatting is skipped when missing
```

When Python is missing cpplint cannot run, and the closing report and the commit check show a `runtime/cpplint` entry instead of treating it as zero violations.

---

## 2. Deploy the files

```bash
REPO="/path/to/bugdb-impl/plugins/cpp-style-enforcer"
DEST="$HOME/.claude/plugins-manual/cpp-style-enforcer"

mkdir -p "$DEST"
cp -R "$REPO/hooks" "$REPO/templates" "$REPO/package.json" "$DEST/"

# User-level template (the first SessionStart also copies it; an existing one is never overwritten)
[ -f "$HOME/.claude/cpp-style-template.json" ] || \
  cp "$REPO/templates/cpp-style-template.default.json" "$HOME/.claude/cpp-style-template.json"

# Command
mkdir -p "$HOME/.claude/commands"
cp "$REPO/commands/cpp-style-setup.md" "$HOME/.claude/commands/"
```

---

## 3. Register the hooks in settings.json

**Append** the entries below to the `hooks` object of `~/.claude/settings.json` (keep existing entries). Replace `<DEST>` with the absolute path from the previous step (on Windows use a forward-slash path such as `C:/Users/<you>/.claude/plugins-manual/cpp-style-enforcer`):

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node \"<DEST>/hooks/js/session_start.js\"", "timeout": 10 }] }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit|NotebookEdit|mcp__.*(?:write|edit|create|replace|insert|patch|apply|update)",
        "hooks": [{ "type": "command", "command": "node \"<DEST>/hooks/js/post_edit.js\"", "timeout": 10 }]
      }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"<DEST>/hooks/js/stop_check.js\"", "timeout": 60 }] }
    ],
    "SubagentStop": [
      { "hooks": [{ "type": "command", "command": "node \"<DEST>/hooks/js/stop_check.js\"", "timeout": 60 }] }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash|PowerShell",
        "hooks": [{ "type": "command", "command": "node \"<DEST>/hooks/js/pre_commit.js\"", "timeout": 30 }]
      }
    ]
  }
}
```

Both `Stop` and `SubagentStop` must be registered: edits are only recorded, and the actual formatting and checking run when the round ends. Without `SubagentStop`, files edited by a subagent are never processed.

Verify the JSON afterwards:

```bash
node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); console.log('OK')" "$HOME/.claude/settings.json"
```

---

## 4. Post-deployment self-check

```bash
for f in session_start post_edit stop_check pre_commit; do node --check "$DEST/hooks/js/$f.js" || echo "FAIL $f"; done
echo '{}' | node "$DEST/hooks/js/stop_check.js"; echo "exit=$?"   # expected: no output, exit=0
```

When everything passes the installation is complete. Restart Claude Code so `settings.json` takes effect.

---

## 5. Uninstall

```bash
rm -rf "$HOME/.claude/plugins-manual/cpp-style-enforcer"
rm -f  "$HOME/.claude/commands/cpp-style-setup.md"
rm -f  "$HOME/.claude/cpp-style-template.json"   # if you no longer need it
```

Also remove the 5 corresponding hook entries from `settings.json`. The `.claude-cpp-style/` folder in each project root can be deleted if you like.
