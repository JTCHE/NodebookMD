import {
  parseSignature,
  isArgumentLabel,
  indexArguments,
  returnTypes,
  tokenize,
  type VexSignature,
  type VexArgument,
} from './vex-signature';

// Minimal structural types — @types/mdast isn't a dependency, and we only touch
// a few well-known node shapes. Mirrors remark-callouts.ts.
interface MdNode {
  type: string;
  value?: string;
  lang?: string | null;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

/* ── node builders ──────────────────────────────────────────────────────── */

/** Container rendered as a <div>. Custom types fall to to-hast's `unknown`
 *  handler, which emits a div and then applies `hName`/`hProperties`. */
const box = (type: string, className: string, children: MdNode[]): MdNode => ({
  type,
  data: { hName: 'div', hProperties: { className } },
  children,
});

const span = (className: string, value: string): MdNode => ({
  type: 'vexToken',
  data: { hName: 'span', hProperties: { className } },
  children: [{ type: 'text', value }],
});

const label = (text: string, className: string): MdNode => ({
  type: 'vexLabel',
  data: { hName: 'p', hProperties: { className } },
  children: [{ type: 'text', value: text }],
});

/* ── block predicates ───────────────────────────────────────────────────── */

/** The inline-code value when a paragraph holds exactly one code span. */
function loneCode(node: MdNode | undefined): string | null {
  if (!node || node.type !== 'paragraph' || node.children?.length !== 1) return null;
  const only = node.children[0];
  return only.type === 'inlineCode' && typeof only.value === 'string' ? only.value : null;
}

/** The signature a block holds: a lone code span, or the one-line `vex`
 *  fence the app's parser writes for `:usage:`. */
function signatureOf(node: MdNode | undefined): VexSignature | null {
  const fenced =
    node?.type === 'code' && node.lang === 'vex' && !node.value?.includes('\n') ? node.value : null;
  const text = loneCode(node) ?? fenced;
  return text ? parseSignature(text) : null;
}

function textOf(node: MdNode | undefined): string {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(textOf).join('');
}

const isParagraph = (n: MdNode | undefined) => n?.type === 'paragraph';
const isHeading = (n: MdNode | undefined) => n?.type === 'heading' || n?.type === 'html';
const isText = (n: MdNode | undefined, s: string) =>
  isParagraph(n) && textOf(n).trim().toLowerCase() === s;

/**
 * A paragraph holding nothing but a link is how a suite page (vex/attrib_suite)
 * titles each function it documents. It ends the previous function's section.
 */
const isFunctionTitle = (n: MdNode | undefined) =>
  n?.type === 'paragraph' && n.children?.length === 1 && n.children[0].type === 'link';

/**
 * A caption belongs to the overload group above it: ordinary prose, not another
 * code span, and not one of the section markers.
 */
function isCaption(n: MdNode | undefined): boolean {
  if (!isParagraph(n) || isHeading(n)) return false;
  if (loneCode(n) !== null) return false;
  const t = textOf(n).trim().toLowerCase();
  return t.length > 0 && t !== 'returns' && t !== 'show/hide arguments';
}

/* ── the plugin ─────────────────────────────────────────────────────────── */

/**
 * remark plugin: rebuild a VEX function page as an API surface — a signature
 * panel, a typed argument table, and a return statement — instead of a flat run
 * of paragraphs where every code token looks alike.
 *
 * Scoped by slug rather than by content sniffing. Only pages under
 * `vex/functions/` are touched, so the other ~9,600 documentation pages take
 * the untouched path regardless of what their markdown happens to contain.
 *
 * Nothing is rewritten in the stored markdown: this is presentation only, and
 * the `.md` that agents fetch is byte-identical to before.
 */
export function remarkVex({ enabled }: { enabled: boolean }) {
  return (tree: MdNode) => {
    if (!enabled || !tree.children) return;

    const blocks = tree.children;
    const out: MdNode[] = [];
    let i = 0;

    // Signatures of the block most recently emitted. Scoped per block, not per
    // page: a suite page such as vex/attrib_suite documents nine functions in
    // sequence, so a page-wide index would give one function's arguments
    // another's types, and merge all nine return types into one union.
    let current: VexSignature[] = [];
    let argIndex = indexArguments(current);

    while (i < blocks.length) {
      const code = loneCode(blocks[i]);
      const sig = signatureOf(blocks[i]);

      // ── signature: consecutive overloads, each run optionally captioned ──
      if (sig) {
        const groups: MdNode[] = [];
        current = [];
        while (i < blocks.length) {
          const rows: MdNode[] = [];
          for (;;) {
            const s = signatureOf(blocks[i]);
            if (!s) break;
            current.push(s);
            rows.push(
              box('vexRow', 'vex-signature-row', tokenize(s).map((t) => span(`vex-token-${t.kind}`, t.text)))
            );
            i++;
          }
          if (!rows.length) break;

          // Only the rows scroll, in their own box: the scroll bar sits under
          // the code, and the caption stays still.
          // A captioned group becomes its own card so the caption cannot be
          // read as belonging to a neighbouring overload.
          if (isCaption(blocks[i])) {
            const caption = blocks[i];
            (caption.data ??= {}).hName = 'div';
            caption.data.hProperties = { ...caption.data.hProperties, className: 'vex-signature-caption' };
            i++;
            groups.push(box('vexGroup', 'vex-signature-card code-panel', [box('vexRows', 'vex-signature-rows', rows), caption]));
          } else {
            groups.push(box('vexGroup', 'vex-signature-card code-panel', [box('vexRows', 'vex-signature-rows', rows)]));
          }
        }
        argIndex = indexArguments(current);
        out.push(box('vexSig', 'vex-signature', groups));
        continue;
      }

      // ── the collapsible's leftover label carries no information here ──
      if (isText(blocks[i], 'show/hide arguments')) {
        i++;
        continue;
      }

      // ── arguments: runs of "label paragraph, then its description" ──
      const asLabel = code && isArgumentLabel(code) ? code : null;
      if (asLabel) {
        const rows: { type: string | null; name: string; desc: MdNode[] }[] = [];

        while (i < blocks.length) {
          const c = loneCode(blocks[i]);
          if (!c || !isArgumentLabel(c) || parseSignature(c)) break;
          i++;

          const desc: MdNode[] = [];
          while (i < blocks.length) {
            const next = blocks[i];
            const nc = loneCode(next);
            // Stop at the next argument, at Returns, at a heading — and on a
            // suite page, at the next function's signature or title. Without
            // those last two the description swallows the following function
            // whole, and its Returns then reports the wrong type.
            if (
              (nc && isArgumentLabel(nc)) ||
              signatureOf(next) ||
              isText(next, 'returns') ||
              isHeading(next) ||
              isFunctionTitle(next)
            ) break;
            desc.push(next);
            i++;
          }

          // The label is sometimes the placeholder (`<geometry>`) rather than
          // the name; prefer the signature's own name when we matched.
          const bare = c.replace(/^&|[<>]/g, '');
          const arg: VexArgument | undefined = argIndex.get(c) ?? argIndex.get(bare);
          rows.push({ type: arg?.type ?? null, name: arg?.name ?? c.replace(/[<>]/g, ''), desc });
        }

        if (rows.length) {
          // Deprecated stubs publish no signature, so there are no types to
          // show. Drop the column rather than pad it with placeholders.
          const typed = rows.some((row) => row.type);
          const cells: MdNode[] = [
            box('vexArgHead', 'vex-argument-signature vex-arguments-head', [
              ...(typed ? [span('', 'Type')] : []),
              span('', 'Name'),
            ]),
            box('vexArgHead', 'vex-argument-description vex-arguments-head', [span('', 'Description')]),
          ];
          for (const row of rows) {
            const sigCell: MdNode[] = [];
            // A type the signature does not state is drawn as missing, so the
            // name never slides into the type column.
            if (typed) sigCell.push(span('vex-argument-type', row.type ?? '—'));
            sigCell.push(
              row.name.startsWith('&')
                ? box('vexName', 'vex-argument-name', [span('vex-argument-ampersand', '&'), span('vex-argument-id', row.name.slice(1))])
                : span('vex-argument-name', row.name)
            );
            cells.push(box('vexArgSig', 'vex-argument-signature', sigCell));
            cells.push(box('vexArgDesc', 'vex-argument-description', row.desc));
          }
          out.push({ type: 'heading', depth: 2, children: [{ type: 'text', value: 'Arguments' }] } as MdNode);
          out.push(box('vexArgs', typed ? 'vex-arguments' : 'vex-arguments vex-arguments-untyped', cells));
        }
        continue;
      }

      // ── returns: the marker plus the single paragraph that follows ──
      if (isText(blocks[i], 'returns') && current.length) {
        i++;
        const desc: MdNode[] = [];
        if (isParagraph(blocks[i]) && !loneCode(blocks[i])) {
          desc.push(blocks[i]);
          i++;
        }
        out.push(label('Returns', 'vex-section-label vex-section-label-returns'));
        out.push(
          box('vexReturns', 'vex-returns', [
            box('vexRetSig', 'vex-return-signature', [
              span('vex-return-arrow', '→'),
              span('vex-return-type', returnTypes(current).join('|')),
            ]),
            box('vexRetDesc', 'vex-return-description', desc),
          ])
        );
        continue;
      }

      out.push(blocks[i]);
      i++;
    }

    tree.children = out;
  };
}
