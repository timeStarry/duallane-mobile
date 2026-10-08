import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import { avatarMaxBytes, chooseAvatar, clearAvatarSelections, cleanupAvatarCopies, readAvatarBytes } from '../src/data/avatar';

const mockDisk=new Map<string,{size:number;bytes?:Uint8Array}>();
const mockDirs=new Set<string>();
let mockFileSequence=0;
let mockDirectoryFailure:{uri:string;action:'list'|'delete'|'evicted'}|null=null;
const mockRead=jest.fn();
const mockClose=jest.fn();
const mockDelete=jest.fn();
const mockCopy=jest.fn();
jest.mock('../src/platform/config',()=>({installed:{appVersion:'0.1.0',versionCode:1}}));
jest.mock('expo/fetch',()=>({fetch:jest.fn()}));
jest.mock('expo-document-picker',()=>({getDocumentAsync:jest.fn()}));
jest.mock('expo-crypto',()=>({CryptoDigestAlgorithm:{SHA256:'SHA256'},digestStringAsync:jest.fn(async(_algorithm:string,account:string)=> (account==='another-account'?'b':'a').repeat(64)),randomUUID:()=> `00000000-0000-4000-8000-${String(++mockFileSequence).padStart(12,'0')}`}));
jest.mock('expo-file-system',()=>{
  const join=(parts:(string|{uri:string})[])=>parts.map(part=>typeof part==='string'?part:part.uri.replace(/\/$/,'')).join('/');
  class MockFile {
    uri:string;
    constructor(...parts:(string|{uri:string})[]){this.uri=join(parts);}
    get exists(){return mockDisk.has(this.uri);}
    get size(){return mockDisk.get(this.uri)?.size??0;}
    delete(){mockDelete(this.uri);mockDisk.delete(this.uri);}
    copy(target:MockFile){mockCopy();const source=mockDisk.get(this.uri)!;mockDisk.set(target.uri,{...source,bytes:source.bytes?.slice()});}
    open(){const uri=this.uri;return {readBytes:(n:number)=>{mockRead(n);return mockDisk.get(uri)?.bytes??new Uint8Array(n);},close:mockClose};}
  }
  class MockDirectory {
    uri:string;
    constructor(...parts:(string|{uri:string})[]){this.uri=join(parts);}
    get exists(){return mockDirs.has(this.uri);}
    create(){mockDirs.add(this.uri);const parent=this.uri.slice(0,this.uri.lastIndexOf('/'));if(parent!=='file://')mockDirs.add(parent);}
    list(){
      if(mockDirectoryFailure?.uri===this.uri&&mockDirectoryFailure.action!=='delete'){
        if(mockDirectoryFailure.action==='evicted')mockDirs.delete(this.uri);
        throw new Error('Synthetic avatar directory unavailable');
      }
      const prefix=`${this.uri}/`;
      return [...[...mockDirs].filter(uri=>uri.startsWith(prefix)&&!uri.slice(prefix.length).includes('/')).map(uri=>new MockDirectory(uri)),...[...mockDisk.keys()].filter(uri=>uri.startsWith(prefix)&&!uri.slice(prefix.length).includes('/')).map(uri=>new MockFile(uri))];
    }
    delete(){if(mockDirectoryFailure?.uri===this.uri&&mockDirectoryFailure.action==='delete')throw new Error('Synthetic avatar delete failed');for(const uri of mockDisk.keys())if(uri.startsWith(`${this.uri}/`))mockDisk.delete(uri);for(const uri of mockDirs)if(uri===this.uri||uri.startsWith(`${this.uri}/`))mockDirs.delete(uri);}
  }
  return {Paths:{cache:{uri:'file:///cache'}},File:MockFile,Directory:MockDirectory};
});
const account='synthetic-account';
const uri='file:///cache/synthetic.png';
function pick(mimeType='image/png',size=3,location=uri){
  mockDisk.set(location,{size,bytes:new Uint8Array([1,2,3])});
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({canceled:false,assets:[{uri:location,name:'synthetic',mimeType,size,lastModified:0}]});
}
beforeEach(async()=>{mockDirectoryFailure=null;await clearAvatarSelections(account);mockDisk.clear();mockDirs.clear();mockRead.mockClear();mockCopy.mockClear();mockClose.mockClear();mockDelete.mockClear();jest.mocked(DocumentPicker.getDocumentAsync).mockReset();});
afterEach(()=>clearAvatarSelections(account));

