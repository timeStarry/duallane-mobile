const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const withBuildMemory = require('./android-build-memory.cjs');

async function configure(properties) {
  const config = withBuildMemory({ name: 'memory-fixture', slug: 'memory-fixture' });
  return (await config.mods.android.gradleProperties({ modResults: structuredClone(properties), modRequest: {} })).modResults;
}

async function configureArgs(value) {
  const result = await configure([{ type: 'property', key: 'org.gradle.jvmargs', value }]);
  return result[0].value;
}

test('native debug metadata merge receives at least 4 GiB heap while retaining JVM options', async () => {
  assert.equal(await configureArgs('-Xmx2048m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8 -XX:+HeapDumpOnOutOfMemoryError'),
    '-Xmx4096m -XX:MaxMetaspaceSize=1536m -Dfile.encoding=UTF-8 -XX:+HeapDumpOnOutOfMemoryError');
});

test('missing heap or JVM property receives the release memory defaults', async () => {
  assert.equal(await configureArgs('-Dfile.encoding=UTF-8'), '-Dfile.encoding=UTF-8 -Xmx4096m -XX:MaxMetaspaceSize=1536m');
  assert.deepEqual(await configure([]), [{ type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx4096m -XX:MaxMetaspaceSize=1536m' }]);
});

test('configured heap and metaspace at or above the floors are preserved in JVM size units', async () => {
  for (const heap of ['4g', '6G', '8192m', '8388608K', '8589934592']) {
    const args = `-Xmx${heap} -XX:MaxMetaspaceSize=2g -Dcustom.option=retained`;
    assert.equal(await configureArgs(args), args);
  }
  for (const heap of ['2g', '2097152k', '2147483648']) {
    assert.equal(await configureArgs(`-Xmx${heap} -XX:MaxMetaspaceSize=1536m`), '-Xmx4096m -XX:MaxMetaspaceSize=1536m');
  }
});

test('repeated prebuild preserves unrelated properties and does not duplicate memory arguments', async () => {
  const input = [{ type: 'comment', value: 'keep comment' },
    { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx2048m -XX:MaxMetaspaceSize=512m -Dcustom.option=retained' },
    { type: 'property', key: 'reactNativeArchitectures', value: 'armeabi-v7a,arm64-v8a,x86,x86_64' }];
  const first = await configure(input);
  assert.deepEqual(await configure(first), first);
  assert.deepEqual(first[0], input[0]);
  assert.deepEqual(first[2], input[2]);
  assert.equal(first[1].value.match(/-Xmx/g).length, 1);
  assert.equal(first[1].value.match(/-XX:MaxMetaspaceSize=/g).length, 1);
});

test('checked-in Gradle memory is already the idempotent 4 GiB release default', async () => {
  const properties = readFileSync(join(__dirname, '../android/gradle.properties'), 'utf8');
  const value = properties.match(/^org\.gradle\.jvmargs=(.+)$/m)[1].trim();
  assert.match(value, /(?:^|\s)-Xmx4096m(?:\s|$)/);
  assert.equal(await configureArgs(value), value);
});
