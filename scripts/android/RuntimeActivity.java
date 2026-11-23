package __APP_PACKAGE__;

import android.app.Activity;
import android.graphics.Color;
import android.net.http.SslError;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.ByteArrayInputStream;
import java.net.URI;
import java.util.Collections;

/** Native runtime window with no JS/native interface, separate from Capacitor's bundled UI. */
public class RuntimeActivity extends Activity {
    public static final String EXTRA_URL = "humanale.runtime.url";
    public static final String EXTRA_AUTH_ORIGIN = "humanale.runtime.authOrigin";
    private WebView webView;
    private TextView status;
    private URI target;
    private URI auth;
    private TextView source;
    private boolean failed;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            target = RuntimeUrlPolicy.parse(getIntent().getStringExtra(EXTRA_URL));
            String authOrigin = getIntent().getStringExtra(EXTRA_AUTH_ORIGIN);
            if (authOrigin != null && !authOrigin.isEmpty()) auth = RuntimeUrlPolicy.parse(authOrigin);
        }
        catch (IllegalArgumentException error) { finish(); return; }
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL); layout.setBackgroundColor(Color.rgb(12, 20, 30));
        source = new TextView(this); source.setTextColor(Color.WHITE);
        source.setPadding(16, 12, 16, 8); source.setText("NARA Runtime · " + RuntimeUrlPolicy.origin(target));
        layout.addView(source);
        LinearLayout controls = new LinearLayout(this);
        Button back = new Button(this); back.setText("Kembali"); back.setOnClickListener(v -> goBack());
        Button reload = new Button(this); reload.setText("Coba lagi"); reload.setOnClickListener(v -> webView.loadUrl(target.toASCIIString()));
        Button close = new Button(this); close.setText("Tutup"); close.setOnClickListener(v -> finish());
        controls.addView(back); controls.addView(reload); controls.addView(close); layout.addView(controls);
        status = new TextView(this); status.setTextColor(Color.LTGRAY); status.setPadding(16, 8, 16, 8);
        status.setText("Membuka server…"); layout.addView(status);
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false); settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
        });
        webView.setWebViewClient(new WebViewClient() {
            private boolean allowed(String url) {
                return RuntimeUrlPolicy.sameOrigin(target, url) || (auth != null && RuntimeUrlPolicy.sameOrigin(auth, url));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (allowed(request.getUrl().toString())) return false;
                status.setText("Navigasi ke asal lain diblokir. Buka alamat server dari aplikasi."); return true;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (allowed(url)) return false;
                status.setText("Navigasi ke asal lain diblokir."); return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (allowed(request.getUrl().toString())) return null;
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Origin blocked", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (!allowed(url)) { view.stopLoading(); fail("Redirect ke asal yang belum disetujui diblokir."); return; }
                source.setText("NARA Runtime · " + RuntimeUrlPolicy.origin(RuntimeUrlPolicy.parse(url)));
                failed = false; status.setText("Memuat server…");
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!failed) status.setText("Halaman server dimuat. Status runtime dan login ditampilkan oleh server.");
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) fail("Server tidak dapat dijangkau. Jalankan Termux atau periksa alamat dan internet.");
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) fail("Server mengembalikan HTTP " + response.getStatusCode() + ".");
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel(); fail("Sertifikat HTTPS tidak valid. Koneksi dibatalkan.");
            }
        });
        layout.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1f));
        setContentView(layout);
        webView.loadUrl(target.toASCIIString());
    }

    private void fail(String message) { failed = true; status.setText(message); }
    private void goBack() { if (webView != null && webView.canGoBack()) webView.goBack(); else finish(); }
    @Override public void onBackPressed() { goBack(); }
    @Override protected void onDestroy() {
        if (webView != null) { webView.stopLoading(); webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
