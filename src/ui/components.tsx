import React from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View, StyleSheet, type TextInputProps } from 'react-native';
import { useTheme } from './theme';
export function Label({children,muted=false}:{children:React.ReactNode;muted?:boolean}){const t=useTheme();return <Text style={{fontSize:15,lineHeight:24,color:muted?t.muted:t.text}}>{children}</Text>;}
export function Button({title,onPress,disabled=false,secondary=false}:{title:string;onPress:()=>void;disabled?:boolean;secondary?:boolean}){const t=useTheme();return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={({pressed})=>({paddingHorizontal:16,paddingVertical:12,minHeight:48,borderRadius:10,backgroundColor:secondary?t.soft:t.shared,opacity:disabled?0.5:pressed?0.7:1,alignItems:'center'})}><Text style={{color:secondary?t.text:t.onShared,fontWeight:'600',fontSize:15}}>{title}</Text></Pressable>;}
export function Input(props:TextInputProps){const t=useTheme();return <TextInput {...props} placeholderTextColor={t.muted} style={[{minHeight:48,padding:12,borderRadius:10,borderWidth:1,borderColor:t.line,color:t.text,backgroundColor:t.surface,fontSize:16},props.style]}/>;}
export function Notice({text}:{text:string}){const t=useTheme();return text?<Text accessibilityLiveRegion="polite" style={{color:t.warning,padding:12,fontSize:14,lineHeight:20}}>{text}</Text>:null;}
export function Loading(){return <ActivityIndicator accessibilityLabel="正在加载" style={{padding:24}}/>;}
export function Empty({text}:{text:string}){return <View style={{padding:32}}><Label muted>{text}</Label></View>;}
export const styles=StyleSheet.create({page:{flex:1},content:{padding:16,gap:12},row:{paddingHorizontal:16,paddingVertical:14,minHeight:64,borderBottomWidth:StyleSheet.hairlineWidth,gap:4},title:{fontSize:17,fontWeight:'600'},section:{fontSize:20,fontWeight:'600',paddingBottom:8},actions:{flexDirection:'row',gap:8,flexWrap:'wrap'}});
