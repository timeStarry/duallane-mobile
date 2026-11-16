package com.timestarry.duallane

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.ArrayDeque
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

data class NotificationContextSnapshot(
    val currentUserId: String = "",
    val currentUserDisplayName: String = "我",
    val muteMap: Map<String, String> = emptyMap(),
    val memberNames: Map<String, String> = emptyMap(),
    val convTitles: Map<String, String> = emptyMap(),
    val convKinds: Map<String, String> = emptyMap(),
)

private data class UnreadMessageLine(
    val senderId: String,
    val senderName: String,
    val text: String,
    val timestampMs: Long,
)

private data class BufferedWorkspaceEvent(
    val seq: Long,
    val rawFrame: String,
)

class RealtimeHub private constructor(private val appContext: Context) {

    val tokenVault: TokenVault = TokenVault(appContext)
    val networkGateway: NetworkGateway = NetworkGateway(appContext, tokenVault)
    val appUpdateManager: AppUpdateManager = AppUpdateManager(appContext, networkGateway)
    val ioExecutor: ExecutorService = Executors.newCachedThreadPool()

    private val reconnectScheduler: ScheduledExecutorService =
        Executors.newSingleThreadScheduledExecutor { runnable ->
            Thread(runnable, "duallane-ws-reconnect").apply { isDaemon = true }
        }

    private val wsClient: OkHttpClient = networkGateway.httpClient.newBuilder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build()

    private val workspaceLock = Any()
    private var workspaceSocket: WebSocket? = null
    private var workspaceConnecting: Boolean = false
    private var workspaceOpen: Boolean = false
    private var workspaceHelloSent: Boolean = false
    private var workspaceReady: Boolean = false
    private var workspaceSyncRequired: Boolean = false
    private var workspaceExplicitlyStopped: Boolean = false
    private var reconnectAttempt: Int = 0
    private var reconnectFuture: ScheduledFuture<*>? = null
    private var activeJsSocketId: String? = null
    private var lastKnownSeq: Long = tokenVault.getLastWorkspaceSeq()
    private val eventRingBuffer = ArrayDeque<BufferedWorkspaceEvent>()

    private val ephemeralSockets = ConcurrentHashMap<String, WebSocket>()
    private val unreadLinesByConv = ConcurrentHashMap<String, ArrayDeque<UnreadMessageLine>>()

    @Volatile
    private var notificationContext: NotificationContextSnapshot =
        parseNotificationContext(tokenVault.getNotificationContextJson())

    @Volatile
    var isUiForeground: Boolean = false
        private set

    @Volatile
    private var uiEmitter: ((socketId: String, eventType: String, payload: String) -> Unit)? = null

    init {
        ensureNotificationChannel()
        registerNetworkCallback()
    }

    fun attachUiBridge(emitter: (socketId: String, eventType: String, payload: String) -> Unit) {
        uiEmitter = emitter
    }

    fun detachUiBridge(emitter: (socketId: String, eventType: String, payload: String) -> Unit) {
        if (uiEmitter !== emitter) {
            return
        }
        uiEmitter = null
        isUiForeground = false
        closeEphemeralSockets()
        synchronized(workspaceLock) {
            activeJsSocketId = null
            if (!tokenVault.isAuthenticated() || !tokenVault.isKeepAliveEnabled()) {
                closeWorkspaceSocketLocked("ui_destroyed")
            }
        }
    }

    fun setUiForegroundState(foreground: Boolean) {
        isUiForeground = foreground
        if (foreground && tokenVault.isAuthenticated()) {
            ensureWorkspaceConnected()
        }
    }

    fun syncNotificationContext(rawJson: String) {
        val parsed = parseNotificationContext(rawJson)
        notificationContext = parsed
        tokenVault.setNotificationContextJson(rawJson)
    }

    fun clearConversationNotification(convId: String) {
        val clean = convId.trim()
        if (clean.isEmpty()) return
        unreadLinesByConv.remove(clean)
        runCatching {
            NotificationManagerCompat.from(appContext).cancel(notificationIdForConv(clean))
        }
    }

    fun clearAllNotifications() {
        unreadLinesByConv.clear()
        runCatching {
            NotificationManagerCompat.from(appContext).cancelAll()
        }
    }

