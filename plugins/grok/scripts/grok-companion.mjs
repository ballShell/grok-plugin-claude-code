#!/usr/bin/env node
// grok-companion — the runtime behind the Claude Code `grok` plugin.
// Drives the Grok CLI's headless mode and tracks every run as a job so slash
// commands can report status, fetch results, and cancel work.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { normalizeArgv, parseArgs } from "./lib/args.mjs";
import { collectReviewDiff, isGitRepository, resolveWorkspaceRoot } from "./lib/git.mjs";
import { resolveAuthStatus } from "./lib/grok-config.mjs";
import { grokVersion, resolveGrokBin } from "./lib/grok.mjs";
import {
  cancelJob,
  createJob,
  executeJob,
  findJob,
  isActive,
  jobsForSession,
  loadJob,
  reconcileJobs,
  resumableTaskJob
} from "./lib/jobs.mjs";
import {
  renderCancel,
  renderJobDetail,
  renderReviewResult,
  renderSetup,
  renderStatus,
  renderStoredResult,
  renderTaskResult
} from "./lib/render.mjs";
import { getConfig, setConfig } from "./lib/state.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(SCRIPT_PATH), "..");

const USAGE = `Usage:
  grok-companion.mjs setup [--enable-review-gate|--disable-review-gate] [--json]
  grok-companion.mjs task [--background] [--write] [--resume-last|--resume|--session <id>|--fresh]
                          [--model <id>] [--effort <level>] [--worktree[=<name>]] [--max-turns <n>]
                          [--cwd <dir>] [--json] <prompt>
  grok-companion.mjs task-resume-candidate [--json]
  grok-companion.mjs review [--wait|--background] [--base <ref>] [--scope auto|working-tree|branch]
                            [--model <id>] [--effort <level>] [--cwd <dir>] [focus text]
  grok-companion.mjs adversarial-review [same options as review]
  grok-companion.mjs status [job-id] [--all] [--wait] [--timeout-ms <ms>] [--json]
  grok-companion.mjs result [job-id] [--json]
  grok-companion.mjs cancel [job-id] [--json]
`;

class UserError extends Error {}

function write(text) {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function resolveCwd(options) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function loadPrompt(name, vars) {
  const template = fs.readFileSync(path.join(ROOT_DIR, "prompts", `${name}.md`), "utf8");
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => vars[key] ?? "");
}

// Fails fast, before a job is created, when grok cannot run at all.
function requireGrok(model) {
  const bin = resolveGrokBin();
  if (!bin) {
    throw new UserError("Grok CLI not found (checked GROK_BIN, PATH and ~/.grok/bin). Run /grok:setup.");
  }
  const auth = resolveAuthStatus({ model });
  if (!auth.loggedIn) {
    const configured = auth.config.models.map((m) => m.id);
    if (auth.model && !auth.modelEntry) {
      throw new UserError(
        `Model "${auth.model}" has no [model."${auth.model}"] table in ${auth.config.path}, and there is no \`grok login\` session or XAI_API_KEY for built-in models.` +
          (configured.length ? ` Configured models: ${configured.join(", ")}.` : "") +
          " Run /grok:setup for details."
      );
    }
    const where = auth.model ? ` for model "${auth.model}"` : "";
    throw new UserError(
      `Grok has no credentials${where}: set api_key/env_key for it in ${auth.config.path}, run \`!grok login\`, or export XAI_API_KEY. Run /grok:setup for details.`
    );
  }
  return bin;
}

// ---- setup -----------------------------------------------------------------

function findProjectConfig(cwd) {
  const root = resolveWorkspaceRoot(cwd);
  const candidate = path.join(root, ".grok", "config.toml");
  return fs.existsSync(candidate) ? candidate : null;
}

