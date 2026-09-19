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
});

test('mention suggestions dismiss the keyboard and close when the query is empty', () => {
  expect(applyMentionSuggestions(2, 'none')).toEqual({ dismissKeyboard: true, nextPanel: 'mention' });
  expect(applyMentionSuggestions(1, 'emoji')).toEqual({ dismissKeyboard: true, nextPanel: 'mention' });
  expect(applyMentionSuggestions(0, 'mention')).toEqual({ dismissKeyboard: false, nextPanel: 'none' });
  expect(applyMentionSuggestions(0, 'attach')).toEqual({ dismissKeyboard: false, nextPanel: 'attach' });
});

test('last IME height is clamped between 260dp and half the screen', () => {
  expect(clampImeHeight(100, 800)).toBe(260);
  expect(clampImeHeight(300, 800)).toBe(300);
  expect(clampImeHeight(900, 800)).toBe(400);
});
