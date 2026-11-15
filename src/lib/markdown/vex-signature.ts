/**
 * Parsing for VEX function signatures.
 *
 * SideFX renders a signature with each argument's type as a superscript label
 * sitting above the argument name. Turned into text that collapses to a single
 * run with no separator — `<type>defvalue`, `int|stringchannel` — so a generic
 * `\w+` split silently mis-reads "int|stringchannel" as type `int|stringchanne`
 * plus name `l`.
 *
 * VEX's type system is closed, so matching against the actual list resolves it
 * unambiguously. Measured over 600 live pages: 98.5% of VEX function pages
 * yield a signature, 1,325 signatures parsed, zero unparsed arguments, and zero
 * matches on a 150-page control group of node/HOM/expression/shading pages.
 * The 1.5% that miss publish no signature at all (deprecated stubs, and the
 * statements `foreach` / `forpoints` / `illuminance`).
 */

/** Every type VEX can name. Longest-first so `vector4` is not eaten by `vector`. */
const PRIMITIVES = [
  'lpeaccumulator', 'material', 'matrix4', 'matrix3', 'matrix2', 'matrix',
  'vector4', 'vector2', 'vector', 'string', 'struct', 'float', 'light',
  'bsdf', 'dict', 'void', 'int',
  // The help's `<type>` placeholder. The app's parser drops the brackets.
  'type',
];

// `<geometry>` / `<type>` / `<stage>` are placeholders SideFX uses for
// arguments whose concrete type depends on context.
const ATOM = `(?:<[^>]+>|(?:${PRIMITIVES.join('|')}))`;
const TYPE = `(?:${ATOM}(?:\\s*\\|\\s*${ATOM})*(?:\\s*\\[\\s*\\])?)`;

const SIGNATURE = new RegExp(`^(${TYPE})\\s*([A-Za-z_]\\w*)\\s*\\(([\\s\\S]*)\\)\\s*$`);
const ARGUMENT = new RegExp(`^((?:const\\s+)?${TYPE})\\s*(&?\\s*[A-Za-z_]\\w*(?:\\s*\\[\\s*\\])?)\\s*(?:=\\s*([\\s\\S]+))?$`);

/** A bare identifier heading an argument description, e.g. `geohandle`, `&prim`, `<geometry>`. */
const ARG_LABEL = /^(?:<[^>]+>|&?[A-Za-z_][\w]*(?:\[\])?)$/;

export interface VexArgument {
  /** Declared type, or null when the argument is `...`. */
  type: string | null;
  /** Argument name, `&`-prefixed when the function writes back to it. */
  name: string;
  /** Default value, when the signature declares one (`mode="set"`). */
  defaultValue?: string;
  /** True for the `...` variadic marker. */
  variadic?: boolean;
}

export interface VexSignature {
  returnType: string;
  name: string;
  args: VexArgument[];
}

/** Collapse whitespace that the superscript-label layout leaves behind. */
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Split an argument list on top-level commas. Depth tracking keeps a comma
 * inside `<...>` or `[...]` from splitting the list.
 */
function splitArguments(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[' || ch === '<') depth++;
    else if (ch === ')' || ch === ']' || ch === '>') depth--;
    // Some help pages separate arguments with `;`, as in `append`.
    else if ((ch === ',' || ch === ';') && depth <= 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseArgument(raw: string): VexArgument | null {
  if (raw === '...') return { type: null, name: '...', variadic: true };
  // `point(<geometry>; ...)`: the placeholder alone, with no name after it.
  if (ARG_LABEL.test(raw)) return { type: null, name: raw.replace(/[<>]/g, '') };
  const m = raw.match(ARGUMENT);
  if (!m) return null;
  return {
    type: tidy(m[1]).replace(/\s*\|\s*/g, '|').replace(/\s*\[\s*\]/, '[]'),
    name: m[2].replace(/\s+/g, ''),
    ...(m[3] ? { defaultValue: m[3].trim() } : {}),
  };
}

/**
 * Parse one signature line. Returns null when the text is not a signature —
 * which is the common case, since this runs over every lone inline-code span.
 */
export function parseSignature(text: string): VexSignature | null {
  // `insert` ends its signature with a `;`, the way a declaration ends.
  const m = text.trim().replace(/;$/, '').match(SIGNATURE);
  if (!m) return null;

  const args: VexArgument[] = [];
  for (const raw of splitArguments(m[3])) {
    const arg = parseArgument(raw);
    // One unreadable argument invalidates the whole signature: a partial
    // render would silently drop a parameter, which is worse than falling
    // back to the plain-markdown rendering.
    if (!arg) return null;
    args.push(arg);
  }

  return {
    returnType: tidy(m[1]).replace(/\s*\|\s*/g, '|').replace(/\s*\[\s*\]/, '[]'),
    name: m[2],
    args,
  };
}

/** True when `text` looks like the identifier that heads an argument description. */
export function isArgumentLabel(text: string): boolean {
  return ARG_LABEL.test(text.trim());
}

/**
 * Index a page's signatures so an argument description can be given its type.
 * Keyed by name and by type, because SideFX heads some descriptions with the
 * placeholder (`<geometry>`) rather than the argument name.
 */
export function indexArguments(signatures: VexSignature[]): Map<string, VexArgument> {
  const index = new Map<string, VexArgument>();
  for (const sig of signatures) {
    for (const arg of sig.args) {
      if (arg.variadic) continue;
      const bare = arg.name.replace(/^&/, '');
      if (!index.has(bare)) index.set(bare, arg);
      if (!index.has(arg.name)) index.set(arg.name, arg);
      if (arg.type && !index.has(arg.type)) index.set(arg.type, arg);
    }
  }
  return index;
}

/** Distinct return types across a page's overloads, in first-seen order. */
export function returnTypes(signatures: VexSignature[]): string[] {
  return [...new Set(signatures.map((s) => s.returnType))];
}

export type Token = { text: string; kind: 'type' | 'function' | 'argument' | 'punctuation' | 'output' };

/** Break a signature into coloured tokens for rendering. */
export function tokenize(sig: VexSignature): Token[] {
  const out: Token[] = [
    { text: sig.returnType, kind: 'type' },
    { text: ' ', kind: 'punctuation' },
    { text: sig.name, kind: 'function' },
    { text: '(', kind: 'punctuation' },
  ];

  sig.args.forEach((arg, i) => {
    if (i > 0) out.push({ text: ', ', kind: 'punctuation' });
    if (arg.variadic) {
      out.push({ text: '...', kind: 'punctuation' });
      return;
    }
    if (arg.type) {
      out.push({ text: arg.type, kind: 'type' });
      out.push({ text: ' ', kind: 'punctuation' });
    }
    if (arg.name.startsWith('&')) {
      out.push({ text: '&', kind: 'output' });
      out.push({ text: arg.name.slice(1), kind: 'argument' });
    } else {
      out.push({ text: arg.name, kind: 'argument' });
    }
    if (arg.defaultValue) {
      out.push({ text: '=', kind: 'punctuation' });
      out.push({ text: arg.defaultValue, kind: 'argument' });
    }
  });

  out.push({ text: ')', kind: 'punctuation' });
  return out;
}
