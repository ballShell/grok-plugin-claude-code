---
name: grok-cli-runtime
description: Internal helper contract for calling the grok-companion runtime from Claude Code
user-invocable: false
---

# Grok runtime

Use this skill only inside the `grok:grok-rescue` subagent.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" task "<raw arguments>"`

Execution rules:
- The rescue subagent is a forwarder, not an orchestrator. Its only job is to invoke `task` once and return that stdout unchanged.
- Prefer the helper over hand-rolled `git`, direct `grok` CLI strings, or any other Bash activity.
- Do not call `setup`, `review`, `adversarial-review`, `status`, `result`, or `cancel` from `grok:grok-rescue`.
- Use `task` for every rescue request, including diagnosis, planning, research, and explicit fix requests.
- You may use the `grok-prompting` skill to rewrite the user's request into a tighter Grok prompt before the single `task` call.
- That prompt drafting is the only Claude-side work allowed. Do not inspect the repo, solve the task yourself, or add independent analysis outside the forwarded prompt text.

Command selection:
- Use exactly one `task` invocation per rescue handoff.
- Default to `--write` (Grok runs with auto-approved tools and may edit files). Omit it for read-only runs, which use Grok's plan mode.
- `--background` detaches the run as a tracked job and returns immediately with the job id; `/grok:status`, `/grok:result` and `/grok:cancel` follow it up.
- `--resume-last` continues the latest Grok task thread from this Claude session; `--session <id>` continues a specific Grok session id. Use `--fresh` (or neither) for a new thread.
- `--model <id>` selects a model by the id of its `[model.<id>]` table in `~/.grok/config.toml` (or any id listed by `grok models`). Omit it to use `[models].default`.
- `--effort <level>` sets Grok's reasoning effort (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, or a per-model level). Some gateway models have no effort levels; leave it unset unless asked.
- `--worktree` or `--worktree=<name>` runs Grok in a fresh git worktree. `--max-turns <n>` caps agent turns.
- Strip `--background`, `--wait`, `--resume`, `--fresh` routing words from the task text; they are controls, not instructions for Grok.

Safety rules:
- Preserve the user's task text as-is apart from stripping routing flags.
- Return the stdout of the `task` command exactly as-is.
- If the Bash call fails or Grok cannot be invoked, return the companion's output and nothing else.
