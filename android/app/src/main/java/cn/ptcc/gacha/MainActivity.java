package cn.ptcc.gacha;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {
    private static final String IMG_HOST = "tcg.mik.moe";
    private static final String IMG_PREFIX = "/static/img/";
    private static final String ICON_PREFIX = "/static/setCode/";

    private WebView webView;
    private File imgCacheDir;
    private File storeFile;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0b0f1a"));
        setContentView(webView);

        imgCacheDir = new File(getCacheDir(), "imgcache");
        storeFile = new File(getFilesDir(), "user_store.json");

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        // file:// 资产直连 mik.moe 的卡图与详情接口，需要放开跨域
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.addJavascriptInterface(new NativeBridge(), "PTCGNative");
        // 更新包下载交给系统浏览器（WebView 自身没有下载管理）
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)));
            } catch (Exception ignored) {}
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return intercept(request);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            // 默认弹窗会带"file:// 网页提示"前缀，自绘去掉来源显示
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                showJsDialog(view, message, false, result);
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                showJsDialog(view, message, true, result);
                return true;
            }

            private void showJsDialog(WebView view, String message, boolean cancellable, final JsResult result) {
                AlertDialog.Builder b = new AlertDialog.Builder(view.getContext())
                        .setTitle("PTCG拆卡模拟器")
                        .setMessage(message)
                        .setPositiveButton("确定", (d, w) -> result.confirm());
                if (cancellable) {
                    b.setNegativeButton("取消", (d, w) -> result.cancel());
                    b.setOnCancelListener(d -> result.cancel());
                }
                b.show();
            }
        });
        webView.setVisibility(View.VISIBLE);
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    /** 卡图请求经原生磁盘缓存：命中直接回本地文件，未命中下载后落盘再回源内容 */
    private WebResourceResponse intercept(WebResourceRequest request) {
        android.net.Uri uri = request.getUrl();
        if (!IMG_HOST.equals(uri.getHost())) return null;
        String path = uri.getPath();
        if (path == null || (!path.startsWith(IMG_PREFIX) && !path.startsWith(ICON_PREFIX))) return null;
        if (path.contains("..")) return null;

        File dest = new File(imgCacheDir, path);
        if (!dest.isFile()) {
            if (!download(uri.toString(), dest)) return null; // 交给 WebView 自行请求
        }
        try {
            WebResourceResponse r = new WebResourceResponse("image/png", null, new FileInputStream(dest));
            r.setResponseHeaders(java.util.Collections.singletonMap("Access-Control-Allow-Origin", "*"));
            return r;
        } catch (IOException e) {
            return null;
        }
    }

    private boolean download(String spec, File dest) {
        File tmp = new File(dest.getParentFile(), dest.getName() + "." + System.nanoTime() + ".tmp");
        InputStream in = null;
        FileOutputStream out = null;
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(spec).openConnection();            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            if (conn.getResponseCode() != HttpURLConnection.HTTP_OK) {
                conn.disconnect();
                return false;
            }
            //noinspection ResultOfMethodCallIgnored
            dest.getParentFile().mkdirs();
            in = conn.getInputStream();
            out = new FileOutputStream(tmp);
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.flush();
            if (!tmp.renameTo(dest)) {
                // 并发下载同一文件时目标已存在，丢弃本份临时文件即可
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
            }
            return dest.isFile();
        } catch (IOException e) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            return false;
        } finally {
            try { if (in != null) in.close(); } catch (IOException ignored) {}
            try { if (out != null) out.close(); } catch (IOException ignored) {}
        }
    }

    private static String humanSize(long bytes) {
        if (bytes < 1024) return bytes + " B";
        double mb = bytes / 1048576.0;
        if (mb < 1) return String.format("%.0f KB", mb * 1024);
        return String.format("%.1f MB", mb);
    }

    private static long dirSize(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return 0;
        long total = 0;
        for (File f : files) total += f.isDirectory() ? dirSize(f) : f.length();
        return total;
    }

    private static void deleteRecursive(File dir) {
        File[] files = dir.listFiles();
        if (files != null) for (File f : files) {
            if (f.isDirectory()) deleteRecursive(f);
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }

    /** 设置页桥：同步调用（运行在 JavaBridge 线程，允许文件 IO） */
    private class NativeBridge {
        @JavascriptInterface
        public String cacheSize() {
            return humanSize(dirSize(imgCacheDir));
        }

        @JavascriptInterface
        public String clearCache() {
            deleteRecursive(imgCacheDir);
            //noinspection ResultOfMethodCallIgnored
            imgCacheDir.mkdirs();
            return "ok";
        }

        /** 抽卡记录/收藏册持久化（localStorage 在 WebView 重启后不保证保留） */
        @JavascriptInterface
        public void saveStore(String json) {
            try {
                FileOutputStream out = new FileOutputStream(storeFile);
                out.write(json.getBytes("UTF-8"));
                out.close();
            } catch (IOException ignored) {}
        }

        @JavascriptInterface
        public String loadStore() {
            try {
                FileInputStream in = new FileInputStream(storeFile);
                byte[] buf = new byte[(int) storeFile.length()];
                int n = in.read(buf);
                in.close();
                return n > 0 ? new String(buf, "UTF-8") : "";
            } catch (IOException e) {
                return "";
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
