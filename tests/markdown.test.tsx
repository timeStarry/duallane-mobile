import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { parseMessage } from '../src/domain/contracts';
import { parseMarkdownBlocks, parseMarkdownInline, prepareWorkspaceMarkdown, safeHttpUrl } from '../src/domain/markdown';
import { MessageContent } from '../src/ui/MessageContent';

jest.mock('../src/ui/RemoteImage', () => ({ RemoteImage: () => null }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { environment: 'test', apiOrigin: '', channel: 'internal' } }, nativeAppVersion: '0.1.0', nativeBuildVersion: '1' } }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

const message = (text: string) => parseMessage({
  id: 'm1', conversationId: 'c1', authorName: 'Test', kind: 'user', createdAt: '2026-01-01T00:00:00Z', plainText: text,
  content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'text', text }] }, attachments: [],
})!;

test('Markdown blocks match the supported Web subset without executing raw HTML', () => {
  const source = '# 标题\n\n> 引用\n\n- 一项\n- 二项\n\n3. 第三项\n\n---\n\n```ts\nconst x = 1\n```';
  expect(parseMarkdownBlocks(source).map(block => block.type)).toEqual(['heading', 'quote', 'list', 'list', 'rule', 'code']);
  expect(parseMarkdownBlocks(source)[3]).toMatchObject({ ordered: true, start: 3 });
  expect(parseMarkdownBlocks(source)[5]).toMatchObject({ text: 'const x = 1', language: 'ts' });
  expect(prepareWorkspaceMarkdown('<script>alert(1)</script>').plain).toBe(true);
  expect(prepareWorkspaceMarkdown('| A | B |\n| --- | --- |').plain).toBe(true);
  expect(prepareWorkspaceMarkdown('```ts\nconst x = 1').plain).toBe(true);
  expect(prepareWorkspaceMarkdown('```ts\nconst x = 1\n```unfinished').plain).toBe(true);
  expect(prepareWorkspaceMarkdown('~~~js\nconst x = 1\n~~~').plain).toBe(false);
  expect(prepareWorkspaceMarkdown('    缩进').plain).toBe(true);
});

test('inline parser preserves emphasis, code and one original-position safe URL', () => {
  expect(parseMarkdownInline('**粗体** *斜体* ~~删除~~ `代码`').map(part => part.type)).toEqual(['strong', 'text', 'emphasis', 'text', 'strike', 'text', 'code']);
  expect(parseMarkdownInline('访问 https://example.test/files?id=42 查看')).toEqual([
    { type: 'text', text: '访问 ' },
    { type: 'link', url: 'https://example.test/files?id=42', children: [{ type: 'text', text: 'https://example.test/files?id=42' }] },
    { type: 'text', text: ' 查看' },
  ]);
  expect(parseMarkdownInline('[危险](javascript:alert(1))').some(part => part.type === 'link')).toBe(false);
  expect(parseMarkdownInline('snake_case_name')).toEqual([{ type: 'text', text: 'snake_case_name' }]);
  expect(safeHttpUrl('javascript:alert(1)')).toBe('');
});

test('message displays headings, quote, list, code and links, while catalog emotes stay outside code', () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const url = 'https://example.test/files?id=42';
  const view = render(<MessageContent message={message(`# 标题\n\n> 引用\n\n- [bili:melon] 一项\n\n访问 ${url} 查看\n\n\`[bili:melon]\``)} download={jest.fn()} />);
  expect(view.getByText('标题')).toBeTruthy();
  expect(view.getByText('引用')).toBeTruthy();
  expect(view.getByText('•')).toBeTruthy();
  expect(view.getByLabelText('[bili:melon]')).toBeTruthy();
  expect(view.getByText('[bili:melon]')).toBeTruthy();
  expect(view.getAllByText(url)).toHaveLength(1);
  fireEvent.press(view.getByRole('link', { name: url }));
  expect(open).toHaveBeenCalledWith(url);
  open.mockRestore();
});

test('unsupported HTML and unclosed code fences remain literal and inert', () => {
  const view = render(<MessageContent message={message('<script>alert(1)</script>\n```ts\nconsole.log(1)')} download={jest.fn()} />);
  expect(view.getByText('<script>alert(1)</script>')).toBeTruthy();
  expect(view.getByText('```ts')).toBeTruthy();
  expect(view.queryByRole('link')).toBeNull();
});

const multilineRich = '**SyntheticWebRich\n合成多行中文与富文本\nhttps://example.test/**';

