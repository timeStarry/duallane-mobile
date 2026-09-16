import React, { createContext, useContext } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
export const palettes={light:{bg:'#f5f7f8',surface:'#ffffff',soft:'#eef2f4',text:'#202c32',muted:'#586a74',line:'#e0e7ea',shared:'#256b78',sharedSoft:'#e7f2f4',onShared:'#ffffff',danger:'#b52e49',warning:'#825500'},dark:{bg:'#151b20',surface:'#20292f',soft:'#2a363e',text:'#eaf1f5',muted:'#a8bbc6',line:'#35464f',shared:'#9bd4df',sharedSoft:'#25414c',onShared:'#142c33',danger:'#ffb0c0',warning:'#efcd87'}};
const Theme=createContext(palettes.light);
export function ThemeProvider({mode,children}:{mode:'system'|'light'|'dark';children:React.ReactNode}){
  const system=useColorScheme();
  const resolved=mode==='system'?(system??'light'):mode;
  return <Theme.Provider value={palettes[resolved]}><StatusBar barStyle={resolved==='dark'?'light-content':'dark-content'}/>{children}</Theme.Provider>;
}
export const useTheme=()=>useContext(Theme);
