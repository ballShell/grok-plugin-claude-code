---
name: grok-prompting
description: Internal guidance for shaping a crisp Grok task prompt before the grok-rescue subagent forwards it. Covers stating the goal, constraints, acceptance criteria, and scope so a one-shot headless Grok run succeeds.
user-invocable: false
---

# Grok prompting

Grok runs the delegated task in a **single headless pass** — there is no
back-and-forth to clarify. The prompt has to carry everything Grok needs. Shape
the user's request into a crisp task before forwarding it; do not do the task
yourself.

## What a good Grok task prompt contains

1. **The goal, in one sentence.** What should be true when Grok is done.
2. **Where to work.** Name the directory, package, or files when known. Grok
   starts from the run's `cwd` and reads from there.
3. **Constraints.** What it may and may not touch; conventions to follow;
   anything to leave alone.
4. **Acceptance criteria.** How Grok (and the user) will know it worked — "tests
   pass", "tsc clean", "the endpoint returns 200", a specific behavior.
5. **Done-ness.** For a write task, ask for the edits plus a short summary of
   what changed. For a read task, ask for the specific answer/finding format.

## Keep it tight

- Prefer concrete nouns (file paths, function names, error text) over vague
  description. Paste the actual error, not a paraphrase.
- State the *outcome*, not a step-by-step procedure — let Grok plan the steps.
- One task per run. Bundle only tightly-related changes.
- Pick the mode deliberately: `--write` to make changes, no `--write` for
  review/diagnosis/research with no edits.
- Leave `--effort` and `--model` unset unless the user asked for them; the
  default model comes from `~/.grok/config.toml`.

## Anti-patterns

- Don't forward a one-word ask ("fix it") — add the goal and acceptance check.
- Don't include routing flags (`--write`, `--effort`, …) inside the task text;
  they are controls, not instructions for Grok.
- Don't ask Grok to do exploratory work the main thread should just do itself —
  delegate substantial, bounded tasks, not trivial lookups.
