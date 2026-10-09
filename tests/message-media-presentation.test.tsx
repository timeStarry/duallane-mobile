import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { attachmentPreviewUri, canPreviewAttachment } from '../src/data/media';
import { bootstrapSchema, type Attachment, type Message } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';
import { syntheticConversations, syntheticMembers, syntheticMessages, syntheticSelf } from '../src/fixtures/synthetic';
import { EmoteImage, MessageContent, messageMediaSize, ReactionGlyph, standaloneMessageMedia } from '../src/ui/MessageContent';
import { MessageRow } from '../src/ui/message';
import { resolveTheme } from '../src/ui/tokens';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { environment: 'test', apiOrigin: '', channel: 'internal' } }, nativeAppVersion: '0.1.0', nativeBuildVersion: '1' } }));
jest.mock('../src/data/media', () => ({
  ...jest.requireActual('../src/data/media'),
  attachmentPreviewUri: jest.fn(),
  canPreviewAttachment: jest.fn(),
}));
let mockDimensions = { width: 390, height: 844, scale: 1, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDimensions }));
jest.mock('../src/ui/RemoteImage', () => {
  const native = jest.requireActual<typeof import('react-native')>('react-native');
  return { RemoteImage: (props: { uri: string }) => <native.View testID="synthetic-media" {...props} /> };
});

const token = '[custom:11111111-1111-4111-8111-111111111111]';
const image: Attachment = { id: 'synthetic-image', fileName: 'synthetic-portrait.png', mimeType: 'image/png', byteSize: 12, status: 'available', capabilities: { canDownload: true } };
const original: Message = { ...syntheticMessages[0]!, authorId: syntheticSelf.id, authorName: syntheticSelf.displayName, attachments: [], blocks: [{ type: 'text', text: '合成文本' }], plainText: '合成文本' };
const sticker: Message = { ...original, blocks: [{ type: 'emoji', shortcode: token }], plainText: token };
const photo: Message = { ...original, blocks: [{ type: 'attachment', attachmentId: image.id }], attachments: [image], plainText: image.fileName };
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } };

beforeEach(() => {
  mockDimensions = { width: 390, height: 844, scale: 1, fontScale: 1 };
  jest.mocked(attachmentPreviewUri).mockResolvedValue('file:///synthetic-preview.png');
  jest.mocked(canPreviewAttachment).mockReturnValue(true);
  useWorkspace.getState().applyBootstrap(bootstrapSchema.parse({
    auth: { currentUser: syntheticSelf }, space: { id: 'synthetic-space', name: '合成空间' },
    eventCursor: 0, permissions: { canReadConversations: true, canDownload: true },
    policy: { dailyQuotaBytes: 1000, remainingQuotaBytes: 1000, messageRetentionCount: 100 },
    members: syntheticMembers, conversations: syntheticConversations, files: [],
  }), 'synthetic-account');
});
afterEach(() => useWorkspace.getState().reset());

function row(message: Message, props: Partial<React.ComponentProps<typeof MessageRow>> = {}) {
  useWorkspace.getState().setMessages(message.conversationId, [message]);
  return render(<SafeAreaProvider initialMetrics={metrics}><MessageRow message={message} retry={jest.fn()} download={jest.fn()} {...props} /></SafeAreaProvider>);
}

test('only a complete supported image-emote or image attachment message gets media presentation', () => {
  expect(standaloneMessageMedia(sticker)).toEqual({ kind: 'emote', shortcode: token });
  expect(standaloneMessageMedia({ ...sticker, blocks: [{ type: 'text', text: ` \n${token}\n ` }] })).toEqual({ kind: 'emote', shortcode: token });
  expect(standaloneMessageMedia(photo)).toEqual({ kind: 'image' });
  for (const message of [
    { ...sticker, blocks: [{ type: 'text' as const, text: `一句话 ${token}` }] },
    { ...sticker, blocks: [{ type: 'emoji' as const, shortcode: 'emoji:smile' }] },
    { ...sticker, blocks: [{ type: 'emoji' as const, shortcode: '[custom:invalid]' }] },
    { ...sticker, fallback: true },
    { ...sticker, blocks: [] },
    { ...photo, blocks: [{ type: 'text' as const, text: '说明' }, ...photo.blocks] },
    { ...photo, attachments: [] },
  ]) expect(standaloneMessageMedia(message)).toBeNull();
});

