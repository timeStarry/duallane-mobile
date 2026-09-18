import { clampImeHeight, composerDock } from '../src/ui/composerDock';

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
  expect(composerDock({ keyboardVisible: true, panel: 'emoji', imeBottom: 320, lastImeHeight: 280, navBarInset: 24 }).panelHeight).toBe(280);
});

test('last IME height is clamped between 260dp and half the screen', () => {
  expect(clampImeHeight(100, 800)).toBe(260);
  expect(clampImeHeight(300, 800)).toBe(300);
  expect(clampImeHeight(900, 800)).toBe(400);
});
