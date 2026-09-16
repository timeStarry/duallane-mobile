import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { z } from 'zod';
import { config } from './config';
const prefix=`duallane.${config.environment}`;
const db=SQLite.openDatabaseSync(`${prefix}.db`);
db.execSync('CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);');
export const cache={
  get:(key:string):unknown=>{const row=db.getFirstSync<{value:string}>('SELECT value FROM cache WHERE key=?',key);if(!row)return null;try{return JSON.parse(row.value);}catch{return null;}},
  set:(key:string,value:unknown)=>db.runSync('INSERT INTO cache(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,JSON.stringify(value)),
  remove:(key:string)=>db.runSync('DELETE FROM cache WHERE key=?',key),
  clearAccount:(key:string)=>db.runSync('DELETE FROM cache WHERE key LIKE ?',`${key}:%`),
};
export const credentialsSchema=z.object({refreshToken:z.string(),origin:z.string(),userId:z.string().optional()});
export const credentials={
  read:async()=>{const raw=await SecureStore.getItemAsync(`${prefix}.session`);if(!raw)return null;try{return credentialsSchema.parse(JSON.parse(raw));}catch{return null;}},
  save:(v:z.infer<typeof credentialsSchema>)=>SecureStore.setItemAsync(`${prefix}.session`,JSON.stringify(v)),
  clear:()=>SecureStore.deleteItemAsync(`${prefix}.session`),
};
