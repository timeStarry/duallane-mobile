const { withGradleProperties } = require('expo/config-plugins');

function withMinimumSize(value, option, minimumMiB) {
  let found = false;
  const configured = value.replace(new RegExp(`(^|\\s)${option}(\\d+)([kKmMgG]?)(?=\\s|$)`, 'g'), (match, space, amount, unit) => {
    found = true;
    const multiplier = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[unit.toLowerCase()];
    return Number(amount) * multiplier >= minimumMiB * 1024 ** 2 ? match : `${space}${option}${minimumMiB}m`;
  });
  return found ? configured : `${configured} ${option}${minimumMiB}m`.trim();
}

module.exports = config => withGradleProperties(config, mod => {
  // Four-ABI native symbol merging exhausted 2 GiB heap; release lint also needs extra metaspace.
  const property = mod.modResults.find(item => item.type === 'property' && item.key === 'org.gradle.jvmargs');
  const value = withMinimumSize((property?.value ?? '').trim(), '-Xmx', 4096);
  const configured = withMinimumSize(value, '-XX:MaxMetaspaceSize=', 1536);
  if (property) property.value = configured;
  else mod.modResults.push({ type: 'property', key: 'org.gradle.jvmargs', value: configured });
  return mod;
});
