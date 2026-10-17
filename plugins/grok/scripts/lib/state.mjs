// Per-workspace companion state: plugin config (review gate) and the tracked
// job registry. Lives under ${CLAUDE_PLUGIN_DATA} so it survives plugin
// updates; falls back to the OS temp dir when run outside Claude Code.

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveWorkspaceRoot } from "./git.mjs";

const STATE_VERSION = 1;
const MAX_JOBS = 50;

function defaultState() {
  return { version: STATE_VERSION, config: { stopReviewGate: false }, jobs: [] };
}

export function nowIso() {
  return new Date().toISOString();
}

export function resolveStateDir(cwd) {
  const root = resolveWorkspaceRoot(cwd);
  let canonical = root;
  try {
    canonical = fs.realpathSync.native(root);
  } catch {
    canonical = root;
  }
  const slug =
    (path.basename(root) || "workspace").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "workspace";
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  const base = process.env.CLAUDE_PLUGIN_DATA
    ? path.join(process.env.CLAUDE_PLUGIN_DATA, "state")
    : path.join(os.tmpdir(), "grok-companion");
  return path.join(base, `${slug}-${hash}`);
}

function stateFile(cwd) {
  return path.join(resolveStateDir(cwd), "state.json");
}

export function jobsDir(cwd) {
  const dir = path.join(resolveStateDir(cwd), "jobs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function jobFilePath(cwd, jobId) {
  return path.join(jobsDir(cwd), `${jobId}.json`);
}

export function jobLogPath(cwd, jobId) {
  return path.join(jobsDir(cwd), `${jobId}.log`);
}

export function jobPromptPath(cwd, jobId) {
  return path.join(jobsDir(cwd), `${jobId}.prompt.md`);
}

export function loadState(cwd) {
  const file = stateFile(cwd);
  if (!fs.existsSync(file)) return defaultState();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      ...defaultState(),
      ...parsed,
      config: { ...defaultState().config, ...(parsed.config ?? {}) },
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
    };
  } catch {
    return defaultState();
  }
}

function removeIfExists(file) {
  try {
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // Best-effort cleanup of pruned job artifacts.
  }
}

// Writes are whole-file replacements via rename so a concurrent reader never
// sees a half-written state file.
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

export function updateState(cwd, mutate) {
  const state = loadState(cwd);
  const before = new Set(state.jobs.map((job) => job.id));
  mutate(state);
  state.jobs = [...state.jobs]
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
    .slice(0, MAX_JOBS);
  const kept = new Set(state.jobs.map((job) => job.id));
  for (const id of before) {
    if (kept.has(id)) continue;
    removeIfExists(jobFilePath(cwd, id));
    removeIfExists(jobLogPath(cwd, id));
    removeIfExists(jobPromptPath(cwd, id));
  }
  writeJsonAtomic(stateFile(cwd), { ...state, version: STATE_VERSION });
  return state;
}

export function getConfig(cwd) {
  return loadState(cwd).config;
}

export function setConfig(cwd, key, value) {
  return updateState(cwd, (state) => {
    state.config = { ...state.config, [key]: value };
  });
}

export function listJobs(cwd) {
  return loadState(cwd).jobs;
}

// The registry entry is the summary used by status; the job file holds the
// full record including the rendered result.
export function upsertJob(cwd, patch) {
  updateState(cwd, (state) => {
    const index = state.jobs.findIndex((job) => job.id === patch.id);
    const timestamp = nowIso();
    if (index === -1) {
      state.jobs.unshift({ createdAt: timestamp, updatedAt: timestamp, ...patch });
    } else {
      state.jobs[index] = { ...state.jobs[index], ...patch, updatedAt: timestamp };
    }
  });
}

export function readJobFile(cwd, jobId) {
  const file = jobFilePath(cwd, jobId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function writeJobFile(cwd, jobId, record) {
  writeJsonAtomic(jobFilePath(cwd, jobId), record);
}

export function generateJobId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