test('one Web bold selection across three lines preserves each line and the clean link target', () => {
  expect(prepareWorkspaceMarkdown(multilineRich).plain).toBe(false);
  expect(parseMarkdownBlocks(multilineRich)).toEqual([{
    type: 'paragraph', lines: [
      [{ type: 'strong', children: [{ type: 'text', text: 'SyntheticWebRich' }] }],
      [{ type: 'strong', children: [{ type: 'text', text: '合成多行中文与富文本' }] }],
      [{ type: 'strong', children: [{ type: 'link', url: 'https://example.test/', children: [{ type: 'text', text: 'https://example.test/' }] }] }],
    ],
  }]);
});

test.each([
  ['**', 'strong'], ['*', 'emphasis'], ['~~', 'strike'],
])('a %s span survives one paragraph newline as %s', (marker, type) => {
  expect(parseMarkdownBlocks(`${marker}首行\n末行${marker}`)).toEqual([{
    type: 'paragraph', lines: [
      [{ type, children: [{ type: 'text', text: '首行' }] }],
      [{ type, children: [{ type: 'text', text: '末行' }] }],
    ],
  }]);
});

test('nested formatting and an explicit link retain their wrappers when split into visual lines', () => {
  expect(parseMarkdownBlocks('**第一行 *斜体\n第二行* ~~删除\n第三行~~ [公开](https://example.test/?x=1&y=2)**')).toEqual([{
    type: 'paragraph', lines: [
      [{ type: 'strong', children: [{ type: 'text', text: '第一行 ' }, { type: 'emphasis', children: [{ type: 'text', text: '斜体' }] }] }],
      [{ type: 'strong', children: [{ type: 'emphasis', children: [{ type: 'text', text: '第二行' }] }, { type: 'text', text: ' ' }, { type: 'strike', children: [{ type: 'text', text: '删除' }] }] }],
      [{ type: 'strong', children: [{ type: 'strike', children: [{ type: 'text', text: '第三行' }] }, { type: 'text', text: ' ' }, { type: 'link', url: 'https://example.test/?x=1&y=2', children: [{ type: 'text', text: '公开' }] }] }],
    ],
  }]);
});

test('unclosed and escaped spans stay literal across a paragraph newline', () => {
  expect(parseMarkdownBlocks('**首行\n末行')).toEqual([{ type: 'paragraph', lines: [
    [{ type: 'text', text: '**首行' }], [{ type: 'text', text: '末行' }],
  ] }]);
  expect(parseMarkdownBlocks('\\*\\*首行\n末行\\*\\*')).toEqual([{ type: 'paragraph', lines: [
    [{ type: 'text', text: '**首行' }], [{ type: 'text', text: '末行**' }],
  ] }]);
});

test('inline code markers cannot close a surrounding multiline format', () => {
  expect(parseMarkdownBlocks('**首行\n`**字面**`\n末行**')).toEqual([{ type: 'paragraph', lines: [
    [{ type: 'strong', children: [{ type: 'text', text: '首行' }] }],
    [{ type: 'strong', children: [{ type: 'code', text: '**字面**' }] }],
    [{ type: 'strong', children: [{ type: 'text', text: '末行' }] }],
  ] }]);
});

test('formatting cannot pair across blank paragraphs, list items, quotes, headings or fenced code', () => {
  expect(parseMarkdownBlocks('**前段\n\n后段**')).toEqual([
    { type: 'paragraph', lines: [[{ type: 'text', text: '**前段' }]] },
    { type: 'paragraph', lines: [[{ type: 'text', text: '后段**' }]] },
  ]);
  expect(parseMarkdownBlocks('**段首\n- 列表**\n- **另一项\n> 引用**\n```text\n**代码\n代码**\n```\n**末段\n# 标题**')).toEqual([
    { type: 'paragraph', lines: [[{ type: 'text', text: '**段首' }]] },
    { type: 'list', ordered: false, start: 1, items: [[{ type: 'text', text: '列表**' }], [{ type: 'text', text: '**另一项' }]] },
    { type: 'quote', lines: [[{ type: 'text', text: '引用**' }]] },
    { type: 'code', language: 'text', text: '**代码\n代码**' },
    { type: 'paragraph', lines: [[{ type: 'text', text: '**末段' }]] },
    { type: 'heading', level: 1, content: [{ type: 'text', text: '标题**' }] },
  ]);
});

test.each(['**', '__', '~~', '`'])('trailing %s markers stay outside a bare URL target', marker => {
  expect(parseMarkdownInline(`https://example.test/path/${marker}`)).toEqual([
    { type: 'link', url: 'https://example.test/path/', children: [{ type: 'text', text: 'https://example.test/path/' }] },
    { type: 'text', text: marker },
  ]);
});

