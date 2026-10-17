// Text rendering for companion output shown to the user.

function line(label, value) {
  return value == null || value === "" ? null : `${label}: ${value}`;
}

function compact(lines) {
  return lines.filter((l) => l != null).join("\n");
}

function formatDuration(job) {
  const start = Date.parse(job.startedAt ?? job.createdAt ?? "");
  const end = job.completedAt ? Date.parse(job.completedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}

function formatCost(job) {
  return typeof job.costUsd === "number" ? `$${job.costUsd.toFixed(4)}` : null;
}

function modeLabel(mode) {
  return mode === "write" ? "write (auto-approve)" : "read-only (plan)";
}

export function renderSetup(report) {
  const out = [];
  out.push("# Grok setup");
  out.push("");
  out.push(`grok binary:    ${report.binary ?? "NOT FOUND"}`);
  out.push(`grok version:   ${report.version ?? "unknown"}`);
  out.push(`config file:    ${report.config.path}${report.config.exists ? "" : " (not found)"}`);
  if (report.config.error) out.push(`config error:   ${report.config.error}`);
  out.push(`default model:  ${report.config.defaultModel ?? "(grok built-in default)"}`);
  if (report.config.models.length) {
    out.push("configured models:");
    for (const model of report.config.models) {
      const marker = model.id === report.config.defaultModel ? "*" : "-";
      const details = [
        model.apiModel !== model.id ? `model=${model.apiModel}` : null,
        model.endpoint ? `endpoint=${model.endpoint}` : null,
        model.apiBackend ? `backend=${model.apiBackend}` : null,
        `credential=${model.credential.source ?? "inherits session / XAI_API_KEY"}`
      ].filter(Boolean);
      out.push(`  ${marker} ${model.id}${model.name ? ` (${model.name})` : ""}  ${details.join("  ")}`);
    }
  }
  if (report.projectConfig) out.push(`project config: ${report.projectConfig} (overrides user config here)`);
  out.push(`authenticated:  ${report.auth.loggedIn ? `yes (${report.auth.source})` : "no"}`);
  out.push(`review gate:    ${report.reviewGate ? "enabled" : "disabled"}`);
  out.push("");
  out.push(report.ready ? "Grok is ready. /grok:rescue, /grok:review and the grok-rescue subagent can be used." : "Grok is NOT ready.");
  if (report.nextSteps.length) {
    out.push("");
    out.push("Next steps:");
    for (const step of report.nextSteps) out.push(`- ${step}`);
  }
  if (report.actions.length) {
    out.push("");
    for (const action of report.actions) out.push(action);
  }
  return `${out.join("\n")}\n`;
}

export function renderTaskResult(job) {
  const header = compact([
    `# Grok task ${job.status}`,
    "",
    line("job", job.id),
    line("mode", modeLabel(job.mode)),
    line("model", job.model ?? "config default"),
    line("effort", job.effort),
    line("grok session", job.grokSessionId),
    line("duration", formatDuration(job)),
    line("cost", formatCost(job))
  ]);
  const body =
    job.status === "completed"
      ? job.text?.trim() || "(Grok returned no text.)"
      : `Grok did not finish: ${job.errorMessage ?? "unknown error"}${modelHint(job)}`;
  const footer = job.grokSessionId
    ? [
        "",
        "---",
        "Continue this thread: /grok:rescue --resume <follow-up instructions>",
        `From a terminal: grok --resume ${job.grokSessionId}`
      ]
    : [];
  return `${header}\n\n${body}\n${footer.join("\n")}${footer.length ? "\n" : ""}`;
}

export function renderReviewResult(job) {
  const header = compact([
    `# Grok ${job.kind === "adversarial-review" ? "adversarial review" : "review"} ${job.status}`,
    "",
    line("job", job.id),
    line("target", job.request?.targetLabel),
    line("model", job.model ?? "config default"),
    line("duration", formatDuration(job)),
    line("cost", formatCost(job)),
    job.request?.truncated ? "note: the diff was truncated for length; coverage is partial." : null
  ]);
  const body =
    job.status === "completed"
      ? job.text?.trim() || "(Grok returned no review text.)"
      : `Grok review did not finish: ${job.errorMessage ?? "unknown error"}${modelHint(job)}`;
  return `${header}\n\n${body}\n`;
}

function modelHint(job) {
  return /model/i.test(job.errorMessage ?? "")
    ? "\nCheck the models defined in ~/.grok/config.toml (`/grok:setup`) or run `grok models`."
    : "";
}

export function renderStatus(jobs, { reviewGate, scopeLabel }) {
  const out = [`# Grok jobs (${scopeLabel})`, ""];
  if (!jobs.length) {
    out.push("No Grok jobs yet.");
  } else {
    out.push("| job | kind | status | mode | elapsed | summary |");
    out.push("| --- | --- | --- | --- | --- | --- |");
    for (const job of jobs) {
      const summary = String(job.summary ?? "").replace(/\|/g, "\\|");
      out.push(
        `| ${job.id} | ${job.kind}${job.background ? " (bg)" : ""} | ${job.status} | ${job.mode ?? ""} | ${formatDuration(job)} | ${summary} |`
      );
    }
    const active = jobs.find((job) => job.status === "queued" || job.status === "running");
    out.push("");
    if (active) out.push(`Running: ${active.id}. Cancel with /grok:cancel ${active.id}.`);
    const done = jobs.find((job) => job.status === "completed" || job.status === "failed");
    if (done) out.push(`Latest output: /grok:result ${done.id}`);
  }
  out.push(`Review gate: ${reviewGate ? "enabled" : "disabled"}`);
  return `${out.join("\n")}\n`;
}

export function renderJobDetail(job) {
  const out = [
    compact([
      `# Grok job ${job.id}`,
      "",
      line("kind", job.kind),
      line("status", job.status),
      line("phase", job.phase),
      line("mode", job.mode ? modeLabel(job.mode) : null),
      line("model", job.model ?? "config default"),
      line("summary", job.summary),
      line("grok session", job.grokSessionId),
      line("started", job.startedAt),
      line("completed", job.completedAt),
      line("elapsed", formatDuration(job)),
      line("error", job.status === "failed" ? job.errorMessage : null),
      line("log", job.logFile)
    ])
  ];
  if (job.status === "queued" || job.status === "running") {
    out.push("", `Cancel with /grok:cancel ${job.id}.`);
  } else {
    out.push("", `Full output: /grok:result ${job.id}`);
  }
  return `${out.join("\n")}\n`;
}

export function renderStoredResult(job) {
  if (job.status === "queued" || job.status === "running") {
    return `Grok job ${job.id} is still ${job.status}. Check /grok:status ${job.id}.\n`;
  }
  if (job.rendered) return job.rendered.endsWith("\n") ? job.rendered : `${job.rendered}\n`;
  return renderJobDetail(job);
}

export function renderCancel(job, previousStatus) {
  return `Cancelled Grok job ${job.id} (was ${previousStatus}).\n`;
}
