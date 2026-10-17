# grok (Claude Code plugin)

Use the [Grok CLI](https://x.ai/cli) from Claude Code to review code or
delegate tasks. Grok runs with the models, endpoints and keys in
`~/.grok/config.toml`.

```text
/plugin install grok --marketplace ballShell/grok-plugin-claude-code
```

| Component | Purpose |
| --- | --- |
| `/grok:setup` | Readiness check (binary, config.toml models, credential source) and review-gate toggle |
| `/grok:review`, `/grok:adversarial-review` | Read-only reviews of the working tree or a branch |
| `/grok:rescue` | Delegate a task through the `grok:grok-rescue` subagent |
| `/grok:status`, `/grok:result`, `/grok:cancel` | Follow up on tracked jobs |
| `grok:grok-rescue` subagent | Thin forwarder to `grok-companion.mjs task` |
| Hooks | Session job tracking and the optional stop-time review gate |

See the [repository README](../../README.md) for flags, config.toml details and
the review gate.
