// Argument parsing shared by the companion subcommands.
//
// Slash commands pass `"$ARGUMENTS"` as one quoted string, so a single argv
// entry is re-split with shell-like quoting before flag parsing.

export function splitRawArgumentString(raw) {
  const tokens = [];
  let current = "";
  let quote = null;
  let hasToken = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && quote === '"' && i + 1 < raw.length) {
        current += raw[++i];
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
    } else if (ch === "\\" && i + 1 < raw.length) {
      current += raw[++i];
      hasToken = true;
    } else {
      current += ch;
      hasToken = true;
    }
  }
  if (hasToken) tokens.push(current);
  return tokens;
}

export function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) return [];
    return splitRawArgumentString(raw);
  }
  return argv;
}

// spec: { values: [...flags taking a value], booleans: [...], aliases: {...} }
// Flag names are given without the leading `--`. A boolean flag written as
// `--flag=value` stores the string value instead of `true`.
// Returns { options, positionals }. Everything after `--` is positional.
export function parseArgs(argv, spec = {}) {
  const values = new Set(spec.values ?? []);
  const booleans = new Set(spec.booleans ?? []);
  const aliases = spec.aliases ?? {};
  const options = {};
  const positionals = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }

    let name = token.replace(/^--?/, "");
    let inline = null;
    const eq = name.indexOf("=");
    if (eq !== -1) {
      inline = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    name = aliases[name] ?? name;

    if (values.has(name)) {
      const value = inline ?? argv[++i];
      if (value == null) throw new Error(`Missing value for --${name}.`);
      options[name] = value;
    } else if (booleans.has(name)) {
      options[name] = inline ?? true;
    } else {
      // Unknown flags stay in the task/focus text untouched.
      positionals.push(token);
    }
  }
  return { options, positionals };
}
