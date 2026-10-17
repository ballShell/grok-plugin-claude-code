<task>
Perform a READ-ONLY code review of {{TARGET_LABEL}} in the repository at the current working directory.
Do not create, edit, or delete any files.
The change under review is embedded below. You may read other files in the repository for context, but base every finding on this change.
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
Then list findings ordered by severity (blocker, high, medium, low, nit). For each finding give:
- `path:line` — the precise location in the changed code
- what is wrong and why it matters
- a concrete suggested fix
Mark anything you inferred rather than observed as an inference.
End with one line starting `Residual risk:`.
If you find no real issues, say so explicitly. Do not invent findings to fill space.
</output_contract>
