const { withMainApplication } = require('expo/config-plugins');

const BLOCKS = [
  {
    anchor: 'class MainApplication : Application(), ReactApplication {\n',
    name: 'state',
    body: '  private var duallaneFontScale: Float? = null\n',
  },
  {
    anchor: '  override fun onCreate() {\n    super.onCreate()\n',
    name: 'initial',
    body: '    duallaneFontScale = resources.configuration.fontScale\n',
  },
  {
    anchor: '  override fun onConfigurationChanged(newConfig: Configuration) {\n    super.onConfigurationChanged(newConfig)\n    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)\n',
    name: 'change',
    body: '    val previousFontScale = duallaneFontScale\n' +
      '    duallaneFontScale = newConfig.fontScale\n' +
      '    if (previousFontScale != null && previousFontScale != newConfig.fontScale) {\n' +
      '      // RN 0.81 retains text measurements across Activity recreation.\n' +
      '      reactHost.reload("duallane_font_scale_changed")\n' +
      '    }\n',
  },
].map(block => {
  const indent = block.name === 'state' ? '  ' : '    ';
  return { ...block, text: `${indent}// @generated begin duallane-font-scale-${block.name}\n${block.body}${indent}// @generated end duallane-font-scale-${block.name}\n` };
});

function count(contents, needle) {
  return contents.split(needle).length - 1;
}

function fail(detail) {
  throw new Error(`android-font-scale: unsupported MainApplication Kotlin template (${detail})`);
}

function installInMainApplication(contents) {
  const newline = contents.includes('\r\n') ? '\r\n' : '\n';
  let result = contents.replace(/\r\n/g, '\n');
  const hasGenerated = result.includes('duallane-font-scale-');
  if (hasGenerated) {
    for (const block of BLOCKS) {
      if (count(result, block.text) !== 1) fail(`incomplete or modified ${block.name} block`);
      result = result.replace(block.text, '');
    }
  }
  if (result.includes('duallaneFontScale') || result.includes('duallane-font-scale-')) {
    fail('conflicting font-scale implementation');
  }
  if (count(result, 'import android.content.res.Configuration\n') !== 1 ||
      count(result, '  override val reactHost: ReactHost\n') !== 1) {
    fail('missing Configuration import or public ReactHost property');
  }
  for (const block of BLOCKS) {
    if (count(result, block.anchor) !== 1) fail(`missing or ambiguous ${block.name} anchor`);
  }
  for (const block of BLOCKS) result = result.replace(block.anchor, block.anchor + block.text);
  return newline === '\r\n' ? result.replace(/\n/g, '\r\n') : result;
}

module.exports = function withAndroidFontScale(config) {
  return withMainApplication(config, mod => {
    if (mod.modResults.language !== 'kt') fail('Kotlin is required');
    mod.modResults.contents = installInMainApplication(mod.modResults.contents);
    return mod;
  });
};

module.exports.installInMainApplication = installInMainApplication;
