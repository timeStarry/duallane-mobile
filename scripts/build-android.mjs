import { spawnSync } from 'node:child_process';
const result=spawnSync('npx',['expo','prebuild','--platform','android','--no-install'],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status??1);
console.log('Android project generated. Run ./gradlew assembleRelease or bundleRelease with a private keystore.');