test('bare URLs keep balanced parentheses, interior characters and encoded delimiters', () => {
  const balanced = 'https://example.test/a_(b)';
  expect(parseMarkdownInline(`(${balanced})!`)).toEqual([
    { type: 'text', text: '(' },
    { type: 'link', url: balanced, children: [{ type: 'text', text: balanced }] },
    { type: 'text', text: ')!' },
  ]);
  const complete = 'https://example.test/a*b_c~d?x=one_two&y=%2A%5F%7E#part';
  expect(parseMarkdownInline(complete)).toEqual([{ type: 'link', url: complete, children: [{ type: 'text', text: complete }] }]);
  const semicolon = 'https://example.test/path;v=1;';
  expect(parseMarkdownInline(semicolon)).toEqual([{ type: 'link', url: semicolon, children: [{ type: 'text', text: semicolon }] }]);
  expect(parseMarkdownInline('[公开](https://example.test/a_*~)')).toEqual([{ type: 'link', url: 'https://example.test/a_*~', children: [{ type: 'text', text: '公开' }] }]);
});

test('real message content renders the three bold lines and opens only the clean HTTP target', () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const view = render(<MessageContent message={message(multilineRich)} download={jest.fn()} />);
  expect(view.getByText('SyntheticWebRich')).toHaveStyle({ fontWeight: '700' });
  expect(view.getByText('合成多行中文与富文本')).toHaveStyle({ fontWeight: '700' });
  expect(view.getByText('https://example.test/')).toHaveStyle({ fontWeight: '700' });
  expect(view.queryByText('**SyntheticWebRich')).toBeNull();
  expect(view.queryByText('https://example.test/**')).toBeNull();
  fireEvent.press(view.getByRole('link', { name: 'https://example.test/' }));
  expect(open).toHaveBeenCalledWith('https://example.test/');
  open.mockRestore();
});

test('rendered multiline nested formats preserve styles and keep catalog emotes outside code', () => {
  const view = render(<MessageContent message={message('**首行 *斜体\n次行* ~~删除\n末行~~ [bili:melon]**\n\n`[bili:melon]`')} download={jest.fn()} />);
  expect(view.getByText('斜体')).toHaveStyle({ fontWeight: '700', fontStyle: 'italic' });
  expect(view.getByText('次行')).toHaveStyle({ fontWeight: '700', fontStyle: 'italic' });
  expect(view.getByText('删除')).toHaveStyle({ fontWeight: '700', textDecorationLine: 'line-through' });
  expect(view.getByText('末行')).toHaveStyle({ fontWeight: '700', textDecorationLine: 'line-through' });
  expect(view.getAllByLabelText('[bili:melon]')).toHaveLength(1);
  expect(view.getByText('[bili:melon]')).toHaveStyle({ fontFamily: 'monospace' });
});

test('multiline formatting cannot turn an unsafe scheme into an actionable link', () => {
  const view = render(<MessageContent message={message('**首行\n[危险](javascript:alert(1))**')} download={jest.fn()} />);
  expect(view.queryByRole('link')).toBeNull();
  expect(view.getByText('[危险](javascript:alert(1))')).toHaveStyle({ fontWeight: '700' });
});

test('CRLF transport text renders through the same paragraph formatting path', () => {
  const view = render(<MessageContent message={message(multilineRich.replace(/\n/g, '\r\n'))} download={jest.fn()} />);
  expect(view.getByText('SyntheticWebRich')).toHaveStyle({ fontWeight: '700' });
  expect(view.getByText('合成多行中文与富文本')).toHaveStyle({ fontWeight: '700' });
  expect(view.getByRole('link', { name: 'https://example.test/' })).toBeTruthy();
});

test('an unknown content version keeps multiline fallback literal and without links', () => {
  const fallback = parseMessage({
    id: 'future', conversationId: 'c1', authorName: 'Test', kind: 'user', createdAt: '2026-01-01T00:00:00Z', plainText: multilineRich,
    content: { format: 'duallane.message+json;v=2', blocks: [{ type: 'text', text: multilineRich }] }, attachments: [],
  })!;
  const view = render(<MessageContent message={fallback} download={jest.fn()} />);
  expect(view.getByText('**SyntheticWebRich')).toBeTruthy();
  expect(view.getByText('https://example.test/**')).toBeTruthy();
  expect(view.queryByRole('link')).toBeNull();
});
