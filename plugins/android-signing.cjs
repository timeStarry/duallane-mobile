const { withAppBuildGradle } = require('@expo/config-plugins');
module.exports = config => withAppBuildGradle(config, mod => {
  // Read signing secrets only at Gradle execution, never write them into generated source.
  mod.modResults.contents = mod.modResults.contents.replace('signingConfigs {', `signingConfigs {
        release {
            if (System.getenv('DUALLANE_ANDROID_KEYSTORE')) {
                storeFile file(System.getenv('DUALLANE_ANDROID_KEYSTORE'))
                storePassword System.getenv('DUALLANE_ANDROID_STORE_PASSWORD')
                keyAlias System.getenv('DUALLANE_ANDROID_KEY_ALIAS')
                keyPassword System.getenv('DUALLANE_ANDROID_KEY_PASSWORD')
            }
        }`);
  mod.modResults.contents = mod.modResults.contents.replace(/(release\s*\{[\s\S]*?)signingConfig signingConfigs.debug/, '$1signingConfig signingConfigs.release');
  return mod;
});
