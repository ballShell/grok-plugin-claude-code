---
description: Show active and recent Grok jobs for this repository, including review-gate status
argument-hint: '[job-id] [--wait] [--timeout-ms <ms>] [--all]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" status "$ARGUMENTS"`

If the user did not pass a job ID:
- Present the command output as a single compact Markdown table of the jobs, keeping job ID, kind, status, elapsed time, summary, and the follow-up commands.
- Do not add extra prose outside the table and the follow-up lines.

If the user did pass a job ID:
- Present the full command output. Do not summarize or condense it.
