import type { Attachment, Block, ChatSettings } from './contracts';
import { prepareWorkspaceMarkdown } from './markdown';

export function shouldCollapseText(blocks: Block[]) {
  const visible = blocks.map(block => {
    if (block.type === 'text') return block.text;
    if (block.type === 'mention') return `@${block.label}`;
    if (block.type === 'link') return block.label || block.url;
    if (block.type === 'emoji') return `:${block.shortcode}:`;
    if (block.type === 'card') return block.fallbackText;
    if (block.type === 'topic_reference') return `#${block.title}`;
    if (block.type === 'emote_collection') return block.share?.name ?? '';
    return '';
  }).join('');
  return [...visible].length > 700 || visible.split(/\r?\n/).length > 10;
}

export function classifyHiddenContent(blocks: Block[], attachments: Attachment[], fallbackText: string): Array<'image' | 'emote' | 'long'> {
  const found = new Set<'image' | 'emote' | 'long'>();
  if (!blocks.length) {
    if (shouldCollapseText([{ type: 'text', text: fallbackText }])) found.add('long');
    if (/\p{Extended_Pictographic}/u.test(fallbackText)) found.add('emote');
    return [...found];
  }
  if (shouldCollapseText(blocks)) found.add('long');
  for (const block of blocks) {
    if (block.type === 'emoji' || block.type === 'emote_collection') found.add('emote');
    if (block.type === 'attachment' && attachments.some(file => file.id === block.attachmentId && file.mimeType.startsWith('image/'))) found.add('image');
    if (block.type === 'text') {
      const prepared = prepareWorkspaceMarkdown(block.text);
      if (/!\[[^\]]*\]\(\s*https?:\/\//.test(prepared.source)) found.add('image');
      if (/\p{Extended_Pictographic}/u.test(prepared.source)) found.add('emote');
    }
  }
  return [...found];
}

export function hiddenTypes(settings: ChatSettings | null, blocks: Block[], attachments: Attachment[], fallbackText: string) {
  if (!settings?.autoHideMessages) return [];
  return classifyHiddenContent(blocks, attachments, fallbackText).filter(type => settings.autoHideMessageTypes.includes(type));
}
