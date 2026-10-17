# grok-plugin-claude-code

A [Claude Code](https://claude.com/claude-code) plugin that brings the
[Grok CLI](https://x.ai/cli) into Claude Code the same way OpenAI's
[`codex` plugin](https://github.com/openai/codex-plugin-cc) brings Codex: code
reviews, adversarial reviews, delegated rescue tasks, tracked background jobs,
and an optional stop-time review gate.

Grok runs with the models, API endpoints and keys you already configured in
`~/.grok/config.toml`, so a custom gateway or BYOK setup works without
`grok login`.

## Requirements

- The `grok` CLI on your `PATH`, at `~/.grok/bin/grok`, or pointed to by
  `GROK_BIN`.
- Credentials for the model Grok will use, from any of:
  - `api_key` or `env_key` in that model's `[model."<id>"]` table in
    `~/.grok/config.toml`;
  - a `grok login` session;
  - the `XAI_API_KEY` environment variable.
- Node.js 18 or later.

Delegated runs send your prompt and any code Grok reads to the endpoint
configured for the model — xAI, or your own gateway.

## Install

```text
/plugin install grok --marketplace ballShell/grok-plugin-claude-code
```

Or step by step, from Claude Code or a shell:

```bash
claude plugin marketplace add ballShell/grok-plugin-claude-code
claude plugin install grok@grok-plugin-claude-code
```

Then run `/grok:setup` to confirm Grok is ready.

## Commands

| Command | What it does |
| --- | --- |
| `/grok:setup` | Checks the Grok binary, `~/.grok/config.toml` (default model, configured models, endpoints, credential source) and toggles the review gate with `--enable-review-gate` / `--disable-review-gate`. |
| `/grok:review` | Read-only review of the working tree, or of the branch with `--base <ref>`. Offers to run in the background for anything non-trivial. |
| `/grok:adversarial-review` | Review that challenges the design and assumptions, with optional focus text. |
| `/grok:rescue <task>` | Hands a task to the `grok:grok-rescue` subagent. Write-capable by default. Asks whether to continue the previous Grok thread when there is one. |
| `/grok:status [job-id]` | Active and recent Grok jobs for this repository. |
| `/grok:result [job-id]` | Stored output of a finished job. |
| `/grok:cancel [job-id]` | Stops a running job. |

Claude can also call the `grok:grok-rescue` subagent on its own when a task
is worth handing to Grok.

### Rescue flags

| Flag | Effect |
| --- | --- |
| `--background` / `--wait` | Run the subagent in the background or the foreground. |
| `--resume` / `--fresh` | Continue the latest Grok thread from this session, or start a new one. |
| `--model <id>` | Use a model by its `[model.<id>]` id from `~/.grok/config.toml`, or any id listed by `grok models`. Defaults to `[models].default`. |
| `--effort <level>` | Grok reasoning effort. Some gateway models have none. |

Read-only runs use Grok's plan mode. Write runs auto-approve Grok's tools.

### Examples

```text
/grok:setup
/grok:review --base main
/grok:adversarial-review --background focus on the retry logic
/grok:rescue fix the failing auth test in apps/api
/grok:rescue --model grok-4.7 --background refactor the camera rig
/grok:rescue --resume apply the top fix
```

## Using `~/.grok/config.toml`

The plugin reads `$GROK_HOME/config.toml` (default `~/.grok/config.toml`), the
same file the Grok CLI uses. For example:

```toml
[models]
default = "grok-4.7"

[model."grok-4.7"]
model = "grok-4.7"
base_url = "https://your-gateway.example/v1"
name = "AI Gateway"
api_key = "sk-..."            # or: env_key = "MY_GATEWAY_KEY"
api_backend = "responses"
```

- Runs without `--model` use `[models].default`.
- `--model <id>` selects another `[model.<id>]` table.
- A model counts as authenticated when its table has `api_key`, an `env_key`
  whose variable is set, or `auth_provider`. A model with no table of its own
  needs a `grok login` session or `XAI_API_KEY`.
- `/grok:setup` shows each model's endpoint and credential source. It never
  prints key values.
- A project-level `.grok/config.toml` overrides the user config inside that
  repository; `/grok:setup` reports it when present.

## Review gate

`/grok:setup --enable-review-gate` turns on a Stop hook for the current
repository. When a Claude turn ends with uncommitted changes, Grok reviews that
turn's edits and can block the stop with a reason Claude must address. It runs
a real Grok call on every such turn, so it is off by default.

## How it works

`plugins/grok/scripts/grok-companion.mjs` drives Grok's headless mode
(`grok --prompt-file <file> --output-format json`). Every task and review is
recorded as a job under `${CLAUDE_PLUGIN_DATA}`. Background tasks run in a
detached worker. A SessionStart hook ties jobs to the Claude session, and a
SessionEnd hook stops that session's running jobs.

```text
.claude-plugin/marketplace.json
plugins/grok/
  .claude-plugin/plugin.json
  agents/grok-rescue.md
  commands/{setup,review,adversarial-review,rescue,status,result,cancel}.md
  hooks/hooks.json
  prompts/{review,adversarial-review,stop-review-gate}.md
  scripts/grok-companion.mjs
  scripts/session-lifecycle-hook.mjs
  scripts/stop-review-gate-hook.mjs
  scripts/lib/{args,git,grok,grok-config,jobs,render,state}.mjs
  skills/{grok-cli-runtime,grok-prompting,grok-result-handling}/SKILL.md
```

## License

[MIT](./LICENSE). Forked from
[zachdunn/grok-plugin-claude-code](https://github.com/zachdunn/grok-plugin-claude-code).
Not affiliated with xAI, OpenAI, or Anthropic.
