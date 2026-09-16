const { withAppBuildGradle } = require('expo/config-plugins');

function configureSigning(contents) {
  // AGP creates the default local debug key; fresh checkouts contain no keystore.
  contents = contents.replace("storeFile file('debug.keystore')", "storeFile file(System.getProperty('user.home') + '/.android/debug.keystore')");
  const releaseBuild = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.(?:debug|release)/;
  if (!releaseBuild.test(contents)) throw new Error('Cannot find Android release signing configuration');
  contents = contents.replace(releaseBuild, '$1signingConfig signingConfigs.release');
  // Read signing secrets only at Gradle execution, never write them into generated source.
  if (!/signingConfigs\s*\{\s*release\s*\{/.test(contents)) {
    contents = contents.replace('signingConfigs {', `signingConfigs {
        release {
            if (System.getenv('DUALLANE_ANDROID_KEYSTORE')) {
                storeFile file(System.getenv('DUALLANE_ANDROID_KEYSTORE'))
                storePassword System.getenv('DUALLANE_ANDROID_STORE_PASSWORD')
                keyAlias System.getenv('DUALLANE_ANDROID_KEY_ALIAS')
                keyPassword System.getenv('DUALLANE_ANDROID_KEY_PASSWORD')
            }
        }`);
  }
  return contents;
}

module.exports = config => withAppBuildGradle(config, mod => {
  mod.modResults.contents = configureSigning(mod.modResults.contents);
  return mod;
});
module.exports.configureSigning = configureSigning;