test.each(['single', 'start', 'middle', 'end'] as const)('%s text bubbles retain four rounded corners and independent actions', groupPosition => {
  const view = row(original, { groupPosition });
  expect(StyleSheet.flatten(view.getByTestId(`message-body-${original.id}`).props.style)).toMatchObject({ borderRadius: resolveTheme('light').radius.bubble, padding: 12 });
  expect(view.getByTestId(`message-body-${original.id}`).props.accessible).toBe(false);
  const timestamp = view.getByRole('text', { name: /^消息操作，/ });
  expect(timestamp.props.accessibilityActions).toContainEqual({ name: 'more', label: '更多消息操作' });
  expect(view.queryByRole('button', { name: /^消息操作，/ })).toBeNull();
});

test('standalone custom stickers are larger, bare, previewable and keep long-press actions', () => {
  const onPreviewEmote = jest.fn();
  const view = row(sticker, { onPreviewEmote });
  const body = StyleSheet.flatten(view.getByTestId(`message-body-${sticker.id}`).props.style);
  expect(body.padding).toBe(0);
  expect(body.backgroundColor).toBeUndefined();
  const media = view.getByTestId('synthetic-media');
  expect(StyleSheet.flatten(media.props.style)).toMatchObject({ width: 160, height: 160, borderRadius: resolveTheme('light').radius.bubble });
  expect(media.props.resizeMode).toBe('contain');
  const preview = view.getByRole('button', { name: '预览自定义表情' });
  fireEvent(preview, 'longPress');
  expect(view.getByRole('button', { name: '更多' })).toBeTruthy();
  expect(onPreviewEmote).not.toHaveBeenCalled();
  fireEvent.press(preview);
  expect(onPreviewEmote).toHaveBeenCalledWith(token);
  fireEvent(preview, 'accessibilityAction', { nativeEvent: { actionName: 'more' } });
  expect(view.getByRole('button', { name: '仅自己隐藏' })).toBeTruthy();
});

test('mixed Markdown, explicit mixed emotes, Unicode glyphs and reactions retain their small presentation', () => {
  const mixed = render(<MessageContent message={{ ...original, blocks: [{ type: 'text', text: `**一句话** ${token}` }, { type: 'emoji', shortcode: '[bili:melon]' }, { type: 'emoji', shortcode: 'emoji:smile' }] }} download={jest.fn()} />);
  const sizes = mixed.getAllByTestId('synthetic-media').map(item => StyleSheet.flatten(item.props.style).width);
  expect(sizes).toEqual([28, 32]);
  expect(mixed.queryByRole('button', { name: /预览.*表情/ })).toBeNull();
  expect(StyleSheet.flatten(mixed.getByText('😄').props.style).fontSize).toBe(28);
  const reaction = render(<ReactionGlyph emoteKey="bili:melon" />);
  expect(StyleSheet.flatten(reaction.getByTestId('synthetic-media').props.style)).toMatchObject({ width: 16, height: 16 });
});

test('unsupported fallback stays textual while a failed sticker keeps a readable token', () => {
  const fallback = row({ ...sticker, fallback: true });
  expect(fallback.queryByRole('button', { name: '预览自定义表情' })).toBeNull();
  expect(fallback.getByText('部分内容暂不支持，可在“我的”检查更新。')).toBeTruthy();
  expect(StyleSheet.flatten(fallback.getByTestId(`message-body-${sticker.id}`).props.style).padding).toBe(12);
  fallback.unmount();
  const view = row(sticker);
  fireEvent(view.getByTestId('synthetic-media'), 'error');
  expect(view.getByText(token)).toBeTruthy();
  expect(view.getByText('表情暂不可用')).toBeTruthy();
  expect(view.queryByRole('button', { name: '预览自定义表情' })).toBeNull();
});

test('replacing a failed inline emote source permits the new image to load', () => {
  const view = render(<EmoteImage uri="/assets/synthetic-first.png" token="[bili:melon]" size={28} />);
  fireEvent(view.getByTestId('synthetic-media'), 'error');
  expect(view.queryByTestId('synthetic-media')).toBeNull();
  view.rerender(<EmoteImage uri="/assets/synthetic-next.png" token="[bili:melon]" size={28} />);
  expect(view.getByTestId('synthetic-media').props.uri).toBe('/assets/synthetic-next.png');
  expect(StyleSheet.flatten(view.getByTestId('synthetic-media').props.style)).toMatchObject({ width: 28, height: 28 });
});

test('a revoked conversation removes a standalone custom image and its preview entry', async () => {
  const view = row(sticker);
  expect(view.getByRole('button', { name: '预览自定义表情' })).toBeTruthy();
  await act(async () => useWorkspace.setState({ conversations: {} }));
  expect(view.queryByTestId('synthetic-media')).toBeNull();
  expect(view.queryByRole('button', { name: '预览自定义表情' })).toBeNull();
  expect(view.getByText(token)).toBeTruthy();
});

