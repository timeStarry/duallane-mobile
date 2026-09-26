import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View, type TextStyle } from 'react-native';
import type { Attachment, Block, Message } from '../domain/contracts';
import { catalogImage, catalogUnicodeGlyph } from '../domain/emote-catalog';
import { hiddenTypes } from '../domain/hide';
import { parseMarkdownBlocks, prepareWorkspaceMarkdown, safeHttpUrl, type MarkdownInline } from '../domain/markdown';
import { useWorkspace } from '../domain/store';
import { FileRow } from './files';
import { Label } from './primitives';
import { useTheme } from './theme';
import { WorkspaceCard } from './cards';
import { attachmentPreviewUri, emoteSource, isPreviewableImage, splitCatalogEmotes } from '../data/media';
import { RemoteImage } from './RemoteImage';
import { EmoteCollectionShare } from './EmoteCollectionShare';

export function MessageContent({
  message,
  download,
  onPreview,
  onOpenTopic,
  runtime,
}: {
  message: Message;
  download: (file: Attachment) => void;
  onPreview?: (file: Attachment) => void;
  onOpenTopic?: (topicId: string) => void;
  runtime?: import('../data/runtime').Runtime;
}) {
  const settings = useWorkspace(s => s.chatSettings);
  const [expanded, setExpanded] = useState(false);
  const matched = hiddenTypes(settings, message.blocks, message.attachments, message.plainText);
  if (matched.length && !expanded) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="展开已折叠的消息" onPress={() => setExpanded(true)}>
        <Label muted>已折叠（{matched.map(type => ({ image: '图片', emote: '表情', long: '长消息' }[type])).join('、')}），点按展开。这只影响你自己的显示。</Label>
      </Pressable>
    );
  }
  if (message.fallback || !message.blocks.length) {
    return (
      <View>
        <RichText text={message.plainText} markdown={false} />
        {message.fallback ? <Label muted>部分内容暂不支持，可在“我的”检查更新。</Label> : null}
        {message.attachments.map(file => <FileRow key={file.id} file={file} download={() => download(file)} />)}
      </View>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      {message.blocks.map((block, index) => (
        <BlockView key={`${message.id}:${index}`} block={block} attachments={message.attachments} download={download} onPreview={onPreview} onOpenTopic={onOpenTopic} runtime={runtime} />
      ))}
    </View>
  );
}

function BlockView({
  block,
  attachments,
  download,
  onPreview,
  onOpenTopic,
  runtime,
}: {
  block: Block;
  attachments: Attachment[];
  download: (file: Attachment) => void;
  onPreview?: (file: Attachment) => void;
  onOpenTopic?: (topicId: string) => void;
  runtime?: import('../data/runtime').Runtime;
}) {
  const t = useTheme();
  if (block.type === 'text') return <MarkdownText text={block.text} />;
  if (block.type === 'mention') return <Text style={{ color: t.shared, fontSize: t.type.body, fontWeight: '600' }}>@{block.label}</Text>;
  if (block.type === 'link') {
    const href = safeHttpUrl(block.url);
    return href ? (
      <Text style={{ color: t.focus, fontSize: t.type.body }} onPress={() => void Linking.openURL(href)}>{block.label || href}</Text>
    ) : <Text style={{ color: t.text }}>{block.label || '链接不可用'}</Text>;
  }
  if (block.type === 'emoji') return <EmoteView shortcode={block.shortcode} />;
  if (block.type === 'attachment') {
    const file = attachments.find(item => item.id === block.attachmentId);
    if (!file) return <Label muted>附件不可用</Label>;
    if (isPreviewableImage(file)) return <AttachmentImage file={file} download={download} onPreview={onPreview} />;
    return <FileRow file={file} download={() => download(file)} />;
  }
  if (block.type === 'card') return <WorkspaceCard block={block} runtime={runtime} onOpenTopic={onOpenTopic} />;
  if (block.type === 'emote_collection') return <EmoteCollectionShare shareId={block.shareId} summary={block.share} runtime={runtime} />;
  if (block.type === 'topic_reference') {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`打开话题${block.title}`} onPress={() => onOpenTopic?.(block.topicId)}>
        <Text style={{ color: t.shared, fontWeight: '600' }}>#{block.title}</Text>
      </Pressable>
    );
  }
  return null;
}

export function EmoteImage({ uri, token, size }: { uri: string; token: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const fail = useCallback(() => setFailed(true), []);
  if (failed) return <View style={{ width: size, height: size }} />;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={token.startsWith('[custom:') ? '自定义表情' : token}>
      <RemoteImage uri={uri} style={{ width: size, height: size }} onError={fail} />
    </View>
  );
}

export function ReactionGlyph({ emoteKey }: { emoteKey: string }) {
  const src = emoteSource(emoteKey) ?? catalogImage(emoteKey)?.src;
  const glyph = catalogUnicodeGlyph(emoteKey);
  if (src) return <EmoteImage uri={src} token={emoteKey} size={16} />;
  return <Text>{glyph ?? emoteKey}</Text>;
}

