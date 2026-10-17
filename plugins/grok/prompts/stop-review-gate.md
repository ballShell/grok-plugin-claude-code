<task>
Run a stop-gate review of the previous Claude turn.
Only review work from the previous Claude turn, and only if that turn made code changes.
Pure status, setup, review, or reporting output does not count as reviewable work. For example, the output of /grok:setup or /grok:status does not count.
If the previous turn made no direct edits, return ALLOW immediately and do no further work.
Otherwise, challenge whether that specific work should ship. You may read repository files for context, but do not modify anything.

{{CLAUDE_RESPONSE_BLOCK}}

Current uncommitted repository state:
```diff
{{DIFF}}
```
</task>

<compact_output_contract>
Return a compact final answer.
Your first line must be exactly one of:
- ALLOW: <short reason>
- BLOCK: <short reason>
Do not put anything before that first line.
</compact_output_contract>

<default_follow_through_policy>
Use ALLOW if the previous turn did not make code changes or if you do not see a blocking issue.
Use BLOCK only if the previous turn made code changes and something still needs to be fixed before stopping.
Do not block based on older edits that the previous turn did not make.
Ground every blocking claim in the repository state you inspected, not in the Claude response alone.
</default_follow_through_policy>
