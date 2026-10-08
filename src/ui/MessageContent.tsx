import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, View, useWindowDimensions, type AccessibilityActionEvent, type AccessibilityActionInfo, type TextStyle } from 'react-native';
import { Text } from './Text';
import type { Attachment, Block, Message } from '../domain/contracts';
import { catalogImage, catalogUnicodeGlyph } from '../domain/emote-catalog';
import { hiddenTypes } from '../domain/hide';
import { parseMarkdownBlocks, prepareWorkspaceMarkdown, safeHttpUrl, type MarkdownInline } from '../domain/markdown';
import { useWorkspace } from '../domain/store';
import { FileRow } from './files';
import { Label } from './primitives';
import { useTheme } from './theme';
import { WorkspaceCard } from './cards';
import { attachmentPreviewUri, canPreviewAttachment, canPreviewEmote, emoteSource, isPreviewableImage, splitCatalogEmotes, type MediaContext } from '../data/media';
import { RemoteImage } from './RemoteImage';
import { EmoteCollectionShare } from './EmoteCollectionShare';

type StandaloneMedia = { kind: 'emote'; shortcode: string } | { kind: 'image' };
type MediaActions = {
  onLongPress?: () => void;
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
};

export function standaloneMessageMedia(message: Message): StandaloneMedia | null {
  if (message.fallback || !message.blocks.length) return null;
  if (message.blocks.length === 1 && !message.attachments.length) {
    const block = message.blocks[0]!;
    if (block.type === 'emoji' && emoteSource(block.shortcode)) return { kind: 'emote', shortcode: block.shortcode };
    if (block.type === 'text') {
      const parts = splitCatalogEmotes(block.text.trim());
      if (parts.length === 1 && parts[0]?.src && parts[0].token) return { kind: 'emote', shortcode: parts[0].token };
    }
  }
  if (message.blocks.every(block => block.type === 'attachment' && message.attachments.some(file => file.id === block.attachmentId && file.status === 'available' && file.capabilities.canDownload && isPreviewableImage(file)))
    && message.attachments.every(file => message.blocks.some(block => block.type === 'attachment' && block.attachmentId === file.id))) return { kind: 'image' };
  return null;
}

export function messageMediaSize(maxWidth: number, windowHeight: number, kind: 'image' | 'emote', natural?: { width: number; height: number }) {
  const widthLimit = Math.max(1, Math.min(maxWidth, kind === 'emote' ? 160 : 280));
  const heightLimit = Math.max(1, Math.min(kind === 'emote' ? 180 : 300, windowHeight * 0.5));
  const ratio = natural && Number.isFinite(natural.width) && Number.isFinite(natural.height) && natural.width > 0 && natural.height > 0
    ? natural.width / natural.height : kind === 'emote' ? 1 : 4 / 3;
  const width = Math.min(widthLimit, heightLimit * ratio);
  return { width, height: width / ratio };
}

export function MessageContent({
  message,
  download,
  onPreview,
  onPreviewEmote,
  mediaWidth,
  onLongPress,
  accessibilityActions,
  onAccessibilityAction,
  onOpenTopic,
  runtime,
}: {
  message: Message;
  download: (file: Attachment) => void;
  onPreview?: (file: Attachment) => void;
  onPreviewEmote?: (shortcode: string) => void;
  mediaWidth?: number;
  onOpenTopic?: (topicId: string) => void;
  runtime?: import('../data/runtime').Runtime;
} & MediaActions) {
  const settings = useWorkspace(s => s.chatSettings);
  const accountKey = useWorkspace(s => s.accountKey);
  const { width, height } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const standalone = standaloneMessageMedia(message);
  const maxMediaWidth = mediaWidth ?? Math.max(1, width - 80);
  const mediaContext = { accountKey, conversationId: message.conversationId, topicId: message.topicId ?? undefined, messageId: message.id };
  const mediaActions = { onLongPress, accessibilityActions, onAccessibilityAction };
  const matched = hiddenTypes(settings, message.blocks, message.attachments, message.plainText);
  if (matched.length && !expanded) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="展开已折叠的消息" onPress={() => setExpanded(true)}>
        <Label muted>已折叠（{matched.map(type => ({ image: '图片', emote: '表情', long: '长消息' }[type])).join('、')}），点按展开。这只影响你自己的显示。</Label>
      </Pressable>
    );
  }
  if (standalone?.kind === 'emote') {
    return <StandaloneEmote shortcode={standalone.shortcode} onPreview={onPreviewEmote} context={mediaContext} maxWidth={maxMediaWidth} windowHeight={height} {...mediaActions} />;
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
        <BlockView key={`${message.id}:${index}`} block={block} attachments={message.attachments} download={download} onPreview={onPreview} onOpenTopic={onOpenTopic} runtime={runtime} cardContext={{ conversationId: message.conversationId, topicId: message.topicId }} mediaContext={mediaContext} maxMediaWidth={maxMediaWidth} windowHeight={height} mediaActions={mediaActions} />
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
  cardContext,
  mediaContext,
  maxMediaWidth,
  windowHeight,
  mediaActions,
}: {
  block: Block;
  attachments: Attachment[];
  download: (file: Attachment) => void;
  onPreview?: (file: Attachment) => void;
  onOpenTopic?: (topicId: string) => void;
  runtime?: import('../data/runtime').Runtime;
  cardContext: { conversationId: string; topicId?: string | null };
  mediaContext: MediaContext;
  maxMediaWidth: number;
  windowHeight: number;
  mediaActions: MediaActions;
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
    if (isPreviewableImage(file)) return <AttachmentImage file={file} download={download} onPreview={onPreview} context={mediaContext} maxWidth={maxMediaWidth} windowHeight={windowHeight} {...mediaActions} />;
    return <FileRow file={file} download={() => download(file)} />;
  }
  if (block.type === 'card') return <WorkspaceCard block={block} runtime={runtime} onOpenTopic={onOpenTopic} context={cardContext} />;
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
  useEffect(() => setFailed(false), [uri]);
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

