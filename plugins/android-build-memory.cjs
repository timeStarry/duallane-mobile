const { withGradleProperties } = require('expo/config-plugins');

module.exports = config => withGradleProperties(config, mod => {
  // Release lint loads every native dependency; Expo's 512 MiB metaspace limit is insufficient.
  const property = mod.modResults.find(item => item.type === 'property' && item.key === 'org.gradle.jvmargs');
  const value = (property?.value ?? '-Xmx2048m').replace(/(?:^|\s)-XX:MaxMetaspaceSize=\S+/g, '').trim();
  const configured = `${value} -XX:MaxMetaspaceSize=1536m`;
  if (property) property.value = configured;
  else mod.modResults.push({ type: 'property', key: 'org.gradle.jvmargs', value: configured });
  return mod;
});