    fun ensureWorkspaceConnected() {
        synchronized(workspaceLock) {
            if (!tokenVault.isAuthenticated()) return
            workspaceExplicitlyStopped = false
            if (workspaceOpen || workspaceConnecting) return
            reconnectFuture?.cancel(false)
            reconnectFuture = null
            workspaceConnecting = true
        }
        ioExecutor.execute {
            openWorkspaceSocketInternal()
        }
    }

    fun connect(socketId: String, path: String, authenticated: Boolean) {
        if (isWorkspacePath(path, authenticated)) {
            var alreadyOpen = false
            synchronized(workspaceLock) {
                activeJsSocketId = socketId
                workspaceExplicitlyStopped = false
                alreadyOpen = workspaceOpen && workspaceSocket != null
            }
            if (alreadyOpen) {
                uiEmitter?.invoke(socketId, "open", "")
                return
            }
            ensureWorkspaceConnected()
            return
        }
        connectEphemeral(socketId, path, authenticated)
    }

    fun send(socketId: String, data: String) {
        val handledAsWorkspace = synchronized(workspaceLock) {
            if (socketId != activeJsSocketId) {
                false
            } else {
                handleWorkspaceClientSendLocked(socketId, data)
                true
            }
        }
        if (!handledAsWorkspace) {
            ephemeralSockets[socketId]?.send(data)
        }
    }

    fun close(socketId: String) {
        var toCloseWs: WebSocket? = null
        synchronized(workspaceLock) {
            if (socketId == activeJsSocketId) {
                activeJsSocketId = null
                val keepBackground = tokenVault.isAuthenticated() && tokenVault.isKeepAliveEnabled()
                if (!keepBackground && !isUiForeground) {
                    toCloseWs = detachWorkspaceSocketLocked()
                }
                toCloseWs?.let { runCatching { it.close(1000, "client_closed") } }
                return
            }
        }
        val eph = ephemeralSockets.remove(socketId) ?: return
        runCatching { eph.close(1000, "client_closed") }
    }

    fun shutdownForLogoutOrOriginChange() {
        closeEphemeralSockets()
        var ws: WebSocket?
        synchronized(workspaceLock) {
            workspaceExplicitlyStopped = true
            reconnectAttempt = 0
            reconnectFuture?.cancel(false)
            reconnectFuture = null
            activeJsSocketId = null
            eventRingBuffer.clear()
            lastKnownSeq = 0L
            ws = detachWorkspaceSocketLocked()
        }
        ws?.let { runCatching { it.close(1000, "logout") } }
        notificationContext = NotificationContextSnapshot()
        clearAllNotifications()
        PushKeepAliveService.stopService(appContext)
    }

    private fun closeEphemeralSockets() {
        val keys = ephemeralSockets.keys.toList()
        for (k in keys) {
            ephemeralSockets.remove(k)?.let { ws ->
                runCatching { ws.close(1000, "ui_closed") }
            }
        }
    }

    private fun closeWorkspaceSocketLocked(reason: String) {
        reconnectFuture?.cancel(false)
        reconnectFuture = null
        val ws = detachWorkspaceSocketLocked()
        ws?.let { runCatching { it.close(1000, reason) } }
    }

    private fun detachWorkspaceSocketLocked(): WebSocket? {
        val ws = workspaceSocket
        workspaceSocket = null
        workspaceConnecting = false
        workspaceOpen = false
        workspaceHelloSent = false
        workspaceReady = false
        workspaceSyncRequired = false
        return ws
    }

