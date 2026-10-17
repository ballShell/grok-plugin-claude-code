---
description: Check whether the local Grok CLI and ~/.grok/config.toml are ready, and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" setup $ARGUMENTS
```

Present the output to the user. Then:

- If the grok binary is `NOT FOUND`, tell the user to install the Grok CLI (https://x.ai/cli) or set `GROK_BIN`. Do not install it yourself unless the user asks.
- If `authenticated: no`, explain the three options from the output: add `api_key` (or `env_key`) to the default model's `[model."<id>"]` table in `~/.grok/config.toml`, run `! grok login` (the `!` runs it interactively in the user's session), or export `XAI_API_KEY`. Never ask the user to paste an API key into the chat.
- If Grok is ready, confirm that `/grok:rescue`, `/grok:review`, `/grok:adversarial-review` and the `grok:grok-rescue` subagent can be used.

Do not run a task or review as part of setup.
