export type MarkdownInline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'emphasis'; children: MarkdownInline[] }
  | { type: 'strike'; children: MarkdownInline[] }
  | { type: 'link'; url: string; children: MarkdownInline[] };

export type MarkdownBlock =
  | { type: 'paragraph' | 'quote'; lines: MarkdownInline[][] }
  | { type: 'heading'; level: number; content: MarkdownInline[] }
  | { type: 'list'; ordered: boolean; start: number; items: MarkdownInline[][] }
  | { type: 'code'; text: string; language: string }
  | { type: 'rule' };

/** Match the Web renderer's fail-closed cases before interpreting formatting. */
export function prepareWorkspaceMarkdown(source: string) {
  const normalized = source.replace(/\r\n?/g, '\n');
  if (hasUnclosedFence(normalized) || containsUnsupportedMarkdown(normalized) || normalized.split('\n').some(line => /^ {4}/.test(line))) {
    return { source: normalized, plain: true };
  }
  return { source: normalized, plain: false };
}

function hasUnclosedFence(source: string) {
  let fence = '';
  for (const line of source.split('\n')) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!match) continue;
    if (!fence) fence = match[1]!;
    else if (isClosingFence(line, fence)) fence = '';
  }
  return Boolean(fence);
}

function containsUnsupportedMarkdown(source: string) {
  return /<\/?[A-Za-z][^>]*>/.test(source) ||
    /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/m.test(source);
}

export function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
}

const fencePattern = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const rulePattern = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const headingPattern = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const quotePattern = /^ {0,3}> ?(.*)$/;
const listPattern = /^ {0,3}([-+*]|\d+[.)])[ \t]+(.*)$/;

function isClosingFence(line: string, marker: string) {
  return new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`).test(line);
}

export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) { index += 1; continue; }
    const fence = line.match(fencePattern);
    if (fence) {
      const body: string[] = [];
      const marker = fence[1]!;
      const language = fence[2]!.trim().split(/\s+/)[0] ?? '';
      index += 1;
      while (index < lines.length && !isClosingFence(lines[index]!, marker)) {
        body.push(lines[index]!);
        index += 1;
      }
      index += 1;
      blocks.push({ type: 'code', text: body.join('\n'), language });
      continue;
    }
    if (rulePattern.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }
    const heading = line.match(headingPattern);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1]!.length, content: parseMarkdownInline(heading[2]!) });
      index += 1;
      continue;
    }
    if (quotePattern.test(line)) {
      const quoted: MarkdownInline[][] = [];
      while (index < lines.length) {
        const match = lines[index]!.match(quotePattern);
        if (!match) break;
        quoted.push(parseMarkdownInline(match[1]!));
        index += 1;
      }
      blocks.push({ type: 'quote', lines: quoted });
      continue;
    }
    const firstItem = line.match(listPattern);
    if (firstItem) {
      const ordered = /^\d/.test(firstItem[1]!);
      const items: MarkdownInline[][] = [];
      const start = ordered ? Number.parseInt(firstItem[1]!, 10) : 1;
      while (index < lines.length) {
        const match = lines[index]!.match(listPattern);
        if (!match || /^\d/.test(match[1]!) !== ordered) break;
        items.push(parseMarkdownInline(match[2]!));
        index += 1;
      }
      blocks.push({ type: 'list', ordered, start, items });
      continue;
    }
    const paragraph: MarkdownInline[][] = [];
    while (index < lines.length && lines[index]!.trim() && (index === 0 || !startsBlock(lines[index]!))) {
      paragraph.push(parseMarkdownInline(lines[index]!));
      index += 1;
    }
    if (paragraph.length) blocks.push({ type: 'paragraph', lines: paragraph });
  }
  return blocks;
}

function startsBlock(line: string) {
  return fencePattern.test(line) || rulePattern.test(line) || headingPattern.test(line) || quotePattern.test(line) || listPattern.test(line);
}

const urlPattern = /^https?:\/\/[^\s<>]+/i;

export function parseMarkdownInline(source: string): MarkdownInline[] {
  const output: MarkdownInline[] = [];
  let plain = '';
  const flush = () => { if (plain) { output.push({ type: 'text', text: plain }); plain = ''; } };
  for (let index = 0; index < source.length;) {
    const tail = source.slice(index);
    if (source[index] === '\\' && index + 1 < source.length && /[\\`*_{}\[\]()#+.!>~-]/.test(source[index + 1]!)) {
      plain += source[index + 1]!;
      index += 2;
      continue;
    }
    const link = tail.match(/^\[([^\]\n]+)\]\(([^\s)]+)\)/);
    if (link && safeHttpUrl(link[2]!)) {
      flush();
      output.push({ type: 'link', url: link[2]!, children: parseMarkdownInline(link[1]!) });
      index += link[0].length;
      continue;
    }
    const bare = tail.match(urlPattern)?.[0];
    if (bare && (index === 0 || !/[\w@]/.test(source[index - 1]!))) {
      const url = bare.replace(/[),.;!?]+$/, '');
      if (safeHttpUrl(url)) {
        flush();
        output.push({ type: 'link', url, children: [{ type: 'text', text: url }] });
        index += url.length;
        continue;
      }
    }
    const delimiter = ['**', '__', '~~', '*', '_', '`'].find(value => tail.startsWith(value));
    if (delimiter) {
      const end = source.indexOf(delimiter, index + delimiter.length);
      const insideWord = delimiter.startsWith('_') && (index > 0 && /[\p{L}\p{N}]/u.test(source[index - 1]!) || end >= 0 && /[\p{L}\p{N}]/u.test(source[end + delimiter.length] ?? ''));
      if (!insideWord && end > index + delimiter.length) {
        flush();
        const inner = source.slice(index + delimiter.length, end);
        if (delimiter === '`') output.push({ type: 'code', text: inner });
        else output.push({ type: delimiter === '~~' ? 'strike' : delimiter.length === 2 ? 'strong' : 'emphasis', children: parseMarkdownInline(inner) });
        index = end + delimiter.length;
        continue;
      }
    }
    plain += source[index]!;
    index += 1;
  }
  flush();
  return output;
}
