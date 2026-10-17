<task>
Perform a READ-ONLY adversarial review of {{TARGET_LABEL}} in the repository at the current working directory.
Do not create, edit, or delete any files.
Assume the change is wrong until the evidence shows otherwise. Challenge the approach itself, not just the implementation details:
- Is this the right design for the problem, or is there a simpler or safer one?
- Which assumptions does it depend on, and what happens when they fail?
- Where does it break under real-world conditions: empty or malformed input, concurrency, retries, partial failure, stale state, rollback, scale?
- What security, data-loss, or compatibility risks does it introduce?
The change under review is embedded below. You may read other files in the repository for context.
{{TRUNCATION_NOTE}}
</task>

<change>
```diff
{{DIFF}}
```
</change>

{{FOCUS_BLOCK}}

<output_contract>
Start with a one-line verdict: `Verdict: ship`, `Verdict: ship with fixes`, or `Verdict: do not ship`.
Prefer a few high-confidence, concrete findings over a long shallow list. Order them by severity (blocker, high, medium, low). For each finding give:
- `path:line` — the precise location
- the failure scenario: concrete input or state → wrong behavior
- why the current design allows it, and a concrete alternative
Mark anything you inferred rather than observed as an inference.
End with one line starting `Residual risk:`.
If the change holds up, say so explicitly. Do not invent findings to fill space.
</output_contract>
