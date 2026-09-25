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