    private fun handleWorkspaceClientSendLocked(socketId: String, data: String) {
        val ws = workspaceSocket ?: return
        if (!workspaceOpen) return

        val trimmed = data.trim()
        if (trimmed.startsWith("{")) {
            val json = runCatching { JSONObject(trimmed) }.getOrNull()
            if (json?.optString("type") == "hello") {
                val clientSeq = json.optLong("lastSeq", 0L)
                if (clientSeq > lastKnownSeq) {
                    lastKnownSeq = clientSeq
                    tokenVault.setLastWorkspaceSeq(lastKnownSeq)
                }
                if (!workspaceHelloSent) {
                    workspaceHelloSent = true
                    ws.send(data)
                    return
                }
                if (workspaceReady) {
                    val emitter = uiEmitter ?: return
                    if (workspaceSyncRequired) {
                        val syncMsg = JSONObject()
                            .put("type", "sync.required")
                            .put("currentSeq", lastKnownSeq)
                            .toString()
                        emitter(socketId, "message", syncMsg)
                        return
                    }
                    if (lastKnownSeq <= clientSeq) {
                        val readyMsg = JSONObject()
                            .put("type", "ready")
                            .put("currentSeq", lastKnownSeq)
                            .toString()
                        emitter(socketId, "message", readyMsg)
                        return
                    }
                    val oldestBufferedSeq = eventRingBuffer.peekFirst()?.seq
                    val canReplayWithoutGap =
                        oldestBufferedSeq != null && oldestBufferedSeq <= clientSeq + 1L
                    if (!canReplayWithoutGap) {
                        val syncMsg = JSONObject()
                            .put("type", "sync.required")
                            .put("currentSeq", lastKnownSeq)
                            .toString()
                        emitter(socketId, "message", syncMsg)
                        return
                    }
                    val missed = eventRingBuffer.filter { it.seq > clientSeq }
                    val readyMsg = JSONObject()
                        .put("type", "ready")
                        .put("currentSeq", lastKnownSeq)
                        .toString()
                    emitter(socketId, "message", readyMsg)
                    for (item in missed) {
                        emitter(socketId, "message", item.rawFrame)
                    }
                    return
                }
                // Socket sent hello earlier (e.g. background resume) and is awaiting server "ready".
                // Schedule a 1.8s stale-socket check in case NAT dropped the idle TCP connection.
                val expectedWs = ws
                reconnectScheduler.schedule({
                    var staleWs: WebSocket? = null
                    synchronized(workspaceLock) {
                        if (workspaceSocket === expectedWs && workspaceOpen && !workspaceReady) {
                            staleWs = detachWorkspaceSocketLocked()
                        }
                    }
                    if (staleWs != null) {
                        runCatching { staleWs!!.cancel() }
                        ensureWorkspaceConnected()
                    }
                }, 1800L, TimeUnit.MILLISECONDS)
                return
            }
        }
        ws.send(data)
    }