test('selection is only a disposable preview; image bytes are read only at confirmation',async()=>{
  pick();const selection=await chooseAvatar(account,()=>true);
  expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({type:['image/jpeg','image/png','image/webp'],copyToCacheDirectory:true,multiple:false});
  expect(mockRead).not.toHaveBeenCalled();expect(mockDisk.has(uri)).toBe(false);expect(selection?.uri).toContain('/duallane-avatar-selections/');expect(mockDisk.has(selection!.uri)).toBe(true);
  expect(readAvatarBytes(selection!)).toEqual(new Uint8Array([1,2,3]));
  expect(mockRead).toHaveBeenCalledWith(3);expect(mockClose).toHaveBeenCalledTimes(1);
  selection!.dispose();selection!.dispose();expect(mockDelete).toHaveBeenCalledTimes(2);
});
test.each(['image/jpeg','image/png','image/webp'])('accepts the deployed raw image MIME %s',async mime=>{
  pick(mime);expect(await chooseAvatar(account,()=>true)).toMatchObject({mimeType:mime,byteSize:3});
});
test.each([0,-1,avatarMaxBytes+1,Number.MAX_SAFE_INTEGER,NaN])('rejects declared size %s without reading bytes',async size=>{
  pick('image/png',size);await expect(chooseAvatar(account,()=>true)).rejects.toThrow('5 MiB');
  expect(mockRead).not.toHaveBeenCalled();expect(mockDisk.has(uri)).toBe(false);
});
test('checks actual file size even when the picker declares a small size',async()=>{
  pick();mockDisk.set(uri,{size:avatarMaxBytes+1});
  await expect(chooseAvatar(account,()=>true)).rejects.toThrow('5 MiB');expect(mockRead).not.toHaveBeenCalled();
});
test('rejects an unsupported MIME and cleans only its cache copy',async()=>{
  pick('image/gif');await expect(chooseAvatar(account,()=>true)).rejects.toThrow('JPEG');
  expect(mockRead).not.toHaveBeenCalled();expect(mockDisk.has(uri)).toBe(false);
});
test.each(['file:///documents/original.png','file:///cache-spoof/p.png','file:///cache/%2e%2e/original.png','file:///cache/sub/%2e%2e/p.png','content://provider/original','file:///cache/p.png?secret=synthetic'])('never reads or deletes an unmanaged URI %s',async location=>{
  pick('image/png',3,location);await expect(chooseAvatar(account,()=>true)).rejects.toThrow('重新选择');
  expect(mockRead).not.toHaveBeenCalled();expect(mockDelete).not.toHaveBeenCalled();
});
test('picker cancellation does not read, retain or delete a file',async()=>{
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({canceled:true,assets:null});
  expect(await chooseAvatar(account,()=>true)).toBeNull();expect(mockRead).not.toHaveBeenCalled();expect(mockDelete).not.toHaveBeenCalled();
});
test('a late picker result after account or route invalidation cleans the cache copy',async()=>{
  let current=true;pick();
  const choosing=chooseAvatar(account,()=>current);current=false;
  await expect(choosing).rejects.toThrow('Stale session');expect(mockRead).not.toHaveBeenCalled();expect(mockDisk.has(uri)).toBe(false);
});
test('logout cleanup deletes pending selection copies before confirmation',async()=>{
  pick();const selection=await chooseAvatar(account,()=>true);await clearAvatarSelections(account);
  expect(mockDisk.has(selection!.uri)).toBe(false);expect(()=>readAvatarBytes(selection!)).toThrow('重新选择');expect(mockRead).not.toHaveBeenCalled();
});
test('a file changed after preview is refused before opening it',async()=>{
  pick();const selection=await chooseAvatar(account,()=>true);mockDisk.set(selection!.uri,{size:avatarMaxBytes+1});
  expect(()=>readAvatarBytes(selection!)).toThrow('重新选择');expect(mockRead).not.toHaveBeenCalled();
});

test('accepts exactly 5 MiB without reading during selection',async()=>{
  pick('image/png',avatarMaxBytes);expect(await chooseAvatar(account,()=>true)).toMatchObject({byteSize:avatarMaxBytes});
  expect(mockRead).not.toHaveBeenCalled();
});

test('a truncated file read is refused and its native handle is closed',async()=>{
  pick();const selection=await chooseAvatar(account,()=>true);mockDisk.set(selection!.uri,{size:3,bytes:new Uint8Array([1])});
  expect(()=>readAvatarBytes(selection!)).toThrow('重新选择');expect(mockClose).toHaveBeenCalledTimes(1);
});

test('disposing twice cannot delete a later copy reusing the same cache URI',async()=>{
  pick();const selection=await chooseAvatar(account,()=>true);selection!.dispose();
  mockDisk.set(selection!.uri,{size:3,bytes:new Uint8Array([3,2,1])});selection!.dispose();
  expect(mockDisk.has(selection!.uri)).toBe(true);expect(()=>readAvatarBytes(selection!)).toThrow('重新选择');
});

