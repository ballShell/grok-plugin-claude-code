---
name: grok-result-handling
description: Internal guidance for presenting Grok companion output (delegated task results and reviews) back to the user
user-invocable: false
---

# Grok result handling

When the `grok-companion` runtime returns Grok output:

- Preserve the companion's structure: header, verdict, findings, and follow-up commands.
- For review output, present findings first, in the severity order Grok returned (blocker → high → medium → low → nit). Do not reorder or re-rank.
- Use the `path:line` locations exactly as Grok reports them.
- Preserve evidence boundaries. If Grok marked something as an inference, an uncertainty, or an open question, keep that distinction.
- Keep the residual-risk line when Grok includes one.
- If there are no findings, say so explicitly. Do not invent issues.
- If a write-mode task made edits, say so explicitly and list the touched files when Grok reports them.
- If a Grok run failed or was cancelled, report that and stop. Do not silently turn a failed Grok run into your own implementation or a substitute review.
- If Grok was never invoked (binary missing, no credentials in `~/.grok/config.toml`, not signed in), say so and point the user at `/grok:setup`; do not generate a replacement answer.
- A review is read-only. Never apply a fix while surfacing review output — making the fixes is a separate, explicit step the user asks for.