function StandaloneEmote({ shortcode, onPreview, context, maxWidth, windowHeight, ...actions }: { shortcode: string; onPreview?: (shortcode: string) => void; context: MediaContext; maxWidth: number; windowHeight: number } & MediaActions) {
  const t = useTheme();
  const allowed = useWorkspace(() => canPreviewEmote(shortcode, context));
  const src = emoteSource(shortcode);
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState<{ width: number; height: number }>();
  useEffect(() => { setFailed(false); setNatural(undefined); }, [src]);
  const size = messageMediaSize(maxWidth, windowHeight, 'emote', natural);
  const token = shortcode.startsWith('[') ? shortcode : `[${shortcode}]`;
  if (!allowed || !src || failed) return <View style={{ maxWidth }}><Text style={{ color: t.text, fontSize: t.type.body }}>{token}</Text><Label muted>表情暂不可用</Label></View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={shortcode.includes('custom:') ? '预览自定义表情' : `预览表情 ${token}`} accessibilityHint="点按查看大图，长按查看消息操作" onPress={() => onPreview?.(shortcode)} delayLongPress={450} {...actions} style={{ ...size, borderRadius: t.radius.bubble, overflow: 'hidden' }}>
      <RemoteImage uri={src} style={{ ...size, borderRadius: t.radius.bubble }} resizeMode="contain" onLoad={setNatural} onError={() => setFailed(true)} />
    </Pressable>
  );
}

function AttachmentImage({ file, download, onPreview, context, maxWidth, windowHeight, ...actions }: { file: Attachment; download: (file: Attachment) => void; onPreview?: (file: Attachment) => void; context: MediaContext; maxWidth: number; windowHeight: number } & MediaActions) {
  const t = useTheme();
  const allowed = useWorkspace(() => canPreviewAttachment(file, context));
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState<{ width: number; height: number }>();
  const { accountKey, conversationId, topicId, messageId } = context;
  useEffect(() => {
    let cancelled = false;
    setUri(null); setFailed(false); setNatural(undefined);
    if (!allowed) return;
    void attachmentPreviewUri(file, { accountKey, conversationId, topicId, messageId }).then(value => { if (!cancelled) setUri(value); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [file, accountKey, conversationId, topicId, messageId, allowed]);
  if (!allowed || failed) return <FileRow file={file} download={() => download(file)} />;
  if (!uri) return <Label muted>图片加载中…</Label>;
  const size = messageMediaSize(maxWidth, windowHeight, 'image', natural);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`预览图片 ${file.fileName}`} accessibilityHint="点按查看大图，长按查看消息操作" onPress={() => (onPreview ?? download)(file)} delayLongPress={450} {...actions} style={{ ...size, borderRadius: t.radius.bubble, overflow: 'hidden' }}>
      <RemoteImage uri={uri} style={{ ...size, borderRadius: t.radius.bubble }} resizeMode="contain" onLoad={setNatural} onError={() => setFailed(true)} />
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