const ownedRoot='file:///cache/duallane-avatar-selections';
function persistedCopy(hash='a'.repeat(64)){
  const directory=`${ownedRoot}/${hash}`,uri=`${directory}/00000000-0000-4000-8000-000000000099`;
  mockDirs.add(ownedRoot);mockDirs.add(directory);mockDisk.set(uri,{size:3,bytes:new Uint8Array([1,2,3])});return uri;
}
function freshProcessModule(){
  let module!:typeof import('../src/data/avatar');
  jest.isolateModules(()=>{module=jest.requireActual<typeof import('../src/data/avatar')>('../src/data/avatar');});
  return module;
}

test('fresh process logout removes an owned copy even with an empty selections Map',async()=>{
  const stale=persistedCopy(),other=persistedCopy('b'.repeat(64)),original='file:///documents/original.png',attachment='file:///cache/attachments/existing';
  mockDisk.set(original,{size:3});mockDisk.set(attachment,{size:3});
  await freshProcessModule().clearAvatarSelections(account);
  expect(mockDisk.has(stale)).toBe(false);expect(mockDisk.has(other)).toBe(true);expect(mockDisk.has(original)).toBe(true);expect(mockDisk.has(attachment)).toBe(true);
});

test('startup after lost in-memory ownership removes old avatar copies only',()=>{
  const stale=persistedCopy(),preview='file:///cache/previews/existing',picker='file:///cache/DocumentPicker/unreturned.png';
  mockDisk.set(preview,{size:3});mockDisk.set(picker,{size:3});
  freshProcessModule().cleanupAvatarCopies();
  expect(mockDisk.has(stale)).toBe(false);expect(mockDisk.has(preview)).toBe(true);expect(mockDisk.has(picker)).toBe(true);
});

test('repeated startup cleanup preserves the current live selection and removes stale copies',async()=>{
  pick();const selection=await chooseAvatar(account,()=>true),stale=persistedCopy();
  cleanupAvatarCopies();cleanupAvatarCopies();
  expect(mockDisk.has(stale)).toBe(false);expect(mockDisk.has(selection!.uri)).toBe(true);expect(readAvatarBytes(selection!)).toEqual(new Uint8Array([1,2,3]));
});

test('an old logout preserves a new live selection created while its account hash was pending',async()=>{
  pick();const old=await chooseAvatar(account,()=>true);
  let finish!:(value:string)=>void;
  jest.mocked(Crypto.digestStringAsync).mockReturnValueOnce(new Promise<string>(resolve=>{finish=resolve;}));
  const logout=clearAvatarSelections(account);
  expect(mockDisk.has(old!.uri)).toBe(false);
  pick();const current=await chooseAvatar(account,()=>true);
  finish('a'.repeat(64));await logout;
  expect(mockDisk.has(current!.uri)).toBe(true);expect(readAvatarBytes(current!)).toEqual(new Uint8Array([1,2,3]));
});

test('a picker copy that grows while hashing is refused before native copy',async()=>{
  pick();let finish!:(value:string)=>void;
  jest.mocked(Crypto.digestStringAsync).mockReturnValueOnce(new Promise<string>(resolve=>{finish=resolve;}));
  const choosing=chooseAvatar(account,()=>true);await Promise.resolve();
  mockDisk.set(uri,{size:avatarMaxBytes+1});finish('a'.repeat(64));
  await expect(choosing).rejects.toThrow('重新选择');expect(mockCopy).not.toHaveBeenCalled();expect(mockRead).not.toHaveBeenCalled();
});

test.each([
  {scope:'root',action:'list' as const},
  {scope:'account',action:'list' as const},
  {scope:'account',action:'delete' as const},
  {scope:'account',action:'evicted' as const},
])('startup cleanup tolerates $scope $action IO failures and preserves live copies',async({scope,action})=>{
  pick();const live=await chooseAvatar(account,()=>true);
  const failedDirectory=`${ownedRoot}/${'b'.repeat(64)}`,otherCache='file:///cache/previews/existing';
  mockDirs.add(failedDirectory);mockDisk.set(otherCache,{size:3});
  mockDirectoryFailure={uri:scope==='root'?ownedRoot:failedDirectory,action};
  expect(()=>cleanupAvatarCopies()).not.toThrow();
  expect(mockDisk.has(live!.uri)).toBe(true);expect(mockDisk.has(otherCache)).toBe(true);
  expect(readAvatarBytes(live!)).toEqual(new Uint8Array([1,2,3]));
});
