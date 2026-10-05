const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');

function resolveVersion(overrides) {
  const directory = mkdtempSync(join(tmpdir(), 'duallane-version-'));
  const output = join(directory, 'env');
  try {
    const result = spawnSync(process.execPath, [join(__dirname, '../scripts/resolve-android-version.mjs')], {
      env: { ...process.env, GITHUB_REF: 'refs/heads/candidate', GITHUB_REF_NAME: 'candidate',
        GITHUB_RUN_NUMBER: '3', INPUT_APP_VERSION: '', INPUT_VERSION_CODE: '', GITHUB_ENV: output, ...overrides },
      encoding: 'utf8',
    });
    assert.ifError(result.error);
    return { status: result.status, output: result.status === 0 ? readFileSync(output, 'utf8') : '' };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('tag builds preserve SemVer and use the run number', () => {
  assert.deepEqual(resolveVersion({ GITHUB_REF: 'refs/tags/v0.2.2', GITHUB_REF_NAME: 'v0.2.2',
    INPUT_APP_VERSION: '9.9.9', INPUT_VERSION_CODE: '9' }), {
    status: 0, output: 'DUALLANE_APP_VERSION=0.2.2\nDUALLANE_ANDROID_VERSION_CODE=3\n',
  });
});

test('manual candidate builds require a version and accept an explicit upgrade code', () => {
  assert.deepEqual(resolveVersion({ INPUT_APP_VERSION: '0.2.2', INPUT_VERSION_CODE: '4' }), {
    status: 0, output: 'DUALLANE_APP_VERSION=0.2.2\nDUALLANE_ANDROID_VERSION_CODE=4\n',
  });
  assert.equal(resolveVersion({}).status, 1);
});

test('malformed versions and invalid Android codes cannot reach the environment file', () => {
  for (const version of ['01.2.3', '1x2x3', '1.2.3-beta', '1.2.3\nINJECTED=value']) {
    assert.equal(resolveVersion({ INPUT_APP_VERSION: version }).status, 1, version);
  }
  for (const code of ['0', '-1', '01', '1.5', '2100000001', '3\nINJECTED=value']) {
    assert.equal(resolveVersion({ INPUT_APP_VERSION: '0.2.2', INPUT_VERSION_CODE: code }).status, 1, code);
  }
});
