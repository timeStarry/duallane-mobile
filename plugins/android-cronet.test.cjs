const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { addGradleDependencies, installInMainApplication } = require('./android-cronet.cjs');

const gradle = `dependencies {
    implementation("com.facebook.react:react-android")
    implementation("com.facebook.react:hermes-android")
}`;

const main = `class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
`;

test('prebuild adds embedded Cronet dependencies once', () => {
  const result = addGradleDependencies(gradle);
  assert.match(result, /cronet-embedded:143\.7445\.0/);
  assert.match(result, /cronet-okhttp:0\.1\.1/);
  assert.equal(addGradleDependencies(result), result);
});

test('prebuild installs Cronet before React Native starts', () => {
  const result = installInMainApplication(main);
  assert.match(result, /super\.onCreate\(\)\n    CronetNetworking\.install\(this\)/);
  assert.ok(result.indexOf('CronetNetworking.install(this)') < result.indexOf('loadReactNative(this)'));
  assert.equal(installInMainApplication(result), result);
});

test('prebuild is idempotent on the checked-in Android project', () => {
  const gradleFile = readFileSync(join(__dirname, '../android/app/build.gradle'), 'utf8');
  const mainFile = readFileSync(join(__dirname, '../android/app/src/main/java/com/timestarry/duallane/MainApplication.kt'), 'utf8');
  assert.equal(addGradleDependencies(gradleFile), gradleFile);
  assert.equal(installInMainApplication(mainFile), mainFile);
});
