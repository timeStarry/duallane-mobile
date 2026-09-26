import { applyMentionSuggestions, clampImeHeight, composerDock } from '../src/ui/composerDock';

test('chat dock never stacks nav inset on ime height', () => {
  expect(composerDock({ keyboardVisible: true, panel: 'none', imeBottom: 320, lastImeHeight: 320, navBarInset: 24 })).toEqual({
    panelHeight: 0,
    dockBottom: 320,
  });
  expect(composerDock({ keyboardVisible: false, panel: 'emoji', imeBottom: 0, lastImeHeight: 320, navBarInset: 24 })).toEqual({
    panelHeight: 320,
    dockBottom: 0,
  });
  expect(composerDock({ keyboardVisible: false, panel: 'none', imeBottom: 0, lastImeHeight: 320, navBarInset: 24 })).toEqual({
    panelHeight: 0,
    dockBottom: 24,
  });
  expect(composerDock({ keyboardVisible: true, panel: 'emoji', imeBottom: 320, lastImeHeight: 280, navBarInset: 24 })).toEqual({
    panelHeight: 0,
    dockBottom: 320,
  });
  expect(composerDock({ keyboardVisible: true, panel: 'mention', imeBottom: 320, lastImeHeight: 280, navBarInset: 24 })).toEqual({
    panelHeight: 168,
    dockBottom: 320,
  });
});

test('mention suggestions retain the keyboard and close when the query is empty', () => {
  expect(applyMentionSuggestions({ suggestionCount: 2, current: 'none', mentionDismissed: false })).toEqual({ nextPanel: 'mention' });
  expect(applyMentionSuggestions({ suggestionCount: 1, current: 'emoji', mentionDismissed: false })).toEqual({ nextPanel: 'mention' });
  expect(applyMentionSuggestions({ suggestionCount: 0, current: 'mention', mentionDismissed: false })).toEqual({ nextPanel: 'none' });
  expect(applyMentionSuggestions({ suggestionCount: 0, current: 'attach', mentionDismissed: false })).toEqual({ nextPanel: 'attach' });
});

test('closing mention suggestions does not reopen them until the query changes', () => {
  expect(applyMentionSuggestions({ suggestionCount: 3, current: 'none', mentionDismissed: true })).toEqual({ nextPanel: 'none' });
  expect(applyMentionSuggestions({ suggestionCount: 3, current: 'emoji', mentionDismissed: true })).toEqual({ nextPanel: 'emoji' });
});

test('last IME height is clamped between 260dp and half the screen', () => {
  expect(clampImeHeight(100, 800)).toBe(260);
  expect(clampImeHeight(300, 800)).toBe(300);
  expect(clampImeHeight(900, 800)).toBe(400);
});
