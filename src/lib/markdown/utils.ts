import type { CodeLanguage } from './types';

/**
 * Detect the appropriate code language based on the URL slug
 */
export function detectLanguage(slug: string): CodeLanguage {
  if (slug === 'api' || slug.startsWith('api/')) return 'python';
  if (slug === 'hapi' || slug.startsWith('hapi/')) return 'python';
  if (slug.includes('hom/') || slug.includes('python/') || slug.endsWith('model/verbs')) return 'python';
  if (slug.includes('hscript/')) return 'hscript';
  if (slug.startsWith('hengine/') || slug.startsWith('hdk/')) return 'cpp';
  if (slug.includes('expressions/')) return 'hscript';
  return 'vex';
}

export function normalizeIconLinks(markdown: string): string {
  return markdown
    // SideFX can emit a section icon beside a link that already has a page
    // icon. Keep the page icon inside the link.
    .replace(
      /!\[[^\]]*\]\([^)\s]*\/icons\/[^)\s]+\)\s*\[!\[([^\]]*)\]\(([^)\s]*\/icons\/[^)\s]+)\)\s*([^\]]*)\]\(([^)\s]+)\)/g,
      '[![$1]($2)$3]($4)',
    )
    // Other SideFX templates put the only icon beside the link. Move it into
    // the link so every page icon has the same clickable structure.
    .replace(
      /!\[([^\]]*)\]\(([^)\s]*\/icons\/[^)\s]+)\)\s*\[(?!\!)([^\]]+)\]\(([^)\s]+)\)/g,
      '[![$1]($2)$3]($4)',
    );
}

export function addSeeAlsoIcons(
  markdown: string,
  iconByPath: ReadonlyMap<string, string>,
): string {
  const heading = markdown.match(/^## See Also\s*$/m);
  if (heading?.index === undefined) return markdown;

  const sectionStart = heading.index + heading[0].length;
  const rest = markdown.slice(sectionStart);
  const nextHeading = rest.match(/^## /m);
  const sectionEnd = nextHeading?.index ?? rest.length;
  const section = rest.slice(0, sectionEnd).replace(
    /(?<!!)\[([^\]]+)\]\(\/docs\/([^\s)#?]+)([^)]*)\)/g,
    (link, text: string, path: string, suffix: string) => {
      const icon = iconByPath.get(path);
      return icon ? `[![](${icon})${text}](/docs/${path}${suffix})` : link;
    },
  );

  return markdown.slice(0, sectionStart) + section + rest.slice(sectionEnd);
}

/**
 * Clean up generated markdown
 */
export function cleanMarkdown(markdown: string): string {
  const code: string[] = [];
  const stashCode = (value: string) => `\u0000CODE${code.push(value) - 1}\u0000`;
  // Fences are variable length (a sample showing markdown needs a longer
  // fence), so the stash must pair equal-length runs, not assume three.
  const withoutCode = normalizeIconLinks(markdown)
    .replace(/(`{3,})[\s\S]*?\1/g, stashCode)
    .replace(/(`+)([^\n]*?)\1/g, stashCode);

  return withoutCode
    .replace(/\n{3,}/g, '\n\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/‹([^›]+)›/g, '*$1*')
    .replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)] || '')
    .trim();
}
