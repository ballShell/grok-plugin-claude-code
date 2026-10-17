// Git helpers: workspace root resolution and review-diff collection.

import { spawnSync } from "node:child_process";

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function resolveWorkspaceRoot(cwd) {
  const result = git(["rev-parse", "--show-toplevel"], cwd);
  return result.ok && result.stdout.trim() ? result.stdout.trim() : cwd;
}

export function isGitRepository(cwd) {
  return git(["rev-parse", "--is-inside-work-tree"], cwd).ok;
}

export function hasWorkingTreeChanges(cwd) {
  const result = git(["status", "--porcelain"], cwd);
  return result.ok && Boolean(result.stdout.trim());
}

function hasHead(cwd) {
  return git(["rev-parse", "--verify", "HEAD"], cwd).ok;
}

export function defaultBaseRef(cwd) {
  for (const ref of ["origin/HEAD", "main", "master"]) {
    if (git(["rev-parse", "--verify", "--quiet", ref], cwd).ok) return ref;
  }
  return "main";
}

export const MAX_DIFF_CHARS = 120_000;

// Resolves the review target: an explicit --base (or --scope branch) means the
// branch diff against that base; otherwise the uncommitted working tree,
// including untracked files rendered as add-only diffs.
export function collectReviewDiff({ cwd, scope = "auto", base = null }) {
  const branch = scope === "branch" || (scope === "auto" && base);
  if (branch) {
    const ref = base || defaultBaseRef(cwd);
    const range = `${ref}...HEAD`;
    const check = git(["rev-parse", "--verify", "--quiet", ref], cwd);
    if (!check.ok) throw new Error(`Unknown base ref "${ref}".`);
    const summary = git(["diff", "--stat", range], cwd).stdout;
    const patch = git(["diff", range], cwd).stdout;
    return finalize({ label: `branch vs ${ref}`, scope: "branch", base: ref, summary, patch });
  }

  const summary = git(["status", "--short", "--untracked-files=all"], cwd).stdout;
  let patch = hasHead(cwd) ? git(["diff", "HEAD"], cwd).stdout : git(["diff", "--cached"], cwd).stdout;
  for (const line of summary.split("\n")) {
    if (!line.startsWith("?? ")) continue;
    const file = line.slice(3).trim().replace(/^"(.*)"$/, "$1");
    if (file) patch += `\n${git(["diff", "--no-index", "--", "/dev/null", file], cwd).stdout}`;
  }
  return finalize({ label: "working tree", scope: "working-tree", base: null, summary, patch });
}

function finalize({ label, scope, base, summary, patch }) {
  const empty = !summary.trim() && !patch.trim();
  let text = `# Change summary\n${summary.trim() || "(none)"}\n\n# Diff\n${patch.trim()}`;
  const truncated = text.length > MAX_DIFF_CHARS;
  if (truncated) text = text.slice(0, MAX_DIFF_CHARS);
  return { label, scope, base, text, truncated, empty };
}
