import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';
import { z } from 'zod';
export const notificationTarget=z.object({userId:z.string(),origin:z.string(),conversationId:z.string(),messageId:z.string()});
// Local notifications only. No push token registration, Firebase configuration or foreground service.
Notifications.setNotificationHandler({handleNotification:async()=>({shouldShowBanner:AppState.currentState==='background',shouldShowList:AppState.currentState==='background',shouldPlaySound:AppState.currentState==='background',shouldSetBadge:false})});
export async function enableNotifications(){
  await Notifications.setNotificationChannelAsync('messages',{name:'聊天消息',importance:Notifications.AndroidImportance.HIGH,lockscreenVisibility:Notifications.AndroidNotificationVisibility.PRIVATE});
  return (await Notifications.requestPermissionsAsync()).granted;
}
export async function showMessageNotification(target:z.infer<typeof notificationTarget>){
  if(!(await Notifications.getPermissionsAsync()).granted)return;
  await Notifications.scheduleNotificationAsync({identifier:`${target.userId}:${target.messageId}`,content:{title:'DualLane',body:'有新消息',data:target,sound:'default'},trigger:null});
}
export async function clearNotifications(){await Notifications.cancelAllScheduledNotificationsAsync();await Notifications.dismissAllNotificationsAsync();await Notifications.clearLastNotificationResponseAsync();}
