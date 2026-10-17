// Reads the Grok CLI's own configuration (`$GROK_HOME/config.toml`, default
// `~/.grok/config.toml`) so the companion can report which model and API
// endpoint a delegated run will use, and whether credentials are present.
//
// The Grok CLI itself applies this config when it runs; the companion only
// inspects it. API key values are never returned — only where a credential
// comes from.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolveGrokHome(env = process.env) {
  return env.GROK_HOME ? path.resolve(env.GROK_HOME) : path.join(os.homedir(), ".grok");
}

// ---- minimal TOML ----------------------------------------------------------
// Covers the subset Grok configs use: tables, array-of-tables, dotted/quoted
// keys, basic/literal/multi-line strings, numbers, booleans, arrays and inline
// tables. Values it cannot parse are kept as raw strings rather than failing
// the whole file.

function parseKeyPath(src) {
  const keys = [];
  let i = 0;
  const s = src.trim();
  while (i < s.length) {
    while (s[i] === " " || s[i] === "\t") i++;
    let key = "";
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i++];
      while (i < s.length && s[i] !== q) {
        if (q === '"' && s[i] === "\\") i++;
        key += s[i++];
      }
      i++;
    } else {
      while (i < s.length && s[i] !== "." && s[i] !== " " && s[i] !== "\t") key += s[i++];
    }
    keys.push(key);
    while (s[i] === " " || s[i] === "\t") i++;
    if (s[i] === ".") i++;
  }
  return keys;
}

const ESCAPES = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };

class ValueParser {
  constructor(text, pos) {
    this.s = text;
    this.i = pos;
  }

  ws(newlines = false) {
    for (;;) {
      const ch = this.s[this.i];
      if (ch === " " || ch === "\t" || (newlines && (ch === "\n" || ch === "\r"))) {
        this.i++;
      } else if (newlines && ch === "#") {
        while (this.i < this.s.length && this.s[this.i] !== "\n") this.i++;
      } else {
        return;
      }
    }
  }

  value() {
    this.ws();
    const s = this.s;
    if (s.startsWith('"""', this.i)) return this.multiline('"""', true);
    if (s.startsWith("'''", this.i)) return this.multiline("'''", false);
    const ch = s[this.i];
    if (ch === '"') return this.basicString();
    if (ch === "'") return this.literalString();
    if (ch === "[") return this.array();
    if (ch === "{") return this.inlineTable();
    return this.bare();
  }

  basicString() {
    this.i++;
    let out = "";
    while (this.i < this.s.length && this.s[this.i] !== '"') {
      if (this.s[this.i] === "\\") {
        const next = this.s[this.i + 1];
        if (next === "u" || next === "U") {
          const len = next === "u" ? 4 : 8;
          out += String.fromCodePoint(parseInt(this.s.slice(this.i + 2, this.i + 2 + len), 16));
          this.i += 2 + len;
          continue;
        }
        out += ESCAPES[next] ?? next;
        this.i += 2;
        continue;
      }
      out += this.s[this.i++];
    }
    this.i++;
    return out;
  }

  literalString() {
    this.i++;
    const end = this.s.indexOf("'", this.i);
    const out = this.s.slice(this.i, end === -1 ? undefined : end);
    this.i = end === -1 ? this.s.length : end + 1;
    return out;
  }

