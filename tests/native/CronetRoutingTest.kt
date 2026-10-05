package com.timestarry.duallane

import java.io.IOException
import java.lang.reflect.Proxy
import okhttp3.Interceptor
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class CronetRoutingTest {
  private class Harness {
    var nativeCalls = 0
    var cronetCalls = 0
    var nativeFailure: IOException? = null
    private val cronet = Interceptor { chain ->
      cronetCalls++
      response(chain.request(), 200, "cronet")
    }
    private val wrapper = CronetNetworking.webSocketAwareInterceptor(cronet)

    fun route(vararg headers: Pair<String, String>): Response {
      val request = Request.Builder().url("https://example.invalid/").apply {
        headers.forEach { (name, value) -> addHeader(name, value) }
      }.build()
      val chain = Proxy.newProxyInstance(
        Interceptor.Chain::class.java.classLoader,
        arrayOf(Interceptor.Chain::class.java),
      ) { _, method, arguments ->
        when (method.name) {
          "request" -> request
          "proceed" -> {
            assertSame(request, arguments!![0])
            nativeCalls++
            nativeFailure?.let { throw it }
            response(request, 101, "native")
          }
          else -> throw AssertionError("Unexpected interceptor chain operation: ${method.name}")
        }
      } as Interceptor.Chain
      return wrapper.intercept(chain)
    }

    companion object {
      private fun response(request: Request, code: Int, message: String) = Response.Builder()
        .request(request).protocol(Protocol.HTTP_1_1).code(code).message(message).build()
    }
  }

  @Test fun ordinaryHttpUsesCronet() {
    val harness = Harness()
    assertEquals("cronet", harness.route().message)
    assertEquals(0, harness.nativeCalls)
    assertEquals(1, harness.cronetCalls)
  }

  @Test fun websocketHandshakeUsesNativeExchange() {
    val harness = Harness()
    assertEquals("native", harness.route("Upgrade" to "websocket", "Connection" to "Upgrade").message)
    assertEquals(1, harness.nativeCalls)
    assertEquals(0, harness.cronetCalls)
  }

  @Test fun repeatedCaseInsensitiveCommaSeparatedHeadersStillUpgrade() {
    val harness = Harness()
    assertEquals("native", harness.route(
      "uPgRaDe" to "h2c", "Upgrade" to " WEBSOCKET ",
      "Connection" to "keep-alive", "cOnNeCtIoN" to " keep-alive , UpGrAdE ",
    ).message)
    assertEquals(1, harness.nativeCalls)
    assertEquals(0, harness.cronetCalls)
  }

  @Test fun bothUpgradeHeadersAreRequired() {
    val harness = Harness()
    assertEquals("cronet", harness.route("Upgrade" to "websocket").message)
    assertEquals("cronet", harness.route("Connection" to "upgrade").message)
    assertEquals(0, harness.nativeCalls)
    assertEquals(2, harness.cronetCalls)
  }

  @Test fun unrelatedUpgradeRetainsCronet() {
    val harness = Harness()
    assertEquals("cronet", harness.route("Upgrade" to "h2c", "Connection" to "upgrade").message)
    assertEquals("cronet", harness.route("Upgrade" to "websocket", "Connection" to "keep-alive").message)
    assertEquals(0, harness.nativeCalls)
    assertEquals(2, harness.cronetCalls)
  }

  @Test fun tokenSubstringsDoNotBypassCronet() {
    val harness = Harness()
    assertEquals("cronet", harness.route("Upgrade" to "notwebsocket", "Connection" to "upgrade").message)
    assertEquals("cronet", harness.route("Upgrade" to "websocket", "Connection" to "notupgrade").message)
    assertEquals(0, harness.nativeCalls)
    assertEquals(2, harness.cronetCalls)
  }

  @Test fun oneWrapperReusesItsCronetDelegateAcrossMixedRequests() {
    val harness = Harness()
    assertEquals("cronet", harness.route().message)
    assertEquals("native", harness.route("Upgrade" to "websocket", "Connection" to "upgrade").message)
    assertEquals("cronet", harness.route().message)
    assertEquals(1, harness.nativeCalls)
    assertEquals(2, harness.cronetCalls)
  }

  @Test fun nativeHandshakeFailureDoesNotFallBackToCronet() {
    val harness = Harness()
    val failure = IOException("Synthetic native handshake failure")
    harness.nativeFailure = failure
    try {
      harness.route("Upgrade" to "websocket", "Connection" to "upgrade")
      throw AssertionError("Expected the native failure")
    } catch (actual: IOException) {
      assertSame(failure, actual)
    }
    assertEquals(1, harness.nativeCalls)
    assertEquals(0, harness.cronetCalls)
  }
}
