package io.github.cwale.synthia;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Synthia as an installed app: the web app in a WebView, with the two things
 * a browser can't give it on Android — a native keyboard connection
 * (MidiBridge) and permission to keep running with the screen off
 * (SynthiaService).
 *
 * The live site is loaded, so every web fix arrives without reinstalling.
 * A copy is bundled in the APK for the case where the phone is offline and
 * has never loaded the site; once it has, the site's service worker serves
 * it offline anyway.
 */
public class MainActivity extends Activity {
    static final String ACTION_QUIT = "io.github.cwale.synthia.QUIT";
    private static final String TAG = "Synthia";
    private static final String LIVE = "https://cwale.github.io/Synthia/";
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String BUNDLED = "https://" + ASSET_HOST + "/assets/www/index.html";
    private static final int PERMISSIONS = 1;

    /** Only these pages get the native bridge. */
    private static final Set<String> TRUSTED = new HashSet<>();
    static {
        TRUSTED.add("https://cwale.github.io");
        TRUSTED.add("https://" + ASSET_HOST);
    }

    private WebView web;
    private MidiBridge midi;
    private WebViewAssetLoader assets;
    private boolean fellBack;

    @SuppressLint({ "SetJavaScriptEnabled", "AddJavascriptInterface" })
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (ACTION_QUIT.equals(getIntent().getAction())) {
            finishAndRemoveTask();
            return;
        }

        assets = new WebViewAssetLoader.Builder()
                .setDomain(ASSET_HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0A0B0F"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // Audio is started by the splash screen's tap anyway; this just stops
        // the WebView from refusing it on a technicality.
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        // Keep the page's renderer at full priority while hidden, so Android
        // doesn't starve the audio when the screen goes off.
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);

        midi = new MidiBridge(this, new MidiBridge.Listener() {
            @Override
            public void onMessages(List<int[]> messages) {
                StringBuilder js = new StringBuilder("window.__synthiaMidi&&[");
                for (int i = 0; i < messages.size(); i++) {
                    int[] m = messages.get(i);
                    if (i > 0) js.append(',');
                    js.append('[').append(m[0]).append(',').append(m[1]).append(',').append(m[2]).append(']');
                }
                js.append("].forEach(function(m){window.__synthiaMidi(m)})");
                runJs(js.toString());
            }

            @Override
            public void onStatus(String status, String name) {
                runJs("window.__synthiaMidiStatus&&window.__synthiaMidiStatus({status:" + JSONObject.quote(status)
                        + ",name:" + JSONObject.quote(name == null ? "" : name) + "})");
                updateNotification();
            }
        });