function cmdSetup(argv) {
  const { options } = parseArgs(normalizeArgv(argv), {
    booleans: ["json", "enable-review-gate", "disable-review-gate"],
    values: ["cwd"]
  });
  const cwd = resolveCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const actions = [];
  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    throw new UserError("Pass only one of --enable-review-gate / --disable-review-gate.");
  }
  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
    actions.push(`Enabled the stop-time review gate for ${workspaceRoot}.`);
  }
  if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
    actions.push(`Disabled the stop-time review gate for ${workspaceRoot}.`);
  }

  const binary = resolveGrokBin();
  const version = grokVersion(binary);
  const auth = resolveAuthStatus();
  const reviewGate = Boolean(getConfig(workspaceRoot).stopReviewGate);
  const nextSteps = [];
  if (!binary) {
    nextSteps.push("Install the Grok CLI (see https://x.ai/cli), or point GROK_BIN at the binary.");
  } else if (!version) {
    nextSteps.push(`The grok binary at ${binary} did not run; reinstall it or fix GROK_BIN.`);
  }
  if (!auth.config.exists) {
    nextSteps.push(`No ${auth.config.path}. Grok will use its built-in defaults.`);
  }
  if (auth.config.defaultModel && !auth.modelEntry) {
    nextSteps.push(
      `Default model "${auth.config.defaultModel}" has no [model."${auth.config.defaultModel}"] table; Grok treats it as a built-in model.`
    );
  }
  if (!auth.loggedIn) {
    nextSteps.push(
      `Add api_key (or env_key) to the [model."${auth.model ?? "<id>"}"] table in ${auth.config.path}, run \`!grok login\`, or export XAI_API_KEY.`
    );
  }
  if (!reviewGate) {
    nextSteps.push("Optional: `/grok:setup --enable-review-gate` makes Grok review Claude's edits before a turn ends.");
  }

  const ready = Boolean(binary && version && auth.loggedIn);
  const report = {
    ready,
    binary,
    version,
    auth: { loggedIn: auth.loggedIn, source: auth.source, model: auth.model },
    config: auth.config,
    projectConfig: findProjectConfig(cwd),
    reviewGate,
    nextSteps,
    actions
  };
  if (options.json) writeJson(report);
  else write(renderSetup(report));
  return ready ? 0 : 1;
}

// ---- task ------------------------------------------------------------------

const TASK_SPEC = {
  values: ["model", "effort", "cwd", "session", "max-turns", "job"],
  booleans: ["background", "wait", "write", "read", "resume-last", "resume", "fresh", "json", "worktree"],
  aliases: { m: "model", C: "cwd" }
};

async function cmdTask(argv) {
  const { options, positionals } = parseArgs(normalizeArgv(argv), TASK_SPEC);
  const cwd = resolveCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const prompt = positionals.join(" ").trim();
  if (!prompt) throw new UserError("No task text provided. Describe what Grok should do.");
  if (options.write && options.read) throw new UserError("Pass only one of --write / --read.");

  let resumeSessionId = options.session ?? null;
  if (!resumeSessionId && (options["resume-last"] || options.resume) && !options.fresh) {
    const candidate = resumableTaskJob(workspaceRoot);
    if (!candidate) {
      throw new UserError("No earlier Grok task thread to resume in this session. Run it without --resume.");
    }
    resumeSessionId = candidate.grokSessionId;
  }

  const bin = requireGrok(options.model);
  const request = {
    mode: options.write ? "write" : "read",
    model: options.model ?? null,
    effort: options.effort ?? null,
    resumeSessionId,
    worktree: options.worktree ?? null,
    maxTurns: options["max-turns"] ?? null,
    displayText: prompt
  };
  const job = createJob({
    workspaceRoot,
    cwd,
    kind: "task",
    title: "Grok task",
    prompt,
    request,
    background: Boolean(options.background)
  });

  if (options.background) {
    const child = spawn(process.execPath, [SCRIPT_PATH, "task-worker", "--job", job.id, "--cwd", workspaceRoot], {
      cwd,
      detached: true,
      stdio: "ignore",
      env: process.env
    });
    child.unref();
    const payload = { jobId: job.id, status: "queued", logFile: job.logFile };
    if (options.json) writeJson(payload);
    else {
      write(
        [
          `Grok task ${job.id} started in the background (${request.mode === "write" ? "write" : "read-only"}).`,
          `Check progress: /grok:status ${job.id}`,
          `Get the output when done: /grok:result ${job.id}`,
          `Cancel: /grok:cancel ${job.id}`
        ].join("\n")
      );
    }
    return 0;
  }

  const finished = await executeJob(bin, job, renderTaskResult);
  if (options.json) {
    writeJson({
      jobId: finished.id,
      status: finished.status,
      grokSessionId: finished.grokSessionId,
      rawOutput: finished.text,
      errorMessage: finished.errorMessage
    });
  } else {
    write(finished.rendered);
  }
  return finished.status === "completed" ? 0 : 1;
}

