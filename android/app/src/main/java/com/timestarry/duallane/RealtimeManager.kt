package com.timestarry.duallane

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class RealtimeManager(
    private val appContext: Context,
    private val networkGateway: NetworkGateway,
    private val ioExecutor: ExecutorService,
    private val emitWsEvent: (socketId: String, eventType: String, payload: String) -> Unit,
) {
    @Volatile
    var isForeground: Boolean = true

    private val sockets = ConcurrentHashMap<String, WebSocket>()
    private val notificationIdSeq = AtomicInteger(2000)

    private val wsClient: OkHttpClient = networkGateway.httpClient.newBuilder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build()

    init {
        ensureNotificationChannel()
    }

    fun connect(socketId: String, path: String, authenticated: Boolean) {
        ioExecutor.execute {
            try {
                val token = if (authenticated) networkGateway.getValidAccessToken(false) else null
                val origin = networkGateway.tokenVault.getApiOrigin()
                val wsOrigin = when {
                    origin.startsWith("https://") -> "wss://" + origin.removePrefix("https://")
                    origin.startsWith("http://") -> "ws://" + origin.removePrefix("http://")
                    else -> origin
                }
                val reqBuilder = Request.Builder()
                    .url("$wsOrigin$path")
                    .header("Origin", origin)
                if (!token.isNullOrBlank()) {
                    reqBuilder.header("Authorization", "Bearer $token")
                }

                val ws = wsClient.newWebSocket(reqBuilder.build(), object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        emitWsEvent(socketId, "open", "")
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        emitWsEvent(socketId, "message", text)
                        if (authenticated && !isForeground) {
                            maybePostBackgroundNotification(text)
                        }
                    }

                    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                        runCatching { webSocket.close(code, reason) }
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        sockets.remove(socketId, webSocket)
                        emitWsEvent(socketId, "close", reason)
                    }

                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        sockets.remove(socketId, webSocket)
                        if (authenticated && response?.code == 401) {
                            networkGateway.getValidAccessToken(true)
                        }
                        emitWsEvent(socketId, "error", t.message ?: "socket_failure")
                        emitWsEvent(socketId, "close", "failure")
                    }
                })

                sockets.put(socketId, ws)?.cancel()
            } catch (err: Throwable) {
                emitWsEvent(socketId, "error", err.message ?: "connect_failed")
                emitWsEvent(socketId, "close", "connect_failed")
            }
        }
    }

    fun send(socketId: String, data: String) {
        sockets[socketId]?.send(data)
    }

    fun close(socketId: String) {
        val ws = sockets.remove(socketId) ?: return
        runCatching { ws.close(1000, "client_closed") }
    }

    fun closeAll() {
        val entries = sockets.keys.toList()
        for (id in entries) {
            close(id)
        }
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = appContext.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                ?: return
            val channel = NotificationChannel(
                CHANNEL_MESSAGES,
                "会话新消息",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "DualLane 共享空间新消息提醒"
                enableVibration(true)
            }
            mgr.createNotificationChannel(channel)
        }
    }

    private fun maybePostBackgroundNotification(rawFrame: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                appContext,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) return
        }

        runCatching {
            val frame = JSONObject(rawFrame)
            if (frame.optString("type") != "message.created") return
            val payload = frame.optJSONObject("payload") ?: frame.optJSONObject("data") ?: frame
            val msg = payload.optJSONObject("message") ?: payload
            val convId = msg.optString("conversationId").ifBlank { payload.optString("conversationId") }
            if (convId.isBlank()) return

            val senderName = msg.optJSONObject("sender")?.optString("displayName")
                ?.takeIf { it.isNotBlank() }
                ?: msg.optString("senderName").takeIf { it.isNotBlank() }
                ?: "DualLane 新消息"

            val rawText = msg.optString("text").trim()
            val preview = when {
                rawText.startsWith("[sticker:") -> "[贴纸]"
                rawText.isNotBlank() -> rawText.take(100)
                msg.optJSONArray("attachments")?.length()?.let { it > 0 } == true -> "[图片/文件]"
                msg.optJSONObject("card") != null -> "[交互卡片]"
                else -> "发来一条新消息"
            }

            val deepLinkUri = Uri.parse("com.timestarry.duallane://open?conversation=${Uri.encode(convId)}")
            val openIntent = Intent(Intent.ACTION_VIEW, deepLinkUri, appContext, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pendingIntent = PendingIntent.getActivity(
                appContext,
                convId.hashCode(),
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val notification = NotificationCompat.Builder(appContext, CHANNEL_MESSAGES)
                .setSmallIcon(R.drawable.ic_stat_duallane)
                .setContentTitle(senderName)
                .setContentText(preview)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .build()

            NotificationManagerCompat.from(appContext)
                .notify(convId.hashCode().let { if (it == 0) notificationIdSeq.incrementAndGet() else it }, notification)
        }
    }

    companion object {
        private const val CHANNEL_MESSAGES = "duallane_messages"
    }
}
