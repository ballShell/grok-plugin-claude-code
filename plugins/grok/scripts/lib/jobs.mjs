// Tracked Grok jobs. Every task and review run is recorded so /grok:status,
// /grok:result and /grok:cancel work for foreground and background runs alike.
//
// Job lifecycle: queued → running → completed | failed | cancelled.
// The registry entry (state.json) carries the summary fields; the job file
// carries the full record including the rendered output.

import fs from "node:fs";

import { buildGrokArgs, isProcessAlive, runGrok, terminateProcessGroup } from "./grok.mjs";
import {
  generateJobId,
  jobLogPath,
  jobPromptPath,
  listJobs,
  nowIso,
  readJobFile,
  upsertJob,
  writeJobFile
} from "./state.mjs";

export const SESSION_ID_ENV = "GROK_COMPANION_SESSION_ID";
const ACTIVE = new Set(["queued", "running"]);

export function isActive(job) {
  return ACTIVE.has(job?.status);
}

function summarize(text, limit = 80) {
  const flat = String(text ?? "").trim().replace(/\s+/g, " ");
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 3)}...`;
}

const SUMMARY_FIELDS = [
  "id",
  "kind",
  "title",
  "summary",
  "status",
  "phase",
  "mode",
  "model",
  "background",
  "sessionId",
  "grokSessionId",
  "pid",
  "grokPid",
  "startedAt",
  "completedAt",
  "errorMessage",
  "logFile"
];

function persist(workspaceRoot, record) {
  writeJobFile(workspaceRoot, record.id, record);
  const summary = {};
  for (const key of SUMMARY_FIELDS) if (key in record) summary[key] = record[key];
  upsertJob(workspaceRoot, summary);
  return record;
}

export function createJob({ workspaceRoot, cwd, kind, title, prompt, request, background }) {
  const id = generateJobId(kind === "task" ? "task" : "review");
  const promptFile = jobPromptPath(workspaceRoot, id);
  fs.writeFileSync(promptFile, prompt, "utf8");
  const logFile = jobLogPath(workspaceRoot, id);
  fs.writeFileSync(logFile, "", "utf8");
  const sessionId = process.env[SESSION_ID_ENV] || null;
  return persist(workspaceRoot, {
    id,
    kind,
    title,
    summary: summarize(request.displayText ?? prompt),
    status: "queued",
    phase: "queued",
    mode: request.mode,
    model: request.model ?? null,
    effort: request.effort ?? null,
    background: Boolean(background),
    cwd,
    workspaceRoot,
    sessionId,
    request,
    promptFile,
    logFile,
    createdAt: nowIso()
  });
}

export function loadJob(workspaceRoot, jobId) {
  return readJobFile(workspaceRoot, jobId);
}

// Runs grok for an already-created job and records the outcome. `render`
// turns the finished record into the text shown to the user.
export async function executeJob(bin, job, render) {
  const { workspaceRoot } = job;
  let record = persist(workspaceRoot, {
    ...job,
    status: "running",
    phase: "running",
    pid: process.pid,
    startedAt: nowIso()
  });

  const args = buildGrokArgs({ promptFile: job.promptFile, ...job.request });
  fs.appendFileSync(job.logFile, `[${nowIso()}] grok ${args.map((a) => JSON.stringify(a)).join(" ")}\n`);

  const run = await runGrok(bin, args, {
    cwd: job.cwd,
    logFile: job.logFile,
    onSpawn: (grokPid) => {
      record = persist(workspaceRoot, { ...record, grokPid });
    }
  });

  // A cancel that landed while grok was running wins over the exit result.
  const latest = readJobFile(workspaceRoot, job.id);
  if (latest?.status === "cancelled") {
    return persist(workspaceRoot, { ...latest, pid: null, grokPid: null });
  }

  const parsed = run.parsed;
  const ok =
    run.exitCode === 0 && parsed && parsed.type !== "error" && typeof parsed.text === "string";
  const errorMessage = ok
    ? null
    : parsed?.message ||
      lastLines(run.stderr) ||
      (run.signal ? `grok terminated by ${run.signal}` : `grok exited with code ${run.exitCode}`);

  const finished = {
    ...record,
    status: ok ? "completed" : "failed",
    phase: ok ? "done" : "failed",
    pid: null,
    grokPid: null,
    completedAt: nowIso(),
    exitCode: run.exitCode,
    grokSessionId: parsed?.sessionId ?? record.grokSessionId ?? null,
    text: ok ? parsed.text : null,
    stopReason: parsed?.stopReason ?? null,
    usage: parsed?.usage ?? null,
    modelUsage: parsed?.modelUsage ?? null,
    costUsd: parsed?.total_cost_usd ?? null,
    errorMessage
  };
  finished.rendered = render(finished);
  fs.appendFileSync(job.logFile, `\n[${nowIso()}] Final output\n${finished.rendered}\n`);
  return persist(workspaceRoot, finished);
}

function lastLines(text, count = 8) {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  return lines.slice(-count).join("\n");
}

// Marks jobs whose worker process vanished (crash, reboot, killed session) as
// failed so status never shows a phantom "running" job.
export function reconcileJobs(workspaceRoot) {
  for (const job of listJobs(workspaceRoot)) {
    if (!isActive(job)) continue;
    if (job.pid && isProcessAlive(job.pid)) continue;
    if (!job.pid && job.status === "queued") {
      const ageMs = Date.now() - Date.parse(job.createdAt ?? 0);
      if (ageMs < 30_000) continue;
    }
    const full = readJobFile(workspaceRoot, job.id) ?? job;
    persist(workspaceRoot, {
      ...full,
      status: "failed",
      phase: "failed",
      pid: null,
      grokPid: null,
      completedAt: nowIso(),
      errorMessage: full.errorMessage ?? "The companion process exited before the job finished."
    });
  }
}

export function jobsForSession(workspaceRoot, { all = false } = {}) {
  const jobs = listJobs(workspaceRoot);
  const sessionId = process.env[SESSION_ID_ENV];
  if (all || !sessionId) return jobs;
  return jobs.filter((job) => job.sessionId === sessionId);
}

export function findJob(workspaceRoot, jobId) {
  const jobs = listJobs(workspaceRoot);
  return jobs.find((job) => job.id === jobId) ?? jobs.find((job) => job.id.endsWith(jobId)) ?? null;
}

export function cancelJob(workspaceRoot, job) {
  const full = readJobFile(workspaceRoot, job.id) ?? job;
  // Record the cancel first so the worker does not overwrite it on exit.
  const cancelled = persist(workspaceRoot, {
    ...full,
    status: "cancelled",
    phase: "cancelled",
    completedAt: nowIso(),
    errorMessage: "Cancelled by user."
  });
  if (full.grokPid) terminateProcessGroup(full.grokPid);
  if (full.background && full.pid && full.pid !== process.pid) terminateProcessGroup(full.pid);
  return cancelled;
}

export function resumableTaskJob(workspaceRoot) {
  return (
    jobsForSession(workspaceRoot).find(
      (job) => job.kind === "task" && job.grokSessionId && !isActive(job)
    ) ?? null
  );
}

export { summarize };
