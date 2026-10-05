const { withAndroidManifest, withMainApplication } = require('expo/config-plugins');

const BASE_CONFIG_CHANGES = ['keyboard', 'keyboardHidden', 'orientation', 'screenSize', 'screenLayout', 'uiMode'];

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

function configureMainActivity(manifest) {
  const applications = manifest?.manifest?.application;
  if (!Array.isArray(applications) || applications.length !== 1 ||
      !['.MainApplication', 'com.timestarry.duallane.MainApplication'].includes(applications[0].$?.['android:name'])) {
    fail('missing or ambiguous MainApplication manifest entry');
  }
  const activities = applications[0].activity;
  const main = Array.isArray(activities) ? activities.filter(activity =>
    ['.MainActivity', 'com.timestarry.duallane.MainActivity'].includes(activity.$?.['android:name'])) : [];
  if (main.length !== 1) fail('missing or ambiguous MainActivity manifest entry');
  const value = main[0].$['android:configChanges'];
  const changes = typeof value === 'string' ? value.split('|') : [];
  if (new Set(changes).size !== changes.length ||
      BASE_CONFIG_CHANGES.some(change => !changes.includes(change)) ||
      changes.some(change => !BASE_CONFIG_CHANGES.includes(change) && change !== 'fontScale')) {
    fail('unsupported MainActivity configChanges');
  }
  // Keep one font-change owner: do not recreate the Activity while ReactHost reloads.
  if (!changes.includes('fontScale')) main[0].$['android:configChanges'] = [...changes, 'fontScale'].join('|');
  return manifest;
}

module.exports = function withAndroidFontScale(config) {
  config = withMainApplication(config, mod => {
    if (mod.modResults.language !== 'kt') fail('Kotlin is required');
    mod.modResults.contents = installInMainApplication(mod.modResults.contents);
    return mod;
  });
  return withAndroidManifest(config, mod => {
    mod.modResults = configureMainActivity(mod.modResults);
    return mod;
  });
};

module.exports.installInMainApplication = installInMainApplication;
module.exports.configureMainActivity = configureMainActivity;
