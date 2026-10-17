#!/usr/bin/env node
// SessionStart: export the Claude session id and plugin data dir into the
// session's Bash environment (via CLAUDE_ENV_FILE) so companion runs started
// from slash commands are attributed to this session and share its state.
// SessionEnd: stop this session's still-running Grok jobs and drop its jobs
// from the registry.

import fs from "node:fs";
import process from "node:process";

import { resolveWorkspaceRoot } from "./lib/git.mjs";
import { terminateProcessGroup } from "./lib/grok.mjs";
import { SESSION_ID_ENV } from "./lib/jobs.mjs";
import { loadState, updateState } from "./lib/state.mjs";

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function exportVar(name, value) {
  if (!process.env.CLAUDE_ENV_FILE || value == null || value === "") return;
  fs.appendFileSync(process.env.CLAUDE_ENV_FILE, `export ${name}=${shellQuote(value)}\n`, "utf8");
}

function handleSessionStart(input) {
  exportVar(SESSION_ID_ENV, input.session_id);
  exportVar("CLAUDE_PLUGIN_DATA", process.env.CLAUDE_PLUGIN_DATA);
}

function handleSessionEnd(input) {
  const sessionId = input.session_id || process.env[SESSION_ID_ENV];
  if (!sessionId) return;
  const workspaceRoot = resolveWorkspaceRoot(input.cwd || process.cwd());
  const jobs = loadState(workspaceRoot).jobs.filter((job) => job.sessionId === sessionId);
  if (!jobs.length) return;
  for (const job of jobs) {
    if (job.status !== "queued" && job.status !== "running") continue;
    terminateProcessGroup(job.grokPid);
    if (job.background) terminateProcessGroup(job.pid);
  }
  updateState(workspaceRoot, (state) => {
    state.jobs = state.jobs.filter((job) => job.sessionId !== sessionId);
  });
}

try {
  const input = readHookInput();
  const event = process.argv[2] ?? input.hook_event_name ?? "";
  if (event === "SessionStart") handleSessionStart(input);
  else if (event === "SessionEnd") handleSessionEnd(input);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
}
