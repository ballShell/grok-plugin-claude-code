// Drives the Grok CLI's headless mode: `grok --prompt-file <f> --output-format json`.
// Each run is a one-shot process that prints a single JSON object on stdout:
// `{ text, stopReason, sessionId, usage, modelUsage, ... }` on success or
// `{ type: "error", message }` on failure.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { resolveGrokHome } from "./grok-config.mjs";

export function resolveGrokBin(env = process.env) {
  if (env.GROK_BIN && fs.existsSync(env.GROK_BIN)) return env.GROK_BIN;
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, process.platform === "win32" ? "grok.exe" : "grok");
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Not in this PATH entry.
    }
  }
  const fallback = path.join(resolveGrokHome(env), "bin", "grok");
  return fs.existsSync(fallback) ? fallback : null;
}

export function grokVersion(bin) {
  if (!bin) return null;
  const result = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15000 });
  const out = `${result.stdout ?? ""}`.trim() || `${result.stderr ?? ""}`.trim();
  return result.status === 0 && out ? out.split("\n")[0] : null;
}

// mode: "read" → plan mode (no edits, no shell); "write" → auto-approve tools.
export function buildGrokArgs({
  promptFile,
  mode = "read",
  model = null,
  effort = null,
  resumeSessionId = null,
  worktree = null,
  maxTurns = null
}) {
  const args = ["--prompt-file", promptFile, "--output-format", "json"];
  if (mode === "write") args.push("--always-approve");
  else args.push("--permission-mode", "plan");
  if (model) args.push("--model", model);
  if (effort) args.push("--reasoning-effort", effort);
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  if (worktree) args.push(worktree === true ? "--worktree" : `--worktree=${worktree}`);
  if (maxTurns) args.push("--max-turns", String(maxTurns));
  return args;
}

export function parseGrokOutput(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Some builds print log noise before the JSON object; take the last one.
    const start = text.lastIndexOf("\n{");
    if (start !== -1) {
      try {
        return JSON.parse(text.slice(start + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Spawns grok in its own process group so cancel can stop it together with
// any tool subprocesses it started. Resolves once grok exits.
export function runGrok(bin, args, { cwd, logFile = null, onSpawn = null }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    const log = logFile ? fs.createWriteStream(logFile, { flags: "a" }) : null;

    const forward = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // Already gone.
      }
    };
    const onSigint = () => forward("SIGINT");
    const onSigterm = () => forward("SIGTERM");
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      log?.write(chunk);
    });
    child.on("spawn", () => onSpawn?.(child.pid));
    child.on("error", (error) => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      log?.end();
      resolve({ exitCode: 1, signal: null, stdout, stderr: `${stderr}${error.message}`, parsed: null });
    });
    child.on("close", (exitCode, signal) => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      log?.end();
      resolve({ exitCode, signal, stdout, stderr, parsed: parseGrokOutput(stdout) });
    });
  });
}

export function terminateProcessGroup(pid, signal = "SIGTERM") {
  if (!pid || !Number.isFinite(Number(pid))) return false;
  try {
    process.kill(-Number(pid), signal);
    return true;
  } catch {
    try {
      process.kill(Number(pid), signal);
      return true;
    } catch {
      return false;
    }
  }
}

export function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}
