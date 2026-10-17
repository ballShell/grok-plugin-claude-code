#!/usr/bin/env node
// Stop hook. When the review gate is enabled for this repository
// (`/grok:setup --enable-review-gate`), Grok reviews the edits from the turn
// that is ending and can block the stop with a reason Claude must address.
// When the gate is off it only notes a still-running Grok job.
//
// It never traps the session: `stop_hook_active` (a stop already continued by
// this hook) exits immediately, and setup or runtime failures only log a note.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { collectReviewDiff, hasWorkingTreeChanges, isGitRepository, resolveWorkspaceRoot } from "./lib/git.mjs";
import { resolveAuthStatus } from "./lib/grok-config.mjs";
import { resolveGrokBin } from "./lib/grok.mjs";
import { isActive, jobsForSession, SESSION_ID_ENV } from "./lib/jobs.mjs";
import { getConfig } from "./lib/state.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const STOP_REVIEW_TIMEOUT_MS = 14 * 60 * 1000;
const MAX_GATE_DIFF_CHARS = 60_000;

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function note(message) {
  if (message) process.stderr.write(`${message}\n`);
}

function buildPrompt(input, workspaceRoot) {
  const lastMessage = String(input.last_assistant_message ?? "").trim();
  let diff = collectReviewDiff({ cwd: workspaceRoot, scope: "working-tree" }).text;
  if (diff.length > MAX_GATE_DIFF_CHARS) diff = `${diff.slice(0, MAX_GATE_DIFF_CHARS)}\n... (truncated)`;
  const template = fs.readFileSync(path.join(ROOT_DIR, "prompts", "stop-review-gate.md"), "utf8");
  const vars = {
    CLAUDE_RESPONSE_BLOCK: lastMessage ? `Previous Claude response:\n${lastMessage}` : "",
    DIFF: diff
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => vars[key] ?? "");
}

function runGateReview(input, workspaceRoot) {
  const env = { ...process.env, ...(input.session_id ? { [SESSION_ID_ENV]: input.session_id } : {}) };
  const result = spawnSync(
    process.execPath,
    [path.join(SCRIPT_DIR, "grok-companion.mjs"), "task", "--json", "--cwd", workspaceRoot, buildPrompt(input, workspaceRoot)],
    { cwd: workspaceRoot, env, encoding: "utf8", timeout: STOP_REVIEW_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }
  );
  if (result.error?.code === "ETIMEDOUT") {
    return { ok: false, reason: "The Grok stop-gate review timed out. Run /grok:review --wait manually, or disable the gate with /grok:setup --disable-review-gate." };
  }
  let payload = null;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    payload = null;
  }
  if (!payload || payload.status !== "completed") {
    const detail = payload?.errorMessage || String(result.stdout || result.stderr || "").trim();
    return { ok: false, reason: `The Grok stop-gate review failed${detail ? `: ${detail}` : "."} Run /grok:setup, or disable the gate with /grok:setup --disable-review-gate.` };
  }
  // Grok often prefixes a one-line preamble ("I'll review ...") glued to the
  // answer, so take the first ALLOW:/BLOCK: marker rather than the first line.
  const text = String(payload.rawOutput ?? "").trim();
  const match = text.match(/(?:^|[\s.!?`*])(ALLOW|BLOCK):[ \t]*([^\n]*)/);
  if (match?.[1] === "ALLOW") return { ok: true };
  if (match?.[1] === "BLOCK") {
    return { ok: false, reason: `Grok stop-gate review found issues to fix before ending the turn: ${match[2].trim() || text}` };
  }
  return {
    ok: false,
    reason: `The Grok stop-gate review returned an unexpected answer (job ${payload.jobId}). Run /grok:review --wait manually, or disable the gate with /grok:setup --disable-review-gate.`
  };
}

function main() {
  const input = readHookInput();
  if (input.stop_hook_active) return;
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!isGitRepository(cwd)) return;
  const workspaceRoot = resolveWorkspaceRoot(cwd);

  if (input.session_id) process.env[SESSION_ID_ENV] = input.session_id;
  const running = jobsForSession(workspaceRoot).find(isActive);
  const runningNote = running
    ? `Grok job ${running.id} is still running. Check /grok:status, or /grok:cancel ${running.id} to stop it.`
    : null;

  if (!getConfig(workspaceRoot).stopReviewGate) {
    note(runningNote);
    return;
  }
  if (!resolveGrokBin() || !resolveAuthStatus().loggedIn) {
    note("Grok review gate is enabled but Grok is not ready. Run /grok:setup.");
    note(runningNote);
    return;
  }
  if (!hasWorkingTreeChanges(workspaceRoot)) {
    note(runningNote);
    return;
  }

  const review = runGateReview(input, workspaceRoot);
  if (!review.ok) {
    const reason = runningNote ? `${runningNote} ${review.reason}` : review.reason;
    process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
    return;
  }
  note(runningNote);
}

try {
  main();
} catch (error) {
  note(error instanceof Error ? error.message : String(error));
}