test.each([
  { maxWidth: 208, height: 640, width: 900, imageHeight: 1600 },
  { maxWidth: 240, height: 640, width: 1600, imageHeight: 900 },
  { maxWidth: 720, height: 320, width: 400, imageHeight: 400 },
  { maxWidth: 100, height: 240, width: 10000, imageHeight: 10 },
])('media fits a $maxWidth-wide by $height-high available window without distorting its ratio', fixture => {
  for (const kind of ['image', 'emote'] as const) {
    const size = messageMediaSize(fixture.maxWidth, fixture.height, kind, { width: fixture.width, height: fixture.imageHeight });
    expect(size.width).toBeLessThanOrEqual(fixture.maxWidth);
    expect(size.height).toBeLessThanOrEqual(fixture.height * 0.5);
    expect(size.width / size.height).toBeCloseTo(fixture.width / fixture.imageHeight);
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
  }
});

test('image loading preserves scoped authorization, natural aspect, preview and the original reply/retry controls', async () => {
  mockDimensions = { width: 320, height: 640, scale: 1, fontScale: 2 };
  const onPreview = jest.fn(); const locate = jest.fn(); const retry = jest.fn();
  const message = { ...photo, replyToMessageId: 'synthetic-original', status: 'failed' as const, error: '合成发送失败' };
  const view = row(message, { onPreview, locate, retry });
  await waitFor(() => expect(view.getByRole('button', { name: `预览图片 ${image.fileName}` })).toBeTruthy());
  const body = StyleSheet.flatten(view.getByTestId(`message-body-${message.id}`).props.style);
  expect(body.padding).toBe(0);
  expect(body.backgroundColor).toBeUndefined();
  expect(attachmentPreviewUri).toHaveBeenCalledWith(image, { accountKey: 'synthetic-account', conversationId: photo.conversationId, topicId: undefined, messageId: photo.id });
  const media = view.getByTestId('synthetic-media');
  fireEvent(media, 'load', { width: 600, height: 1200 });
  const size = StyleSheet.flatten(view.getByTestId('synthetic-media').props.style);
  expect(size.width / size.height).toBeCloseTo(0.5);
  expect(size.width).toBeLessThanOrEqual(288 * 0.96);
  expect(size.height).toBeLessThanOrEqual(320);
  const preview = view.getByRole('button', { name: `预览图片 ${image.fileName}` });
  fireEvent(preview, 'longPress');
  expect(onPreview).not.toHaveBeenCalled();
  expect(view.getByRole('button', { name: '更多' })).toBeTruthy();
  fireEvent.press(preview);
  expect(onPreview).toHaveBeenCalledWith(image);
  fireEvent.press(view.getByRole('button', { name: '定位原消息' }));
  expect(locate).toHaveBeenCalledWith('synthetic-original');
  fireEvent.press(view.getByRole('button', { name: '重试发送' }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(view.getByText('合成发送失败')).toBeTruthy();
  const footer = view.getByRole('text', { name: /^消息操作，/ });
  expect(footer.props.accessibilityActions.map((action: { name: string }) => action.name)).toEqual(['copy', 'more']);
});

test('a preview failure returns to the authorized file action and a revoked scope removes rendered image content', async () => {
  const view = row(photo);
  await waitFor(() => expect(view.getByTestId('synthetic-media')).toBeTruthy());
  fireEvent(view.getByTestId('synthetic-media'), 'error');
  expect(view.getByRole('button', { name: `保存文件${image.fileName}到设备` })).toBeTruthy();
  view.unmount();
  const active = row(photo);
  await waitFor(() => expect(active.getByRole('button', { name: `预览图片 ${image.fileName}` })).toBeTruthy());
  jest.mocked(canPreviewAttachment).mockReturnValue(false);
  await act(async () => useWorkspace.getState().reset());
  expect(active.queryByTestId('synthetic-media')).toBeNull();
  expect(active.queryByRole('button', { name: `预览图片 ${image.fileName}` })).toBeNull();
});

test.each([true, false])('a caption and image share one message while only the caption has a bubble (own=%s)', async own => {
  mockDimensions = { width: 320, height: 640, scale: 1, fontScale: 1 };
  const caption = '普通文件附言发送的合成图片';
  const message: Message = { ...photo, authorId: own ? syntheticSelf.id : 'synthetic-other', authorAvatarUrl: undefined, plainText: caption, blocks: [{ type: 'text', text: caption }, ...photo.blocks] };
  const onPreview = jest.fn(); const onReply = jest.fn();
  const view = row(message, { onPreview, onReply });
  await waitFor(() => expect(view.getByRole('button', { name: `预览图片 ${image.fileName}` })).toBeTruthy());
  const body = view.getByTestId(`message-body-${message.id}`);
  expect(StyleSheet.flatten(body.props.style)).toMatchObject({ padding: 0 });
  expect(StyleSheet.flatten(body.props.style).backgroundColor).toBeUndefined();
  const textSegment = view.getByTestId(`message-text-segment-${message.id}-0`);
  expect(within(textSegment).getByText(caption)).toBeTruthy();
  expect(within(textSegment).queryByTestId('synthetic-media')).toBeNull();
  expect(StyleSheet.flatten(textSegment.props.style)).toMatchObject({ padding: 12, borderRadius: resolveTheme('light').radius.bubble, backgroundColor: own ? resolveTheme('light').sharedSoft : resolveTheme('light').surface });
  const preview = view.getByRole('button', { name: `预览图片 ${image.fileName}` });
  const imageStyle = StyleSheet.flatten(within(preview).getByTestId('synthetic-media').props.style);
  expect(imageStyle.width).toBeCloseTo((320 - 32) * 0.96 - (own ? 0 : 36));
  expect(StyleSheet.flatten(preview.props.style).backgroundColor).toBeUndefined();
  expect(StyleSheet.flatten(preview.props.style).padding).toBeUndefined();
  expect(view.getAllByTestId(`message-body-${message.id}`)).toHaveLength(1);
  expect(view.getAllByRole('text', { name: /^消息操作，/ })).toHaveLength(1);
  fireEvent(body, 'longPress');
  expect(view.getByRole('button', { name: '更多' })).toBeTruthy();
  fireEvent(preview, 'longPress');
  expect(onPreview).not.toHaveBeenCalled();
  fireEvent.press(preview);
  expect(onPreview).toHaveBeenCalledWith(image);
  fireEvent(preview, 'accessibilityAction', { nativeEvent: { actionName: 'reply' } });
  expect(onReply).toHaveBeenCalledWith(message);
  fireEvent(preview, 'accessibilityAction', { nativeEvent: { actionName: 'more' } });
  expect(view.getByRole('button', { name: '仅自己隐藏' })).toBeTruthy();
});

test('alternating images and text retain their original order, grouped text bubbles and small inline emotes', async () => {
  const secondImage = { ...image, id: 'synthetic-second-image', fileName: 'synthetic-landscape.png' };
  const message: Message = {
    ...photo, attachments: [image, secondImage],
    blocks: [
      { type: 'text', text: '图片之前' }, { type: 'mention', userId: 'synthetic-other', label: '另一成员' },
      { type: 'text', text: '同一段文字' }, photo.blocks[0]!,
      { type: 'text', text: `图片之间 ${token}` }, { type: 'emoji', shortcode: 'emoji:smile' },
      { type: 'attachment', attachmentId: secondImage.id }, { type: 'text', text: '图片之后' },
    ],
  };
  const view = row(message);
  await waitFor(() => expect(view.getByRole('button', { name: `预览图片 ${secondImage.fileName}` })).toBeTruthy());
  const firstSegment = view.getByTestId(`message-text-segment-${message.id}-0`);
  expect(within(firstSegment).getByText('图片之前')).toBeTruthy();
  expect(within(firstSegment).getByText('@另一成员')).toBeTruthy();
  expect(within(firstSegment).getByText('同一段文字')).toBeTruthy();
  const middleSegment = view.getByTestId(`message-text-segment-${message.id}-4`);
  expect(within(middleSegment).getByText('图片之间 ')).toBeTruthy();
  expect(within(middleSegment).getByText('😄')).toBeTruthy();
  expect(StyleSheet.flatten(within(middleSegment).getByTestId('synthetic-media').props.style)).toMatchObject({ width: 28, height: 28 });
  expect(within(view.getByTestId(`message-text-segment-${message.id}-7`)).getByText('图片之后')).toBeTruthy();
  const mediaOrder = view.getAllByRole('button', { name: /^预览图片 / }).map(item => item.props.accessibilityLabel);
  expect(mediaOrder).toEqual([`预览图片 ${image.fileName}`, `预览图片 ${secondImage.fileName}`]);
  expect(view.queryByRole('button', { name: '预览自定义表情' })).toBeNull();
  expect(view.queryAllByTestId(new RegExp(`^message-text-segment-${message.id}-`))).toHaveLength(3);
  expect(view.getAllByRole('text', { name: /^消息操作，/ })).toHaveLength(1);
});

test('a mixed message keeps its separate reply, reaction, sending and failed retry controls', async () => {
  const locate = jest.fn(); const retry = jest.fn();
  const message: Message = { ...photo, plainText: '合成附言', blocks: [{ type: 'text', text: '合成附言' }, ...photo.blocks], replyToMessageId: 'synthetic-original', reactions: [{ emoteKey: 'emoji:heart', count: 2, reactedByCurrentUser: false }], status: 'sending' };
  const element = (item: Message) => <SafeAreaProvider initialMetrics={metrics}><MessageRow message={item} retry={retry} download={jest.fn()} locate={locate} /></SafeAreaProvider>;
  useWorkspace.getState().setMessages(message.conversationId, [message]);
  const view = render(element(message));
  await waitFor(() => expect(view.getByRole('button', { name: `预览图片 ${image.fileName}` })).toBeTruthy());
  const reply = view.getByRole('button', { name: '定位原消息' });
  expect(StyleSheet.flatten(reply.props.style)).toMatchObject({ padding: 8, borderRadius: resolveTheme('light').radius.control, backgroundColor: resolveTheme('light').soft });
  fireEvent.press(reply);
  expect(locate).toHaveBeenCalledWith('synthetic-original');
  expect(view.getByText('发送中…')).toBeTruthy();
  expect(view.getByRole('button', { name: 'emoji:heart 2' })).toBeDisabled();
  view.rerender(element({ ...message, status: 'failed', error: '合成附言发送失败' }));
  expect(view.queryByText('发送中…')).toBeNull();
  expect(view.getByText('合成附言发送失败')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '重试发送' }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(view.getAllByRole('text', { name: /^消息操作，/ })).toHaveLength(1);
});

test('a non-image file and caption keep the regular shared text bubble', () => {
  const file: Attachment = { ...image, id: 'synthetic-document', fileName: 'synthetic-document.txt', mimeType: 'text/plain' };
  const message: Message = { ...original, attachments: [file], blocks: [{ type: 'text', text: '普通文件附言' }, { type: 'attachment', attachmentId: file.id }] };
  const view = row(message);
  expect(StyleSheet.flatten(view.getByTestId(`message-body-${message.id}`).props.style)).toMatchObject({ padding: 12, borderRadius: resolveTheme('light').radius.bubble, backgroundColor: resolveTheme('light').sharedSoft });
  expect(view.getByText('普通文件附言')).toBeTruthy();
  expect(view.getByRole('button', { name: `保存文件${file.fileName}到设备` })).toBeEnabled();
  expect(view.queryByTestId('synthetic-media')).toBeNull();
  expect(view.queryAllByTestId(/^message-text-segment-/)).toHaveLength(0);
  expect(attachmentPreviewUri).not.toHaveBeenCalled();
});

test('fallback and denied mixed attachments never load or expose an image preview', async () => {
  const message: Message = { ...photo, plainText: '安全降级附言', blocks: [{ type: 'text', text: '安全降级附言' }, ...photo.blocks] };
  const fallback = row({ ...message, fallback: true });
  expect(fallback.getByText('安全降级附言')).toBeTruthy();
  expect(fallback.getByText('部分内容暂不支持，可在“我的”检查更新。')).toBeTruthy();
  expect(StyleSheet.flatten(fallback.getByTestId(`message-body-${message.id}`).props.style)).toMatchObject({ padding: 12, backgroundColor: resolveTheme('light').sharedSoft });
  expect(fallback.queryByRole('button', { name: /^预览图片 / })).toBeNull();
  expect(fallback.queryByTestId('synthetic-media')).toBeNull();
  expect(attachmentPreviewUri).not.toHaveBeenCalled();
  fallback.unmount();
  jest.mocked(canPreviewAttachment).mockReturnValue(false);
  const deniedImage = { ...image, capabilities: { canDownload: false } };
  const denied = row({ ...message, attachments: [deniedImage] });
  await waitFor(() => expect(denied.getByRole('button', { name: `保存文件${image.fileName}到设备` })).toBeDisabled());
  expect(within(denied.getByTestId(`message-text-segment-${message.id}-0`)).getByText('安全降级附言')).toBeTruthy();
  expect(denied.queryByRole('button', { name: /^预览图片 / })).toBeNull();
  expect(denied.queryByTestId('synthetic-media')).toBeNull();
  expect(attachmentPreviewUri).not.toHaveBeenCalled();
});