        web.addJavascriptInterface(new Bridge(), "SynthiaAndroid");
        installShim();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (isTrusted(url)) return false;
                // Anything else — a link in the docs, say — opens in the browser.
                startActivity(new Intent(Intent.ACTION_VIEW, url));
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (lateShim != null && isTrusted(Uri.parse(url))) view.evaluateJavascript(lateShim, null);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && !fellBack) {
                    Log.w(TAG, "live site unavailable (" + error.getDescription() + "), using the bundled copy");
                    fellBack = true;
                    view.loadUrl(BUNDLED);
                }
            }
        });

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Back sends the app to the background instead of closing it.
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, () -> moveTaskToBack(true));
        }

        setContentView(web);
        web.loadUrl(LIVE);

        String[] missing = Permissions.missing(this);
        if (missing.length > 0) requestPermissions(missing, PERMISSIONS);
        SynthiaService.start(this, getString(R.string.notification_waiting));
    }

    private static boolean isTrusted(Uri url) {
        return url != null && TRUSTED.contains(url.getScheme() + "://" + url.getHost());
    }

    /**
     * Defines window.SynthiaNative — the contract js/midi/native.js expects —
     * on top of the Java interface, before any of the page's own scripts run.
     */
    private void installShim() {
        String shim = "(function(){"
                + "if(!window.SynthiaAndroid||window.SynthiaNative)return;"
                + "var pending={},seq=0;"
                + "window.__synthiaNativeResolve=function(id,ok,v){var p=pending[id];if(!p)return;delete pending[id];ok?p.resolve(v):p.reject(new Error(v||'failed'));};"
                + "function call(m){var a=[].slice.call(arguments,1);return new Promise(function(res,rej){var id=String(++seq);pending[id]={resolve:res,reject:rej};"
                + "window.SynthiaAndroid[m].apply(window.SynthiaAndroid,[id].concat(a));});}"
                + "window.SynthiaNative={platform:'android',persistent:true,"
                + "rememberedId:function(){return window.SynthiaAndroid.rememberedId()||null;},"
                + "listDevices:function(){return call('listDevices');},"
                + "connect:function(id){return call('connect',id);},"
                + "disconnect:function(){window.SynthiaAndroid.disconnect();}};"
                + "})();";
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, shim, TRUSTED);
        } else {
            // Older WebViews: injected when each page finishes loading instead.
            // The page only looks for the bridge when it connects, after a tap.
            Log.w(TAG, "document-start scripts unsupported; bridge injected on page load");
            lateShim = shim;
        }
    }

    /** Set only when the shim must be injected after load, on old WebViews. */
    private String lateShim;

    private void runJs(String js) {
        runOnUiThread(() -> {
            if (web != null) web.evaluateJavascript(js, null);
        });
    }

    private void resolve(String id, boolean ok, String jsonValue) {
        runJs("window.__synthiaNativeResolve&&window.__synthiaNativeResolve(" + JSONObject.quote(id) + ","
                + ok + "," + jsonValue + ")");
    }

    private void updateNotification() {
        String text = midi != null && midi.isConnected()
                ? getString(R.string.notification_connected, midi.currentName())
                : getString(R.string.notification_waiting);
        SynthiaService.update(this, text);
    }

    /** What the page can call. Every method runs on a binder thread. */
    private final class Bridge {
        @JavascriptInterface
        public String rememberedId() {
            return midi.rememberedId();
        }

        @JavascriptInterface
        public void listDevices(String callId) {
            runOnUiThread(() -> {
                if (!Permissions.hasBluetooth(MainActivity.this)) {
                    requestPermissions(Permissions.bluetooth(), PERMISSIONS);
                }
                midi.listDevices(devices -> {
                    JSONArray arr = new JSONArray();
                    for (Map<String, String> d : devices) arr.put(new JSONObject(d));
                    resolve(callId, true, arr.toString());
                });
            });
        }

        @JavascriptInterface
        public void connect(String callId, String id) {
            runOnUiThread(() -> midi.connect(id, (ok, error) ->
                    resolve(callId, ok, ok ? "null" : JSONObject.quote(error == null ? "failed" : error))));
        }

        @JavascriptInterface
        public void disconnect() {
            runOnUiThread(() -> midi.disconnect());
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (ACTION_QUIT.equals(intent.getAction())) {
            finishAndRemoveTask();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        // Bluetooth may just have been allowed: restart the service so it can
        // claim the "connected device" role it couldn't before. We're in the
        // foreground here, which is when starting it is permitted.
        SynthiaService.start(this, midi != null && midi.isConnected()
                ? getString(R.string.notification_connected, midi.currentName())
                : getString(R.string.notification_waiting));
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        moveTaskToBack(true);
    }

    /*
     * Deliberately no web.onPause() / pauseTimers() in onPause or onStop: those
     * are what stop a WebView's JavaScript and media, and keeping them running
     * in the background is the point of this app.
     */

    @Override
    protected void onDestroy() {
        if (isFinishing()) {
            if (midi != null) midi.release();
            SynthiaService.stop(this);
            if (web != null) {
                web.destroy();
                web = null;
            }
        }
        super.onDestroy();
    }
}
