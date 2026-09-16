const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { configureSigning } = require('./android-signing.cjs');

const template = `android {
    signingConfigs {
        debug { storeFile file('debug.keystore'); storePassword 'android' }
    }
    buildTypes {
        debug { signingConfig signingConfigs.debug }
        release { signingConfig signingConfigs.debug }
    }
}`;

test('prebuild preserves debug signing and uses a private release configuration', () => {
  const result = configureSigning(template);
  assert.match(result, /debug \{ signingConfig signingConfigs.debug \}/);
  assert.match(result, /release \{ signingConfig signingConfigs.release \}/);
  assert.match(result, /System.getenv\('DUALLANE_ANDROID_KEYSTORE'\)/);
  assert.match(result, /storeFile file\(System.getProperty\('user.home'\) \+ '\/.android\/debug.keystore'\)/);
  assert.equal(configureSigning(result), result);
});

test('prebuild is idempotent on the checked-in Android project', () => {
  const checkedIn = readFileSync(join(__dirname, '../android/app/build.gradle'), 'utf8');
  assert.equal(configureSigning(checkedIn), checkedIn);
});