  multiline(delim, escapes) {
    this.i += 3;
    if (this.s[this.i] === "\n") this.i++;
    else if (this.s.startsWith("\r\n", this.i)) this.i += 2;
    const end = this.s.indexOf(delim, this.i);
    let out = this.s.slice(this.i, end === -1 ? undefined : end);
    this.i = end === -1 ? this.s.length : end + 3;
    if (escapes) {
      out = out
        .replace(/\\\r?\n\s*/g, "")
        .replace(/\\([btnfr"\\])/g, (_, c) => ESCAPES[c]);
    }
    return out;
  }

  array() {
    this.i++;
    const out = [];
    for (;;) {
      this.ws(true);
      if (this.s[this.i] === "]") {
        this.i++;
        return out;
      }
      if (this.i >= this.s.length) return out;
      out.push(this.value());
      this.ws(true);
      if (this.s[this.i] === ",") this.i++;
    }
  }

  inlineTable() {
    this.i++;
    const out = {};
    for (;;) {
      this.ws();
      if (this.s[this.i] === "}") {
        this.i++;
        return out;
      }
      if (this.i >= this.s.length) return out;
      const eq = this.s.indexOf("=", this.i);
      if (eq === -1) return out;
      const keys = parseKeyPath(this.s.slice(this.i, eq));
      this.i = eq + 1;
      setPath(out, keys, this.value());
      this.ws();
      if (this.s[this.i] === ",") this.i++;
    }
  }

  bare() {
    const start = this.i;
    while (this.i < this.s.length && !/[,\]}\n\r#]/.test(this.s[this.i])) this.i++;
    const raw = this.s.slice(start, this.i).trim();
    if (raw === "true") return true;
    if (raw === "false") return false;
    const num = raw.replace(/_/g, "");
    if (/^[+-]?(\d+|0x[0-9a-f]+|0o[0-7]+|0b[01]+)$/i.test(num)) return Number(num);
    if (/^[+-]?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(num)) return Number(num);
    return raw;
  }
}

function setPath(target, keys, value) {
  let node = target;
  for (const key of keys.slice(0, -1)) {
    if (node[key] == null || typeof node[key] !== "object") node[key] = {};
    node = Array.isArray(node[key]) ? node[key][node[key].length - 1] : node[key];
  }
  node[keys[keys.length - 1]] = value;
}

function ensureTable(root, keys, arrayTable) {
  let node = root;
  keys.forEach((key, idx) => {
    const last = idx === keys.length - 1;
    if (last && arrayTable) {
      if (!Array.isArray(node[key])) node[key] = [];
      node[key].push({});
      node = node[key][node[key].length - 1];
      return;
    }
    if (node[key] == null || typeof node[key] !== "object") node[key] = {};
    node = Array.isArray(node[key]) ? node[key][node[key].length - 1] : node[key];
  });
  return node;
}

export function parseToml(text) {
  const root = {};
  let current = root;
  let i = 0;
  const s = text.replace(/^\uFEFF/, "");
  while (i < s.length) {
    // Skip blank space and comments between statements.
    while (i < s.length && /[\s]/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] === "#") {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (s[i] === "[") {
      const arrayTable = s[i + 1] === "[";
      const close = s.indexOf(arrayTable ? "]]" : "]", i);
      const header = s.slice(i + (arrayTable ? 2 : 1), close);
      current = ensureTable(root, parseKeyPath(header), arrayTable);
      i = close + (arrayTable ? 2 : 1);
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    const eq = s.indexOf("=", i);
    const nl = s.indexOf("\n", i);
    if (eq === -1 || (nl !== -1 && nl < eq)) {
      // Not a key/value line; skip it.
      i = nl === -1 ? s.length : nl + 1;
      continue;
    }
    const keys = parseKeyPath(s.slice(i, eq));
    const parser = new ValueParser(s, eq + 1);
    setPath(current, keys, parser.value());
    i = parser.i;
    while (i < s.length && s[i] !== "\n") i++;
  }
  return root;
}

// ---- Grok config view ------------------------------------------------------

function firstSetEnv(envKey, env) {
  const names = Array.isArray(envKey) ? envKey : envKey ? [envKey] : [];
  for (const name of names) {
    if (typeof name === "string" && env[name]) return name;
  }
  return names.length ? null : undefined;
}

function describeEndpoint(baseUrl) {
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return String(baseUrl);
  }
}

function modelCredential(entry, env) {
  if (typeof entry.api_key === "string" && entry.api_key.trim()) {
    return { source: "config api_key", present: true };
  }
  const envName = firstSetEnv(entry.env_key, env);
  if (envName) return { source: `env ${envName}`, present: true };
  if (envName === null) {
    const names = Array.isArray(entry.env_key) ? entry.env_key.join(", ") : entry.env_key;
    return { source: `env ${names} (unset)`, present: false };
  }
  if (entry.auth_provider) return { source: `auth_provider ${entry.auth_provider}`, present: true };
  return { source: null, present: false };
}

export function readGrokConfig({ env = process.env } = {}) {
  const home = resolveGrokHome(env);
  const configPath = path.join(home, "config.toml");
  const result = {
    home,
    path: configPath,
    exists: false,
    error: null,
    defaultModel: null,
    models: []
  };
  if (!fs.existsSync(configPath)) return result;
  result.exists = true;

  let data;
  try {
    data = parseToml(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }

  result.defaultModel =
    typeof data.models?.default === "string" && data.models.default.trim()
      ? data.models.default.trim()
      : null;

  const table = data.model && typeof data.model === "object" ? data.model : {};
  for (const [id, entry] of Object.entries(table)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    result.models.push({
      id,
      apiModel: typeof entry.model === "string" ? entry.model : id,
      name: typeof entry.name === "string" ? entry.name : null,
      endpoint: describeEndpoint(entry.base_url),
      apiBackend: typeof entry.api_backend === "string" ? entry.api_backend : null,
      credential: modelCredential(entry, env)
    });
  }
  return result;
}

export function findConfiguredModel(config, id) {
  if (!id) return null;
  return config.models.find((model) => model.id === id) ?? null;
}

// Mirrors the Grok CLI's credential order for a model: the model's own
// api_key / env_key / auth_provider, then the `grok login` session, then
// XAI_API_KEY.
export function resolveAuthStatus({ env = process.env, model = null } = {}) {
  const config = readGrokConfig({ env });
  const effectiveModel = model || config.defaultModel;
  const entry = findConfiguredModel(config, effectiveModel);

  const authPath = path.join(config.home, "auth.json");
  let session = false;
  try {
    session = fs.existsSync(authPath) && fs.statSync(authPath).size > 0;
  } catch {
    session = false;
  }

  let source = null;
  if (entry?.credential.present) source = entry.credential.source;
  else if (session) source = "grok login session";
  else if (env.XAI_API_KEY) source = "env XAI_API_KEY";

  return {
    loggedIn: Boolean(source),
    source,
    session,
    authPath: session ? authPath : null,
    model: effectiveModel,
    modelEntry: entry,
    config
  };
}
