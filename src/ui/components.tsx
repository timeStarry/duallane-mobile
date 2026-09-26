import { StyleSheet } from 'react-native';
export { Label, Button, IconButton, Input, Notice, InlineFeedback, Loading, Empty, EmptyState, SegmentedControl, SettingRow, SettingGroup, UnreadBadge, ConnectionBanner, Dialog, ObjectActionSheet } from './primitives';
export { CatalogEmoteGrid } from './CatalogEmoteGrid';
export { AppHeader, Avatar, ConversationRow, TopicRow, conversationIdentity } from './chrome';
export { DualLaneTabBar } from './tabBar';
export { MessageRow } from './message';
export { messageActions } from '../domain/message-actions';
export { SwitchRow, Select, PageState } from './controls';
export { FileRow, AttachmentPreview, TransferItem } from './files';
export { Composer, ReplyPreview } from './composer';
export { EmoteImage, MessageContent, ReactionGlyph } from './MessageContent';
export { MemberRow } from './members';

export const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 16, gap: 12 },
  row: { paddingHorizontal: 16, paddingVertical: 14, minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  title: { fontSize: 17, fontWeight: '600' },
  section: { fontSize: 20, fontWeight: '600', paddingBottom: 8 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
