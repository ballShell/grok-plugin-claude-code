---
description: Show the stored final output for a finished Grok job in this repository
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" result "$ARGUMENTS"`

Present the full command output to the user. Do not summarize or condense it. Preserve:
- Job ID and status
- Grok's complete output, including verdicts, findings, and next steps
- File paths and line numbers exactly as reported
- Any error messages
- Follow-up commands such as `/grok:rescue --resume` and `grok --resume <session-id>`
