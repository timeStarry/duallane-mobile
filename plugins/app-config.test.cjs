const assert = require('node:assert/strict');
const { join } = require('node:path');
const { test } = require('node:test');
const { getConfig } = require('expo/config');

test('build config rejects credentials, queries and fragments in the API origin', () => {
  const previous = process.env.EXPO_PUBLIC_API_ORIGIN;
  try {
    for (const origin of ['https://user:password@example.com', 'https://example.com?secret=value', 'https://example.com#secret', 'https://example.com/api', 'https://example.com:invalid']) {
      process.env.EXPO_PUBLIC_API_ORIGIN = origin;
      assert.throws(() => getConfig(join(__dirname, '..'), { skipPlugins: true }), /API origin must/);
    }
    process.env.EXPO_PUBLIC_API_ORIGIN = 'https://workspace.example.com:8443';
    assert.equal(getConfig(join(__dirname, '..'), { skipPlugins: true }).exp.extra.apiOrigin, process.env.EXPO_PUBLIC_API_ORIGIN);
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_API_ORIGIN;
    else process.env.EXPO_PUBLIC_API_ORIGIN = previous;
  }
});
