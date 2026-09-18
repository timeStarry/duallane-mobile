import React, { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import type { Attachment, Block, Message } from '../domain/contracts';
import { hiddenTypes } from '../domain/hide';
import { extractHttpUrls, prepareWorkspaceMarkdown, safeHttpUrl } from '../domain/markdown';
import { useWorkspace } from '../domain/store';
import { FileRow } from './files';
import { Label } from './primitives';
import { useTheme } from './theme';
import { WorkspaceCard } from './cards';
import { attachmentPreviewUri, emoteSource, isPreviewableImage, splitCatalogEmotes } from '../data/media';
import { RemoteImage } from './RemoteImage';

export function MessageContent({
  message,
  download,
  onOpenTopic,
  runtime,
}: {
  message: Message;
  download: (file: Attachment) => void;
  onOpenTopic?: (topicId: string) => void;
  runtime?: import('../data/runtime').Runtime;
}) {
  const t = useTheme();
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
        <Text selectable style={{ fontSize: t.type.body, lineHeight: t.type.bodyLine, color: t.text }}>{message.plainText}</Text>
        {message.fallback ? <Label muted>部分内容暂不支持，可在“我的”检查更新。</Label> : null}
        {message.attachments.map(file => <FileRow key={file.id} file={file} download={() => download(file)} />)}
      </View>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      {message.blocks.map((block, index) => (
        <BlockView key={`${message.id}:${index}`} block={block} attachments={message.attachments} download={download} onOpenTopic={onOpenTopic} runtime={runtime} />
      ))}
    </View>
  );
}

function BlockView({
  block,
  attachments,
  download,
  onOpenTopic,
  runtime,
}: {
  block: Block;
  attachments: Attachment[];
  download: (file: Attachment) => void;
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
    if (isPreviewableImage(file)) return <AttachmentImage file={file} download={download} />;
    return <FileRow file={file} download={() => download(file)} />;
  }
  if (block.type === 'card') return <WorkspaceCard block={block} runtime={runtime} onOpenTopic={onOpenTopic} />;
  if (block.type === 'emote_collection') return <Label>{block.share?.revokedAt ? '表情合集已失效' : `表情合集 ${block.share?.name ?? ''}`}</Label>;
  if (block.type === 'topic_reference') {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`打开话题${block.title}`} onPress={() => onOpenTopic?.(block.topicId)}>
        <Text style={{ color: t.shared, fontWeight: '600' }}>#{block.title}</Text>
      </Pressable>
    );
  }
  return null;
}

function EmoteView({ shortcode }: { shortcode: string }) {
  const src = emoteSource(shortcode);
  if (src) return <RemoteImage uri={src} style={{ width: 32, height: 32 }} />;
  return <Text style={{ fontSize: 28 }}>{shortcode.startsWith('custom:') ? `[${shortcode}]` : `:${shortcode}:`}</Text>;
}

function AttachmentImage({ file, download }: { file: Attachment; download: (file: Attachment) => void }) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void attachmentPreviewUri(file).then(value => { if (!cancelled) setUri(value); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [file.id, file.byteSize, file.fileName, file.mimeType]);
  if (failed) return <FileRow file={file} download={() => download(file)} />;
  if (!uri) return <Label muted>图片加载中…</Label>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`预览图片 ${file.fileName}`} onPress={() => download(file)}>
      <RemoteImage uri={uri} style={{ width: 240, height: 180, borderRadius: 12 }} onError={() => setFailed(true)} />
    </Pressable>
  );
}

function renderCatalogText(text: string, fontSize: number, color: string) {
  return splitCatalogEmotes(text).map((part, index) => {
    if (part.src) return <RemoteImage key={`${part.token}:${index}`} uri={part.src} style={{ width: 28, height: 28 }} />;
    return <Text key={index} selectable style={{ fontSize, color }}>{part.text}</Text>;
  });
}

function MarkdownText({ text }: { text: string }) {
  const t = useTheme();
  const prepared = prepareWorkspaceMarkdown(text);
  if (prepared.plain) {
    return <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>{renderCatalogText(prepared.source, t.type.body, t.text)}</View>;
  }
  const urls = extractHttpUrls(prepared.source);
  return (
    <View>
      {prepared.source.split('\n').map((line, index) => (
        <Text key={index} selectable style={{ fontSize: t.type.body, lineHeight: t.type.bodyLine, color: t.text }}>
          {renderInline(line, t.focus)}
        </Text>
      ))}
      {urls.map(url => (
        <Text key={url} style={{ color: t.focus }} onPress={() => void Linking.openURL(url)}>{url}</Text>
      ))}
    </View>
  );
}

function renderInline(line: string, linkColor: string) {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <Text key={index} style={{ fontWeight: '700' }}>{part.slice(2, -2)}</Text>;
    if (part.startsWith('`') && part.endsWith('`')) return <Text key={index} style={{ fontFamily: 'monospace' }}>{part.slice(1, -1)}</Text>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (link) return <Text key={index} style={{ color: linkColor }} onPress={() => void Linking.openURL(link[2]!)}>{link[1]}</Text>;
    return <Text key={index}>{part}</Text>;
  });
}
