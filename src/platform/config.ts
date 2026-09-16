import Constants from 'expo-constants';
import { z } from 'zod';
const configSchema=z.object({environment:z.enum(['development','test','production']),apiOrigin:z.string(),channel:z.literal('internal')});
export const config=configSchema.parse(Constants.expoConfig?.extra);
export const installed={appVersion:Constants.nativeAppVersion ?? '0.1.0',versionCode:Number(Constants.nativeBuildVersion ?? 1)};
export const redirectUri='com.timestarry.duallane://oauth';
export function validateOrigin(value:string):string { const u=new URL(value); if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash) throw new Error('请输入 HTTPS 服务地址，不含路径'); return u.origin; }