    private fun openWorkspaceSocketInternal() {
        try {
            if (!tokenVault.isAuthenticated()) {
                synchronized(workspaceLock) {
                    workspaceConnecting = false
                }
                PushKeepAliveService.stopService(appContext)
                return
            }

            val token = networkGateway.getValidAccessToken(false)
            if (token.isNullOrBlank()) {
                val stillAuthed = tokenVault.isAuthenticated()
                synchronized(workspaceLock) {
                    workspaceConnecting = false
                }
                if (!stillAuthed) {
                    PushKeepAliveService.stopService(appContext)
                } else {
                    scheduleWorkspaceReconnect(immediate = false)
                }
                return
            }

            val origin = tokenVault.getApiOrigin()
            val wsOrigin = toWsOrigin(origin)
            val request = Request.Builder()
                .url("$wsOrigin/ws/workspace")
                .header("Origin", origin)
                .header("Authorization", "Bearer $token")
                .build()

            val newWs = wsClient.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    var jsSid: String? = null
                    var sendImmediateNativeHello = false
                    var helloSeq = 0L

                    synchronized(workspaceLock) {
                        if (workspaceExplicitlyStopped) {
                            workspaceConnecting = false
                            runCatching { webSocket.close(1000, "stopped") }
                            return
                        }
                        workspaceSocket = webSocket
                        workspaceConnecting = false
                        workspaceOpen = true
                        workspaceHelloSent = false
                        workspaceReady = false
                        workspaceSyncRequired = false
                        reconnectAttempt = 0
                        reconnectFuture?.cancel(false)
                        reconnectFuture = null
                        jsSid = activeJsSocketId
                        helloSeq = lastKnownSeq
                        if (!isUiForeground || uiEmitter == null || jsSid == null) {
                            workspaceHelloSent = true
                            sendImmediateNativeHello = true
                        }
                    }

                    if (sendImmediateNativeHello) {
                        val hello = JSONObject()
                            .put("type", "hello")
                            .put("version", 1)
                            .put("lastSeq", helloSeq)
                            .toString()
                        webSocket.send(hello)
                    }

                    if (jsSid != null) {
                        uiEmitter?.invoke(jsSid!!, "open", "")
                        if (!sendImmediateNativeHello) {
                            reconnectScheduler.schedule({
                                var fallbackSeq: Long? = null
                                synchronized(workspaceLock) {
                                    if (workspaceSocket === webSocket && workspaceOpen && !workspaceHelloSent) {
                                        workspaceHelloSent = true
                                        fallbackSeq = lastKnownSeq
                                    }
                                }
                                fallbackSeq?.let { seq ->
                                    val hello = JSONObject()
                                        .put("type", "hello")
                                        .put("version", 1)
                                        .put("lastSeq", seq)
                                        .toString()
                                    webSocket.send(hello)
                                }
                            }, 600L, TimeUnit.MILLISECONDS)
                        }
                    }
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    var jsSid: String?
                    synchronized(workspaceLock) {
                        if (webSocket !== workspaceSocket) return
                        jsSid = activeJsSocketId
                    }

                    val frame = runCatching { JSONObject(text) }.getOrNull()
                    val frameType = frame?.optString("type").orEmpty()

                    if (frameType == "ready") {
                        val seq = frame?.optLong("currentSeq", 0L) ?: 0L
                        synchronized(workspaceLock) {
                            workspaceReady = true
                            workspaceSyncRequired = false
                            if (seq > lastKnownSeq) {
                                lastKnownSeq = seq
                                tokenVault.setLastWorkspaceSeq(seq)
                            }
                        }
                    } else if (frameType == "sync.required") {
                        val seq = frame?.optLong("currentSeq", 0L) ?: 0L
                        synchronized(workspaceLock) {
                            workspaceReady = true
                            workspaceSyncRequired = true
                            if (seq > lastKnownSeq) {
                                lastKnownSeq = seq
                                tokenVault.setLastWorkspaceSeq(seq)
                            }
                        }
                    } else if (frameType == "event") {
                        val evObj = frame?.optJSONObject("event")
                        val seq = evObj?.optLong("seq", 0L) ?: 0L
                        synchronized(workspaceLock) {
                            if (seq > 0L) {
                                if (eventRingBuffer.size >= MAX_BUFFERED_EVENTS) {
                                    eventRingBuffer.removeFirst()
                                }
                                eventRingBuffer.addLast(BufferedWorkspaceEvent(seq, text))
                                if (seq > lastKnownSeq) {
                                    lastKnownSeq = seq
                                    tokenVault.setLastWorkspaceSeq(seq)
                                }
                            }
                        }
                    }

                    if (jsSid != null) {
                        uiEmitter?.invoke(jsSid!!, "message", text)
                    }

                    handleNotificationSideEffects(frame)
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    runCatching { webSocket.close(code, reason) }
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    handleWorkspaceDisconnect(
                        webSocket = webSocket,
                        reason = reason.ifBlank { "closed" },
                        errorMsg = null,
                        httpCode = null,
                    )
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    handleWorkspaceDisconnect(
                        webSocket = webSocket,
                        reason = "failure",
                        errorMsg = t.message ?: "socket_failure",
                        httpCode = response?.code,
                    )
                }
            })

            var previousWs: WebSocket? = null
            synchronized(workspaceLock) {
                if (workspaceExplicitlyStopped) {
                    workspaceConnecting = false
                    previousWs = newWs
                } else {
                    previousWs = workspaceSocket?.takeIf { it !== newWs }
                    workspaceSocket = newWs
                }
            }
            previousWs?.cancel()
        } catch (err: Throwable) {
            var jsSid: String?
            synchronized(workspaceLock) {
                workspaceConnecting = false
                jsSid = activeJsSocketId
                activeJsSocketId = null
            }
            if (jsSid != null) {
                uiEmitter?.invoke(jsSid!!, "error", err.message ?: "connect_failed")
                uiEmitter?.invoke(jsSid!!, "close", "connect_failed")
            }
            scheduleWorkspaceReconnect(immediate = false)
        }
    }

    private fun handleWorkspaceDisconnect(
        webSocket: WebSocket,
        reason: String,
        errorMsg: String?,
        httpCode: Int?,
    ) {
        var jsSid: String? = null
        var shouldReconnect = false

        synchronized(workspaceLock) {
            if (webSocket !== workspaceSocket) return
            workspaceSocket = null
            workspaceConnecting = false
            workspaceOpen = false
            workspaceHelloSent = false
            workspaceReady = false
            jsSid = activeJsSocketId
            activeJsSocketId = null
            shouldReconnect =
                !workspaceExplicitlyStopped &&
                    tokenVault.isAuthenticated() &&
                    (isUiForeground || tokenVault.isKeepAliveEnabled())
        }

        if (httpCode == 401) {
            ioExecutor.execute {
                networkGateway.getValidAccessToken(true)
            }
        }

        if (jsSid != null) {
            if (!errorMsg.isNullOrBlank()) {
                uiEmitter?.invoke(jsSid!!, "error", errorMsg)
            }
            uiEmitter?.invoke(jsSid!!, "close", reason)
        }

        if (shouldReconnect) {
            scheduleWorkspaceReconnect(immediate = false)
        }
    }

    private fun scheduleWorkspaceReconnect(immediate: Boolean) {
        synchronized(workspaceLock) {
            if (workspaceExplicitlyStopped || !tokenVault.isAuthenticated()) return
            if (!isUiForeground && !tokenVault.isKeepAliveEnabled()) return
            if (workspaceOpen || workspaceConnecting) return

            reconnectFuture?.cancel(false)
            val delayMs = if (immediate) {
                reconnectAttempt = 0
                0L
            } else {
                val step = BACKOFF_STEPS_MS[reconnectAttempt.coerceAtMost(BACKOFF_STEPS_MS.lastIndex)]
                reconnectAttempt = (reconnectAttempt + 1).coerceAtMost(BACKOFF_STEPS_MS.lastIndex)
                step
            }
            reconnectFuture = reconnectScheduler.schedule(
                { ensureWorkspaceConnected() },
                delayMs,
                TimeUnit.MILLISECONDS
            )
        }
    }

    private fun registerNetworkCallback() {
        runCatching {
            val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return
            cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    if (tokenVault.isAuthenticated() && (isUiForeground || tokenVault.isKeepAliveEnabled())) {
                        scheduleWorkspaceReconnect(immediate = true)
                    }
                }

                override fun onLost(network: Network) {
                    // Wait for onAvailable or OkHttp ping failure to trigger clean reconnect
                }
            })
        }
    }

    private fun connectEphemeral(socketId: String, path: String, authenticated: Boolean) {
        ioExecutor.execute {
            try {
                val token = if (authenticated) networkGateway.getValidAccessToken(false) else null
                val origin = tokenVault.getApiOrigin()
                val wsOrigin = toWsOrigin(origin)
                val reqBuilder = Request.Builder()
                    .url("$wsOrigin$path")
                    .header("Origin", origin)
                if (!token.isNullOrBlank()) {
                    reqBuilder.header("Authorization", "Bearer $token")
                }

                val ws = wsClient.newWebSocket(reqBuilder.build(), object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        uiEmitter?.invoke(socketId, "open", "")
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        uiEmitter?.invoke(socketId, "message", text)
                    }

                    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                        runCatching { webSocket.close(code, reason) }
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        ephemeralSockets.remove(socketId, webSocket)
                        uiEmitter?.invoke(socketId, "close", reason)
                    }

                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        ephemeralSockets.remove(socketId, webSocket)
                        if (authenticated && response?.code == 401) {
                            networkGateway.getValidAccessToken(true)
                        }
                        uiEmitter?.invoke(socketId, "error", t.message ?: "socket_failure")
                        uiEmitter?.invoke(socketId, "close", "failure")
                    }
                })
                ephemeralSockets.put(socketId, ws)?.cancel()
            } catch (err: Throwable) {
                uiEmitter?.invoke(socketId, "error", err.message ?: "connect_failed")
                uiEmitter?.invoke(socketId, "close", "connect_failed")
            }
        }
    }

    private fun handleNotificationSideEffects(frame: JSONObject?) {
        if (frame == null) return
        val topType = frame.optString("type")
        val eventObj = if (topType == "event") frame.optJSONObject("event") else frame
        val evType = eventObj?.optString("type").orEmpty()
        if (evType.isBlank()) return

        val payload = eventObj?.optJSONObject("payload")
            ?: eventObj?.optJSONObject("data")
            ?: eventObj
            ?: return

        val ctx = notificationContext

        if (evType == "conversation.read") {
            val readerId = payload.optString("userId").ifBlank { eventObj.optString("actorId") }
            val convId = payload.optString("conversationId").ifBlank { eventObj.optString("conversationId") }
            if (convId.isNotBlank() && ctx.currentUserId.isNotBlank() && readerId == ctx.currentUserId) {
                clearConversationNotification(convId)
            }
            return
        }

        if (evType == "message.created" && !isUiForeground) {
            maybePostBackgroundNotification(eventObj, payload, ctx)
        }
    }

    private fun maybePostBackgroundNotification(
        eventObj: JSONObject,
        payload: JSONObject,
        ctx: NotificationContextSnapshot,
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                appContext,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) return
        }

        runCatching {
            val msg = payload.optJSONObject("message") ?: payload
            val convId = msg.optString("conversationId")
                .ifBlank { payload.optString("conversationId") }
                .ifBlank { eventObj.optString("conversationId") }
                .trim()
            if (convId.isEmpty()) return

            val kind = msg.optString("kind", "user").trim()
            if (kind == "system") return
            if (msg.optString("recalledAt").isNotBlank()) return

            val authorObj = msg.optJSONObject("author")
            val senderObj = msg.optJSONObject("sender")
            val senderId = msg.optString("authorId")
                .ifBlank { msg.optString("senderId") }
                .ifBlank { authorObj?.optString("id").orEmpty() }
                .ifBlank { senderObj?.optString("id").orEmpty() }
                .trim()

            // Never notify on the current user's own messages sent from PC Web or another device
            if (ctx.currentUserId.isNotEmpty() && senderId == ctx.currentUserId) {
                return
            }

            val contentObj = msg.optJSONObject("content")
            val blocksArr = contentObj?.optJSONArray("blocks") ?: msg.optJSONArray("blocks")
            val rawText = msg.optString("plainText")
                .ifBlank { msg.optString("text") }
                .ifBlank { contentObj?.optString("plainText").orEmpty() }
                .trim()

            // Respect per-conversation mute level ("all" | "mentions" | "muted")
            val level = ctx.muteMap[convId] ?: "all"
            if (level == "muted") {
                return
            }
            if (level == "mentions" && !messageMentionsMeOrAll(rawText, blocksArr, ctx)) {
                return
            }

            val senderName = resolveSenderDisplayName(msg, authorObj, senderObj, senderId, kind, ctx)
            val preview = buildSanitizedPreview(msg, rawText, blocksArr, ctx)

            val historyQueue = unreadLinesByConv.computeIfAbsent(convId) { ArrayDeque() }
            val line = UnreadMessageLine(
                senderId = senderId.ifBlank { senderName },
                senderName = senderName,
                text = preview,
                timestampMs = System.currentTimeMillis(),
            )
            val snapshotLines: List<UnreadMessageLine> = synchronized(historyQueue) {
                if (historyQueue.size >= MAX_MESSAGING_LINES) {
                    historyQueue.removeFirst()
                }
                historyQueue.addLast(line)
                historyQueue.toList()
            }

            val mePerson = Person.Builder()
                .setName(ctx.currentUserDisplayName.ifBlank { "我" })
                .setKey(ctx.currentUserId.ifBlank { "me" })
                .build()

            val isGroup = ctx.convKinds[convId] == "group" ||
                (ctx.convTitles[convId] != null && ctx.convKinds[convId] != "direct")
            val convTitle = ctx.convTitles[convId]?.takeIf { it.isNotBlank() }

            val messagingStyle = NotificationCompat.MessagingStyle(mePerson)
                .setGroupConversation(isGroup)
            if (isGroup && convTitle != null) {
                messagingStyle.setConversationTitle(convTitle)
            }
            for (item in snapshotLines) {
                val p = Person.Builder()
                    .setName(item.senderName.ifBlank { "成员" })
                    .setKey(item.senderId.ifBlank { "peer" })
                    .build()
                messagingStyle.addMessage(item.text, item.timestampMs, p)
            }

            val deepLinkUri = Uri.parse(
                "com.timestarry.duallane://open?conversation=${Uri.encode(convId)}"
            )
            val openIntent = Intent(
                Intent.ACTION_VIEW,
                deepLinkUri,
                appContext,
                MainActivity::class.java
            ).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val notifId = notificationIdForConv(convId)
            val pendingIntent = PendingIntent.getActivity(
                appContext,
                notifId,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val collapsedTitle = if (isGroup && convTitle != null) convTitle else senderName
            val collapsedText = if (isGroup) "$senderName: $preview" else preview

            val notification = NotificationCompat.Builder(appContext, CHANNEL_MESSAGES)
                .setSmallIcon(R.drawable.ic_stat_duallane)
                .setContentTitle(collapsedTitle)
                .setContentText(collapsedText)
                .setStyle(messagingStyle)
                .setNumber(snapshotLines.size)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .build()

            NotificationManagerCompat.from(appContext).notify(notifId, notification)
        }
    }

    private fun messageMentionsMeOrAll(
        rawText: String,
        blocksArr: JSONArray?,
        ctx: NotificationContextSnapshot,
    ): Boolean {
        if (blocksArr != null) {
            for (i in 0 until blocksArr.length()) {
                val b = blocksArr.optJSONObject(i) ?: continue
                if (b.optString("type") == "mention") {
                    val uid = b.optString("userId").trim()
                    val label = b.optString("label").removePrefix("@").trim()
                    if (uid == "all" || label == "所有人") return true
                    if (ctx.currentUserId.isNotEmpty() && uid == ctx.currentUserId) return true
                }
            }
        }
        if (rawText.contains("@所有人")) return true
        val myName = ctx.currentUserDisplayName.trim()
        if (myName.isNotEmpty() && myName != "我" && rawText.contains("@$myName")) {
            return true
        }
        return false
    }

    private fun resolveSenderDisplayName(
        msg: JSONObject,
        authorObj: JSONObject?,
        senderObj: JSONObject?,
        senderId: String,
        kind: String,
        ctx: NotificationContextSnapshot,
    ): String {
        if (senderId.isNotEmpty()) {
            ctx.memberNames[senderId]?.takeIf { it.isNotBlank() && !it.startsWith("__duallane_") }?.let {
                return it
            }
        }
        val candidates = listOf(
            msg.optString("authorRemark"),
            msg.optString("authorNickname"),
            msg.optString("authorName"),
            msg.optString("authorDisplayName"),
            authorObj?.optString("displayName").orEmpty(),
            senderObj?.optString("displayName").orEmpty(),
            msg.optString("senderName"),
        )
        for (c in candidates) {
            val trimmed = c.trim()
            if (trimmed.isNotEmpty() && !trimmed.startsWith("__duallane_")) {
                return trimmed
            }
        }
        return if (kind == "bot") "机器人" else "DualLane 新消息"
    }

    private fun buildSanitizedPreview(
        msg: JSONObject,
        rawText: String,
        blocksArr: JSONArray?,
        ctx: NotificationContextSnapshot,
    ): String {
        if (blocksArr != null && blocksArr.length() == 1) {
            val first = blocksArr.optJSONObject(0)
            if (first?.optString("type") == "emoji") {
                return "[表情]"
            }
            if (first?.optString("type") == "emote_collection") {
                return "[表情包分享]"
            }
        }

        // Rebuild text from blocks if synthetic @__duallane_* handle appears
        var working = rawText
        if (working.contains("__duallane_") && blocksArr != null && blocksArr.length() > 0) {
            val sb = StringBuilder()
            for (i in 0 until blocksArr.length()) {
                val b = blocksArr.optJSONObject(i) ?: continue
                when (b.optString("type")) {
                    "text" -> sb.append(b.optString("text"))
                    "mention" -> {
                        val uid = b.optString("userId")
                        val rawLabel = b.optString("label").removePrefix("@").trim()
                        val name = when {
                            uid == "all" || rawLabel == "所有人" -> "所有人"
                            ctx.memberNames[uid]?.isNotBlank() == true -> ctx.memberNames[uid]!!
                            rawLabel.isNotEmpty() && !rawLabel.startsWith("__duallane_") -> rawLabel
                            else -> "机器人"
                        }
                        sb.append("@").append(name)
                    }
                    "link" -> sb.append(b.optString("label").ifBlank { b.optString("url") })
                    "emoji" -> sb.append("[表情]")
                    "emote_collection" -> sb.append("[表情包分享]")
                }
            }
            val rebuilt = sb.toString().trim()
            if (rebuilt.isNotEmpty()) {
                working = rebuilt
            }
        }

        val sanitized = working
            .replace(SYNTHETIC_BOT_HANDLE_REGEX, "@机器人")
            .replace(PACK_SHARE_TOKEN_REGEX, "[表情包分享]")
            .replace(STICKER_SHORTCODE_REGEX, "[表情]")
            .trim()

        if (sanitized.isNotEmpty()) {
            return sanitized.take(120)
        }

        val attachments = msg.optJSONArray("attachments")
        if (attachments != null && attachments.length() > 0) {
            val firstMime = attachments.optJSONObject(0)?.optString("mimeType").orEmpty()
            return if (firstMime.startsWith("image/")) "[图片]" else "[文件]"
        }
        if (msg.optJSONObject("card") != null) {
            return "[交互卡片]"
        }
        return "发来一条新消息"
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

    private fun notificationIdForConv(convId: String): Int {
        val h = convId.hashCode()
        if (h == 0 || h == 1001) return 2002
        return h
    }

    private fun isWorkspacePath(path: String, authenticated: Boolean): Boolean {
        return authenticated && path.startsWith("/ws/workspace")
    }

    private fun toWsOrigin(origin: String): String {
        return when {
            origin.startsWith("https://") -> "wss://" + origin.removePrefix("https://")
            origin.startsWith("http://") -> "ws://" + origin.removePrefix("http://")
            else -> origin
        }
    }

    companion object {
        private const val CHANNEL_MESSAGES = "duallane_messages"
        private const val MAX_BUFFERED_EVENTS = 160
        private const val MAX_MESSAGING_LINES = 5
        private val BACKOFF_STEPS_MS = longArrayOf(1500L, 3000L, 6000L, 15000L, 30000L)

        private val SYNTHETIC_BOT_HANDLE_REGEX = Regex("@__duallane_[A-Za-z0-9_-]+")
        private val PACK_SHARE_TOKEN_REGEX = Regex("\\[duallane-pack:[A-Za-z0-9_-]+\\]")
        private val STICKER_SHORTCODE_REGEX = Regex("\\[[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+\\]")

        @Volatile
        private var instance: RealtimeHub? = null

        fun getInstance(context: Context): RealtimeHub {
            return instance ?: synchronized(this) {
                instance ?: RealtimeHub(context.applicationContext).also { instance = it }
            }
        }

        fun parseNotificationContext(rawJson: String?): NotificationContextSnapshot {
            if (rawJson.isNullOrBlank()) return NotificationContextSnapshot()
            return runCatching {
                val obj = JSONObject(rawJson)
                val uid = obj.optString("currentUserId").trim()
                val uname = obj.optString("currentUserDisplayName").trim().ifBlank { "我" }

                val muteMap = HashMap<String, String>()
                obj.optJSONObject("muteMap")?.let { mObj ->
                    val keys = mObj.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        val v = mObj.optString(k).trim()
                        if (k.isNotEmpty() && (v == "all" || v == "mentions" || v == "muted")) {
                            muteMap[k] = v
                        }
                    }
                }

                val memberNames = HashMap<String, String>()
                obj.optJSONObject("memberNames")?.let { nObj ->
                    val keys = nObj.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        val v = nObj.optString(k).trim()
                        if (k.isNotEmpty() && v.isNotEmpty()) {
                            memberNames[k] = v
                        }
                    }
                }

                val convTitles = HashMap<String, String>()
                obj.optJSONObject("convTitles")?.let { tObj ->
                    val keys = tObj.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        val v = tObj.optString(k).trim()
                        if (k.isNotEmpty() && v.isNotEmpty()) {
                            convTitles[k] = v
                        }
                    }
                }

                val convKinds = HashMap<String, String>()
                obj.optJSONObject("convKinds")?.let { kObj ->
                    val keys = kObj.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        val v = kObj.optString(k).trim()
                        if (k.isNotEmpty() && v.isNotEmpty()) {
                            convKinds[k] = v
                        }
                    }
                }

                NotificationContextSnapshot(
                    currentUserId = uid,
                    currentUserDisplayName = uname,
                    muteMap = muteMap,
                    memberNames = memberNames,
                    convTitles = convTitles,
                    convKinds = convKinds,
                )
            }.getOrDefault(NotificationContextSnapshot())
        }
    }
}

class RealtimeManager(
    private val hub: RealtimeHub,
    private val emitWsEvent: (socketId: String, eventType: String, payload: String) -> Unit,
) {
    init {
        hub.attachUiBridge(emitWsEvent)
    }

    var isForeground: Boolean
        get() = hub.isUiForeground
        set(value) {
            hub.setUiForegroundState(value)
        }

    fun connect(socketId: String, path: String, authenticated: Boolean) {
        hub.connect(socketId, path, authenticated)
    }

    fun send(socketId: String, data: String) {
        hub.send(socketId, data)
    }

    fun close(socketId: String) {
        hub.close(socketId)
    }

    fun detachUi() {
        hub.detachUiBridge(emitWsEvent)
    }

    fun shutdownOnLogout() {
        hub.shutdownForLogoutOrOriginChange()
    }

    fun syncNotificationContext(json: String) {
        hub.syncNotificationContext(json)
    }

    fun clearConversationNotification(convId: String) {
        hub.clearConversationNotification(convId)
    }
}
