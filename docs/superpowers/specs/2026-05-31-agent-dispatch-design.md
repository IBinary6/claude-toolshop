# agent-dispatch — Plugin Design Spec

## Overview

Claude Code plugin that forces the main agent to delegate work to subagents, protecting the main agent's context window. Replaces the legacy `subagent_enforce` / `subagent_prompt` global hooks with a clean, maintainable, configurable plugin.

## Problem

- Manually telling Claude Code "use subagent" every time is tedious
- The existing enforce hook works but has been through many add/remove iterations and is unmaintainable
- Without enforcement, the main agent consumes context on work that subagents could handle

## Core Principle

**Whitelist-based enforcement**: only explicitly allowed tools/commands can be used by the main agent. Everything else is blocked with a delegation hint. Subagent calls (those carrying `agent_id`) are unconditionally exempt.

## Plugin Structure

```
plugins/agent-dispatch/
├── README.md
├── commands/
│   └── agent-dispatch-setup.md      # optional setup skill
├── hooks/
│   ├── hooks.json                   # hook registration
│   └── js/
│       ├── lib/
│       │   ├── utils.js             # readStdinJson / output / log
│       │   ├── rules.js             # rule matching engine
│       │   └── config.js            # config loading & merging
│       └── enforcer.js              # PreToolUse — main enforcement hook
├── defaults/
│   └── dispatch-rules.json          # built-in default rules
└── docs/
    └── MANUAL_INSTALL.md
```

## Modules

| Module | Hook | Matcher | Default | Purpose |
|--------|------|---------|---------|---------|
| Enforcer | PreToolUse | `Bash\|PowerShell\|Write\|Edit\|MultiEdit\|NotebookEdit\|WebFetch\|WebSearch\|mcp__.*` | ON | Whitelist-based tool blocking, forces delegation |
| Prompt Inject | UserPromptSubmit | — | OFF | Injects fixed "you are a dispatcher" instruction |

Plugin works out of the box with zero configuration. The setup skill is only for users who want to customize rules.

## Enforcer Decision Flow

```
stdin JSON → parse tool_name, tool_input, agent_id

1. agent_id present?          → ALLOW (subagent exempt)
2. tool in whitelist?         → ALLOW
3. tool matches MCP prefix?   → ALLOW
4. tool is Bash/PowerShell?   → analyze command:
   a. command substitution?   → BLOCK
   b. split by && || ; |, check each segment:
      - git readonly?         → ALLOW
      - git safe write?       → check not dangerous → ALLOW
      - safe shell head?      → ALLOW
      - else                  → BLOCK
5. else                       → BLOCK
```

## Block Message Format

```
⚠ BLOCKED [toolName]. Delegate via Agent tool.
Agent({ description: "...", prompt: "..." })
```

Two lines. Consumed by the AI, not the user.

## Tool Classification

### Whitelisted Tools (main agent may use directly)

| Category | Tools | Rationale |
|----------|-------|-----------|
| Coordination | Agent, SendMessage, TaskCreate/Update/List/Get/Output/Stop, AskUserQuestion, Skill, Workflow | Main agent's primary job |
| Mode switching | EnterPlanMode, ExitPlanMode, EnterWorktree, ExitWorktree | Session control |
| Scheduling | CronCreate, CronDelete, CronList, ScheduleWakeup | Lightweight meta-ops |
| Lightweight read | Read, Grep, Glob, LSP | Needed for informed dispatch decisions |
| Small edits | Edit, Write, MultiEdit, NotebookEdit | Single-file trivial changes |
| Web queries | WebFetch, WebSearch | Results consumed by main agent directly |

### Whitelisted MCP Prefixes

| Prefix | Rationale |
|--------|-----------|
| `mcp__plugin_context-mode_` | Sandbox executor, saves context by design |
| `mcp__plugin_claude-mem_` | Memory retrieval, layered (index → detail) |
| `mcp__sequential-thinking` | Thinking chain, short output |

### Blocked (everything else)

- Heavy MCP tools (context7, microsoft-learn, deepwiki, tavily, serena, exa, etc.)
- Unknown tools not in whitelist

### Bash Command Analysis

**Safe shell heads** (allowed):
```
ls, pwd, cd, mkdir, rm, mv, cp, touch,
cat, echo, which, where,
fd, rg, grep, jq, delta, gh, tsc, pyright, pdftotext,
head, tail, wc, sort, uniq
```

**Git readonly** (allowed):
```
status, diff, log, show, blame, branch,
rev-parse, rev-list, ls-files, ls-tree,
describe, reflog, remote -v/show, config --get/--list,
stash list/show, tag -l/--list
```

**Git safe write** (allowed, unless dangerous):
```
add, commit, push, pull, fetch, tag,
switch, checkout, restore, stash,
merge, rebase, reset, cherry-pick, revert,
rm, mv, clean, worktree, notes
```

**Git dangerous patterns** (blocked):
```
push --force / push -f
reset --hard
branch -D
clean -f[dx]
checkout -- .
restore -- .
```

**Command substitution** (`$(...)` or backticks): always blocked.

**Pipeline/chain segments**: split by `&&`, `||`, `;`, `|` — every segment must independently pass.

## Configuration

### Loading Priority

```
Built-in defaults (defaults/dispatch-rules.json)
       ↓ merge override
Project-level .agent-dispatch.json (optional, project root)
```

No config file needed — built-in defaults work out of the box.

### Override Format (.agent-dispatch.json)

Users only write incremental overrides. Unspecified fields keep defaults.

```json
{
  "modules": {
    "enforcer": true,
    "prompt_inject": false
  },
  "overrides": {
    "tools_add": ["SomeCustomTool"],
    "tools_remove": ["WebSearch"],
    "mcp_prefixes_add": ["mcp__my_custom_"],
    "bash_heads_add": ["cargo", "npm"],
    "bash_heads_remove": ["rm"]
  }
}
```

### Config Merging Logic

```
final_tools      = (default_tools + tools_add) - tools_remove
final_mcp        = (default_mcp + mcp_prefixes_add)
final_bash_heads = (default_bash_heads + bash_heads_add) - bash_heads_remove
```

## Setup Skill

`commands/agent-dispatch-setup.md` — interactive configuration helper. NOT required for plugin to work. Use cases:

- View current effective rules
- Toggle enforcer / prompt_inject modules
- Add/remove whitelist entries
- Generate `.agent-dispatch.json` in project root

## Prompt Inject Module (optional, default OFF)

When enabled, injects a fixed English instruction at UserPromptSubmit telling the main agent it is a dispatcher. Fixed text, no prompt analysis, minimal token overhead.

## Dependencies

- Node.js 18+
- No external packages (pure Node.js stdlib)
- No dependency on specific subagent_types — works with any Claude Code installation

## Non-Goals

- No intelligent routing to specific agent types (users' environments vary)
- No model-tier routing (deferred to future version)
- No session state tracking
- No PostToolUse hooks
