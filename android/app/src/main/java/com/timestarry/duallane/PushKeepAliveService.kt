package com.timestarry.duallane

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

class PushKeepAliveService : Service() {

    override fun onCreate() {
        super.onCreate()
        ensureKeepAliveChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForegroundAndSelf()
            return START_NOT_STICKY
        }

        val hub = RealtimeHub.getInstance(applicationContext)
        if (!hub.tokenVault.isAuthenticated() || !hub.tokenVault.isKeepAliveEnabled()) {
            stopForegroundAndSelf()
            return START_NOT_STICKY
        }

        ensureKeepAliveChannel()
        val notification = buildKeepAliveNotification()
        val started = runCatching {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING
                } else {
                    0
                }
            )
        }.isSuccess

        if (!started) {
            stopSelf()
            return START_NOT_STICKY
        }

        hub.ensureWorkspaceConnected()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTimeout(startId: Int) {
        stopForegroundAndSelf()
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        stopForegroundAndSelf()
    }

    override fun onDestroy() {
        runCatching {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        }
        super.onDestroy()
    }

    private fun stopForegroundAndSelf() {
        runCatching {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        }
        stopSelf()
    }

    private fun ensureKeepAliveChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
            val channel = NotificationChannel(
                CHANNEL_KEEPALIVE,
                "实时连接后台守护",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "保持后台消息即时送达（静音无打扰）"
                setSound(null, null)
                enableVibration(false)
                setShowBadge(false)
            }
            mgr.createNotificationChannel(channel)
        }
    }

    private fun buildKeepAliveNotification(): Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_KEEPALIVE)
            .setSmallIcon(R.drawable.ic_stat_duallane)
            .setContentTitle("DualLane 实时消息守护中")
            .setContentText("保持后台消息即时送达")
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(pendingIntent)
            .build()
    }

    companion object {
        private const val CHANNEL_KEEPALIVE = "duallane_keepalive"
        private const val NOTIFICATION_ID = 1001
        const val ACTION_START = "com.timestarry.duallane.action.START_KEEPALIVE"
        const val ACTION_STOP = "com.timestarry.duallane.action.STOP_KEEPALIVE"

        fun syncServiceState(context: Context) {
            val appCtx = context.applicationContext
            val hub = RealtimeHub.getInstance(appCtx)
            if (hub.tokenVault.isAuthenticated() && hub.tokenVault.isKeepAliveEnabled()) {
                startIfEligible(appCtx)
            } else {
                stopService(appCtx)
            }
        }

        fun startIfEligible(context: Context) {
            val appCtx = context.applicationContext
            val hub = RealtimeHub.getInstance(appCtx)
            if (!hub.tokenVault.isAuthenticated() || !hub.tokenVault.isKeepAliveEnabled()) {
                return
            }
            hub.ensureWorkspaceConnected()
            runCatching {
                val intent = Intent(appCtx, PushKeepAliveService::class.java).apply {
                    action = ACTION_START
                }
                ContextCompat.startForegroundService(appCtx, intent)
            }
        }

        fun stopService(context: Context) {
            val appCtx = context.applicationContext
            runCatching {
                appCtx.stopService(Intent(appCtx, PushKeepAliveService::class.java))
            }
        }
    }
}
