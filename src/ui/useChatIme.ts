import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, useWindowDimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  AndroidSoftInputModes,
  KeyboardController,
  useKeyboardController,
  useKeyboardState,
} from 'react-native-keyboard-controller';
import { applyMentionSuggestions, clampImeHeight, composerDock, type ComposerPanel } from './composerDock';

export function useChatIme(navBarInset: number, mentionCount = 0, mentionQuery = '') {
  const { setEnabled } = useKeyboardController();
  const keyboardVisible = useKeyboardState(state => state.isVisible);
  const imeBottom = useKeyboardState(state => state.height);
  const { height: screenHeight } = useWindowDimensions();
  const [panel, setPanel] = useState<ComposerPanel>('none');
  const mentionDismissed = useRef(false);
  const lastQuery = useRef(mentionQuery);
  const lastImeHeight = useRef(clampImeHeight(0, screenHeight));
  if (mentionQuery !== lastQuery.current) {
    lastQuery.current = mentionQuery;
    mentionDismissed.current = false;
  }

  useFocusEffect(useCallback(() => {
    setEnabled(true);
    KeyboardController.setInputMode(AndroidSoftInputModes.SOFT_INPUT_ADJUST_NOTHING);
    return () => {
      setEnabled(false);
      KeyboardController.setDefaultMode();
      setPanel('none');
    };
  }, [setEnabled]));

  useEffect(() => {
    if (imeBottom > 0) lastImeHeight.current = clampImeHeight(imeBottom, screenHeight);
  }, [imeBottom, screenHeight]);

  useEffect(() => {
    const next = applyMentionSuggestions({ suggestionCount: mentionCount, current: panel, mentionDismissed: mentionDismissed.current });
    if (next.dismissKeyboard) Keyboard.dismiss();
    if (next.nextPanel !== panel) setPanel(next.nextPanel);
  }, [mentionCount, panel]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (panel !== 'none') {
        if (panel === 'mention') mentionDismissed.current = true;
        setPanel('none');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [panel]);

  const dock = composerDock({
    keyboardVisible,
    panel,
    imeBottom: keyboardVisible ? imeBottom : 0,
    lastImeHeight: lastImeHeight.current,
    navBarInset,
  });

  const openPanel = (next: ComposerPanel) => {
    Keyboard.dismiss();
    setPanel(current => (current === next ? 'none' : next));
  };

  return {
    panel,
    dock,
    openPanel,
    closePanel: () => {
      if (panel === 'mention') mentionDismissed.current = true;
      setPanel('none');
    },
    setPanel,
  };
}