async function cmdTaskWorker(argv) {
  const { options } = parseArgs(argv, { values: ["job", "cwd"] });
  const workspaceRoot = options.cwd ?? process.cwd();
  const job = loadJob(workspaceRoot, options.job);
  if (!job || job.status !== "queued") return 1;
  const bin = resolveGrokBin();
  if (!bin) return 1;
  const render = job.kind === "task" ? renderTaskResult : renderReviewResult;
  const finished = await executeJob(bin, job, render);
  return finished.status === "completed" ? 0 : 1;
}

function cmdTaskResumeCandidate(argv) {
  const { options } = parseArgs(normalizeArgv(argv), { booleans: ["json"], values: ["cwd"] });
  const workspaceRoot = resolveWorkspaceRoot(resolveCwd(options));
  reconcileJobs(workspaceRoot);
  const job = resumableTaskJob(workspaceRoot);
  const payload = job
    ? { available: true, jobId: job.id, grokSessionId: job.grokSessionId, summary: job.summary }
    : { available: false };
  if (options.json) writeJson(payload);
  else write(job ? `Resumable Grok thread: ${job.id} — ${job.summary}` : "No resumable Grok thread.");
  return 0;
}

// ---- review ----------------------------------------------------------------

const REVIEW_SPEC = {
  values: ["base", "scope", "model", "effort", "cwd"],
  booleans: ["wait", "background", "json"],
  aliases: { m: "model", C: "cwd" }
};

async function cmdReview(argv, kind) {
  const { options, positionals } = parseArgs(normalizeArgv(argv), REVIEW_SPEC);
  const cwd = resolveCwd(options);
  if (!isGitRepository(cwd)) throw new UserError(`${cwd} is not inside a git repository.`);
  const scope = options.scope ?? "auto";
  if (!["auto", "working-tree", "branch"].includes(scope)) {
    throw new UserError(`Unsupported --scope "${scope}". Use auto, working-tree, or branch.`);
  }
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  let diff;
  try {
    diff = collectReviewDiff({ cwd: workspaceRoot, scope, base: options.base ?? null });
  } catch (error) {
    throw new UserError(error.message);
  }
  if (diff.empty) {
    write(`Nothing to review: no changes found for ${diff.label}.`);
    return 0;
  }
  const bin = requireGrok(options.model);
  const focus = positionals.join(" ").trim();
  const prompt = loadPrompt(kind, {
    TARGET_LABEL: diff.scope === "branch" ? `the branch changes against \`${diff.base}\`` : "the uncommitted working-tree changes",
    DIFF: diff.text,
    TRUNCATION_NOTE: diff.truncated
      ? "The embedded diff was truncated for length. Read the remaining changed files directly and say that coverage may be partial."
      : "",
    FOCUS_BLOCK: focus ? `<reviewer_focus>\n${focus}\n</reviewer_focus>` : ""
  });
  const job = createJob({
    workspaceRoot,
    cwd: workspaceRoot,
    kind,
    title: kind === "review" ? "Grok review" : "Grok adversarial review",
    prompt,
    request: {
      mode: "read",
      model: options.model ?? null,
      effort: options.effort ?? null,
      targetLabel: diff.label,
      truncated: diff.truncated,
      displayText: `${kind === "review" ? "review" : "adversarial review"} of ${diff.label}${focus ? `: ${focus}` : ""}`
    },
    background: false
  });
  const finished = await executeJob(bin, job, renderReviewResult);
  if (options.json) writeJson({ jobId: finished.id, status: finished.status, rawOutput: finished.text, errorMessage: finished.errorMessage });
  else write(finished.rendered);
  return finished.status === "completed" ? 0 : 1;
}