function EmoteView({ shortcode }: { shortcode: string }) {
  const src = emoteSource(shortcode);
  if (src) return <EmoteImage uri={src} token={shortcode.startsWith('[') ? shortcode : `:${shortcode}:`} size={32} />;
  const glyph = catalogUnicodeGlyph(shortcode);
  if (glyph) return <Text style={{ fontSize: 28 }}>{glyph}</Text>;
  return <Text style={{ fontSize: 28 }}>{shortcode.startsWith('custom:') || shortcode.startsWith('[') ? (shortcode.startsWith('[') ? shortcode : `[${shortcode}]`) : `:${shortcode}:`}</Text>;
}

function AttachmentImage({ file, download, onPreview }: { file: Attachment; download: (file: Attachment) => void; onPreview?: (file: Attachment) => void }) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void attachmentPreviewUri(file).then(value => { if (!cancelled) setUri(value); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [file]);
  if (failed) return <FileRow file={file} download={() => download(file)} />;
  if (!uri) return <Label muted>图片加载中…</Label>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`预览图片 ${file.fileName}`} onPress={() => (onPreview ?? download)(file)}>
      <RemoteImage uri={uri} style={{ width: 240, height: 180, borderRadius: 12 }} onError={() => setFailed(true)} />
    </Pressable>
  );
}

function MarkdownText({ text }: { text: string }) {
  return <RichText text={text} markdown />;
}

function RichText({ text, markdown }: { text: string; markdown: boolean }) {
  const t = useTheme();
  const prepared = markdown ? prepareWorkspaceMarkdown(text) : { source: text.replace(/\r\n?/g, '\n'), plain: true };
  if (prepared.plain) {
    return <View>{prepared.source.split('\n').map((line, index) => <RichLine key={index} parts={[{ type: 'text', text: line }]} fontSize={t.type.body} color={t.text} linkColor={t.focus} />)}</View>;
  }
  return (
    <View style={{ gap: 8 }}>
      {parseMarkdownBlocks(prepared.source).map((block, index) => {
        if (block.type === 'rule') return <View key={index} style={{ height: 1, backgroundColor: t.line, marginVertical: 4 }} />;
        if (block.type === 'code') return (
          <ScrollView key={index} horizontal nestedScrollEnabled style={{ maxWidth: '100%', borderRadius: 8, backgroundColor: t.soft }} contentContainerStyle={{ padding: 10 }}>
            <Text selectable style={{ color: t.text, fontFamily: 'monospace', fontSize: t.type.body - 2, lineHeight: t.type.body + 4 }}>{block.text}</Text>
          </ScrollView>
        );
        if (block.type === 'heading') return <RichLine key={index} parts={block.content} fontSize={block.level <= 3 ? t.type.section : t.type.body} color={t.text} linkColor={t.focus} baseStyle={{ fontWeight: '700' }} />;
        if (block.type === 'list') return (
          <View key={index} style={{ gap: 4 }}>
            {block.items.map((item, itemIndex) => (
              <View key={itemIndex} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingLeft: 4 }}>
                <Text style={{ color: t.muted, fontSize: t.type.body, lineHeight: t.type.body + 6, width: 26 }}>{block.ordered ? `${block.start + itemIndex}.` : '•'}</Text>
                <View style={{ flex: 1 }}><RichLine parts={item} fontSize={t.type.body} color={t.text} linkColor={t.focus} /></View>
              </View>
            ))}
          </View>
        );
        return (
          <View key={index} style={block.type === 'quote' ? { borderLeftWidth: 3, borderLeftColor: t.line, paddingLeft: 10 } : undefined}>
            {block.lines.map((line, lineIndex) => <RichLine key={lineIndex} parts={line} fontSize={t.type.body} color={block.type === 'quote' ? t.muted : t.text} linkColor={t.focus} />)}
          </View>
        );
      })}
    </View>
  );
}

type InlineLeaf = { text: string; style: TextStyle; url?: string; allowEmotes: boolean };

function flattenInline(parts: MarkdownInline[], style: TextStyle = {}, url?: string): InlineLeaf[] {
  return parts.flatMap(part => {
    if (part.type === 'text' || part.type === 'code') return [{ text: part.text, style: part.type === 'code' ? { ...style, fontFamily: 'monospace' } : style, url, allowEmotes: part.type !== 'code' }];
    if (part.type === 'link') return flattenInline(part.children, style, part.url);
    const next: TextStyle = part.type === 'strong' ? { ...style, fontWeight: '700' }
      : part.type === 'emphasis' ? { ...style, fontStyle: 'italic' }
        : { ...style, textDecorationLine: 'line-through' };
    return flattenInline(part.children, next, url);
  });
}

function RichLine({ parts, fontSize, color, linkColor, baseStyle }: { parts: MarkdownInline[]; fontSize: number; color: string; linkColor: string; baseStyle?: TextStyle }) {
  const leaves = flattenInline(parts, baseStyle);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', minHeight: fontSize + 6 }}>
      {leaves.flatMap((leaf, index) => (leaf.allowEmotes ? splitCatalogEmotes(leaf.text) : [{ text: leaf.text }]).map((part, partIndex) => {
        if (part.src) return <EmoteImage key={`${index}:${partIndex}`} uri={part.src} token={part.token ?? ''} size={28} />;
        return <Text key={`${index}:${partIndex}`} selectable accessibilityRole={leaf.url ? 'link' : undefined} style={{ fontSize, lineHeight: fontSize + 6, color: leaf.url ? linkColor : color, ...leaf.style }} onPress={leaf.url ? () => void Linking.openURL(leaf.url!) : undefined}>{part.text}</Text>;
      }))}
    </View>
  );
}
