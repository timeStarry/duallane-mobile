import Constants from 'expo-constants';
import { z } from 'zod';
const configSchema=z.object({environment:z.enum(['development','test','production']),apiOrigin:z.string(),channel:z.literal('internal')});
export const config=configSchema.parse(Constants.expoConfig?.extra);
export const installed={appVersion:Constants.nativeAppVersion ?? '0.1.0',versionCode:Number(Constants.nativeBuildVersion ?? 1)};
export const redirectUri='com.timestarry.duallane://oauth';
export function validateOrigin(value:string):string { const u=new URL(value); if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash) throw new Error('请输入 HTTPS 服务地址，不含路径'); return u.origin; }
// Invitations are entered by the user and forwarded only to their own HTTPS service.
export function loginTarget(value:string,configuredOrigin=''):{origin:string;inviteCode?:string}{
  const fixedOrigin=configuredOrigin?validateOrigin(configuredOrigin):'';
  if(!value.trim()&&fixedOrigin)return {origin:fixedOrigin};
  const url=new URL(value.trim());
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('Invalid service URL');
  if(fixedOrigin&&url.origin!==fixedOrigin)throw new Error('邀请链接不属于当前服务');
  if(url.pathname==='/workspace'&&url.searchParams.has('invite')){
    const inviteCode=url.searchParams.get('invite')??'';
    if(!inviteCode||inviteCode.length>512||[...url.searchParams.keys()].some(key=>key!=='invite'))throw new Error('Invalid invitation');
    return {origin:url.origin,inviteCode};
  }
  return {origin:validateOrigin(value.trim())};
}
