import { execFileSync } from 'node:child_process';

const serialIndex = process.argv.indexOf('--serial');
const serial = serialIndex >= 0 ? process.argv[serialIndex + 1] : undefined;
if (!serial || !/^[A-Za-z0-9_.:-]+$/.test(serial)) {
  console.error('Usage: node scripts/check-android-chat-ime.mjs --serial DEVICE');
  process.exit(2);
}
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], {
  encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 20_000,
  stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  const ime = adb('shell', 'dumpsys', 'input_method');
  const windows = adb('shell', 'dumpsys', 'window', 'windows');
  const focus = adb('shell', 'dumpsys', 'window');
  const ownFocus = /mCurrentFocus=.*com\.timestarry\.duallane\//.test(focus);
  const keyboardOpen = /mInputShown=true/.test(ime) && /mIsInputViewShown=true/.test(ime);
  const fullscreenValues = [...ime.matchAll(/\bm(?:InFullscreenMode|FullscreenMode|IsFullscreen)=(true|false)\b/g)].map(match => match[1]);
  const fullscreenKnown = fullscreenValues.length > 0;
  const fullscreen = fullscreenValues.includes('true');
  // The IME surface can cover the display with a transparent top region. Its
  // visible inset, rather than the full surface frame, bounds app touch controls.
  const imeWindow = windows.match(/Window #\d+ Window\{[^\n]*\bInputMethod\}:([\s\S]*?)(?=\n\s*Window #|$)/)?.[1];
  const frame = imeWindow?.match(/Frames:.*?\bframe=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  const inset = imeWindow?.match(/mGivenVisibleInsets=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  const keyboardTopPx = frame && inset ? Number(frame[2]) + Number(inset[2]) : null;
  // Android UI Automator's FileOutputStream can target its own stdout descriptor.
  // Verified on the acceptance device: no shared/private diagnostic XML file is
  // created. Only fixed control geometry is reported, never content or drafts.
  const xml = adb('exec-out', 'uiautomator', 'dump', '/proc/self/fd/1');
  if (!xml.includes('<hierarchy') || !xml.includes('</hierarchy>')) throw new Error('Incomplete hierarchy');
  const nodes = [...xml.matchAll(/<node\b[^>]*>/g)].map(match => match[0]);
  const messageFocused = nodes.some(node => /class="android\.widget\.EditText"/.test(node)
    && /content-desc="消息"/.test(node) && /\bfocused="true"/.test(node));
  const densityText = adb('shell', 'wm', 'density');
  const densities = [...densityText.matchAll(/(?:Physical|Override) density: (\d+)/g)];
  const density = densities.length ? Number(densities.at(-1)[1]) / 160 : NaN;
  const controls = Object.fromEntries(['添加', '表情', '发送'].map(label => {
    const matches = nodes.filter(node => node.includes(`content-desc="${label}"`) && /clickable="true"/.test(node));
    const bounds = matches.length === 1 ? matches[0].match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)?.slice(1).map(Number) : undefined;
    const valid = !!bounds && Number.isFinite(density) && density > 0
      && (bounds[2] - bounds[0]) / density >= 48 && (bounds[3] - bounds[1]) / density >= 48
      && keyboardTopPx !== null && bounds[1] >= 0 && bounds[3] <= keyboardTopPx;
    return [label, { bounds: bounds ?? null, atLeast48dpAndAboveKeyboard: valid }];
  }));
  const pass = ownFocus && keyboardOpen && messageFocused && fullscreenKnown && !fullscreen
    && Object.values(controls).every(control => control.atLeast48dpAndAboveKeyboard);
  console.log(JSON.stringify({ pass, ownFocus, keyboardOpen, messageFocused, fullscreenKnown,
    fullscreen, keyboardTopPx, controls, scope: 'Current Android chat composer; read-only, no sends' }, null, 2));
  process.exitCode = pass ? 0 : 1;
} catch {
  console.error('Android chat IME probe failed; verify ADB, an open chat, and the visible keyboard.');
  process.exitCode = 1;
}
