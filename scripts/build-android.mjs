import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const result=spawnSync(process.execPath,[require.resolve('expo/bin/cli'),'prebuild','--platform','android','--no-install'],{stdio:'inherit'});
if(result.error) console.error(result.error.message);
if(result.status!==0)process.exit(result.status??1);
console.log('Android project generated. Run ./gradlew assembleRelease or bundleRelease with a private keystore.');
