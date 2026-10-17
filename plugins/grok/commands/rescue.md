---
description: Delegate investigation, an explicit fix request, or follow-up rescue work to the Grok rescue subagent
argument-hint: "[--background|--wait] [--resume|--fresh] [--model <id>] [--effort <level>] [what Grok should investigate, solve, or continue]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke the `grok:grok-rescue` subagent via the `Agent` tool (`subagent_type: "grok:grok-rescue"`), forwarding the raw user request as the prompt.
`grok:grok-rescue` is a subagent, not a skill — do not call `Skill(grok:grok-rescue)` or `Skill(grok:rescue)` (that re-enters this command).
The final user-visible response must be Grok's output verbatim.

Raw user request:
$ARGUMENTS

Execution mode:

- If the request includes `--background`, run the `grok:grok-rescue` subagent in the background.
- If the request includes `--wait`, run the `grok:grok-rescue` subagent in the foreground.
- If neither flag is present, default to foreground.
- `--background` and `--wait` are execution flags for Claude Code. Do not forward them, and do not treat them as task text.
- `--model` and `--effort` are runtime-selection flags. Keep them for the forwarded request, but not as task text. Model ids come from `~/.grok/config.toml` (`[model.<id>]` tables) or `grok models`.
- If the request includes `--resume` or `--fresh`, do not ask whether to continue. The user already chose.
- Otherwise, before starting Grok, check for a resumable Grok thread from this Claude session:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" task-resume-candidate --json
```

- If it reports `available: true`, use `AskUserQuestion` exactly once with these two choices:
  - `Continue current Grok thread`
  - `Start a new Grok thread`
- If the user is clearly giving a follow-up instruction such as "continue", "keep going", "resume", "apply the top fix", or "dig deeper", put `Continue current Grok thread (Recommended)` first. Otherwise put `Start a new Grok thread (Recommended)` first.
- If the user chooses continue, add `--resume` before routing to the subagent. If they choose a new thread, add `--fresh`.
- If it reports `available: false`, do not ask. Route normally.

Operating rules:

- The subagent is a thin forwarder only. It uses one `Bash` call to invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" task ...` and returns that command's stdout as-is.
- Return the companion stdout verbatim. Do not paraphrase, summarize, or add commentary before or after it.
- Do not ask the subagent to inspect files, monitor progress, poll `/grok:status`, fetch `/grok:result`, call `/grok:cancel`, or do follow-up work of its own.
- Leave `--effort` and `--model` unset unless the user explicitly asks for them.
- If the output says Grok is missing or has no credentials, stop and tell the user to run `/grok:setup`.
- If the user did not supply a request, ask what Grok should investigate or fix.
