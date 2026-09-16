const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');

test('release workflow accepts SemVer tags and rejects malformed versions', { skip: process.platform === 'win32' }, () => {
  const workflow = readFileSync(join(__dirname, '../.github/workflows/android-release.yml'), 'utf8');
  const expression = workflow.match(/\[\[ "\$version" =~ (.*?) \]\]/)?.[1];
  assert.ok(expression);
  for (const [version, valid] of [['0.1.0', true], ['12.34.56', true], ['01.2.3', false], ['1x2x3', false], ['1.2.3-beta', false]]) {
    const result = spawnSync('bash', ['-c', `version=$1; [[ "$version" =~ ${expression} ]]`, '--', version]);
    assert.ifError(result.error);
    assert.equal(result.status, valid ? 0 : 1, version);
  }
});