// ---- status / result / cancel ---------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cmdStatus(argv) {
  const { options, positionals } = parseArgs(normalizeArgv(argv), {
    booleans: ["all", "json", "wait"],
    values: ["timeout-ms", "cwd"]
  });
  const workspaceRoot = resolveWorkspaceRoot(resolveCwd(options));
  reconcileJobs(workspaceRoot);
  const jobId = positionals[0];

  if (jobId) {
    let job = findJob(workspaceRoot, jobId);
    if (!job) throw new UserError(`No Grok job "${jobId}" in this repository.`);
    if (options.wait) {
      const deadline = Date.now() + Number(options["timeout-ms"] ?? 240000);
      while (isActive(job) && Date.now() < deadline) {
        await sleep(2000);
        reconcileJobs(workspaceRoot);
        job = findJob(workspaceRoot, job.id);
      }
    }
    const full = loadJob(workspaceRoot, job.id) ?? job;
    if (options.json) writeJson(stripLarge(full));
    else write(renderJobDetail(full));
    return 0;
  }

  const jobs = jobsForSession(workspaceRoot, { all: options.all });
  const reviewGate = Boolean(getConfig(workspaceRoot).stopReviewGate);
  if (options.json) writeJson({ reviewGate, jobs });
  else write(renderStatus(jobs, { reviewGate, scopeLabel: options.all ? "all sessions" : "this session" }));
  return 0;
}

function stripLarge(job) {
  const { rendered, ...rest } = job;
  return rest;
}

function cmdResult(argv) {
  const { options, positionals } = parseArgs(normalizeArgv(argv), { booleans: ["json"], values: ["cwd"] });
  const workspaceRoot = resolveWorkspaceRoot(resolveCwd(options));
  reconcileJobs(workspaceRoot);
  const summary = positionals[0]
    ? findJob(workspaceRoot, positionals[0])
    : jobsForSession(workspaceRoot).find((job) => !isActive(job));
  if (!summary) {
    throw new UserError(positionals[0] ? `No Grok job "${positionals[0]}" in this repository.` : "No finished Grok jobs yet.");
  }
  const job = loadJob(workspaceRoot, summary.id) ?? summary;
  if (options.json) writeJson(stripLarge(job));
  else write(renderStoredResult(job));
  return 0;
}

function cmdCancel(argv) {
  const { options, positionals } = parseArgs(normalizeArgv(argv), { booleans: ["json"], values: ["cwd"] });
  const workspaceRoot = resolveWorkspaceRoot(resolveCwd(options));
  reconcileJobs(workspaceRoot);
  const job = positionals[0]
    ? findJob(workspaceRoot, positionals[0])
    : jobsForSession(workspaceRoot).find(isActive);
  if (!job) {
    throw new UserError(positionals[0] ? `No Grok job "${positionals[0]}" in this repository.` : "No running Grok job to cancel.");
  }
  if (!isActive(job)) {
    write(`Grok job ${job.id} already ${job.status}; nothing to cancel.`);
    return 0;
  }
  const cancelled = cancelJob(workspaceRoot, job);
  if (options.json) writeJson({ jobId: cancelled.id, status: cancelled.status, previousStatus: job.status });
  else write(renderCancel(cancelled, job.status));
  return 0;
}

// ---- dispatch --------------------------------------------------------------

const COMMANDS = {
  setup: cmdSetup,
  task: cmdTask,
  "task-worker": cmdTaskWorker,
  "task-resume-candidate": cmdTaskResumeCandidate,
  review: (argv) => cmdReview(argv, "review"),
  "adversarial-review": (argv) => cmdReview(argv, "adversarial-review"),
  status: cmdStatus,
  result: cmdResult,
  cancel: cmdCancel
};

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  if (!sub || sub === "help" || sub === "--help") {
    write(USAGE);
    return sub ? 0 : 1;
  }
  const command = COMMANDS[sub];
  if (!command) {
    write(`Unknown subcommand "${sub}".\n\n${USAGE}`);
    return 1;
  }
  return command(rest);
}

main().then(
  (code) => {
    process.exitCode = code ?? 0;
  },
  (error) => {
    write(error instanceof UserError ? error.message : `grok-companion error: ${error?.stack ?? error}`);
    process.exitCode = 1;
  }
);
