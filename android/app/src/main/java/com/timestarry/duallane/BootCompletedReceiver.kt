package com.timestarry.duallane

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootCompletedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (
            action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            return
        }
        runCatching {
            val appCtx = context.applicationContext
            val hub = RealtimeHub.getInstance(appCtx)
            if (hub.tokenVault.isKeepAliveEnabled() && hub.tokenVault.isAuthenticated()) {
                PushKeepAliveService.startIfEligible(appCtx)
            }
        }
    }
}
