package com.pocketledger.app;

import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import java.io.File;

public class MainActivity extends BridgeActivity {
    private static final String UPGRADE_PREFS = "pl_apk_upgrade_cache";
    private static final String BUILD_MARKER_KEY = "build_marker";
    /** True only on the first launch after an APK update; avoids wiping the WebView code cache on every cold start. */
    private boolean cachesClearedThisLaunch = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackupSafPlugin.class);
        registerPlugin(FormFactorPlugin.class);
        registerPlugin(com.pocketledger.app.wedge.shared.WedgePlugin.class);
        clearWebViewCachesAfterApkUpdate();
        super.onCreate(savedInstanceState);
        // Samsung / Android 13+ WebView: algorithmic force-dark gradients aur border tones browser se alag dikha sakta — explict OFF (styles.xml se saath).
        disableWebViewAlgorithmicDarkening();
        if (cachesClearedThisLaunch) clearCurrentWebViewHttpCacheAfterApkUpdate();
    }

    @Override
    public void onStart() {
        super.onStart();
        // Unassigned camera scan uses getUserMedia; the WebView denies it unless granted here.
        grantWebViewMediaPermissions();
    }

    /**
     * Allow the bundled WebView to use the camera for `getUserMedia` (document scan button).
     * Still gated by the runtime CAMERA permission below, so the user sees the Android prompt.
     */
    private void grantWebViewMediaPermissions() {
        try {
            Bridge b = getBridge();
            if (b == null) return;
            WebView wv = b.getWebView();
            if (wv == null) return;
            wv.setWebChromeClient(new com.getcapacitor.BridgeWebChromeClient(b) {
                @Override
                public void onPermissionRequest(final android.webkit.PermissionRequest request) {
                    runOnUiThread(() -> {
                        try {
                            boolean needsCamera = false;
                            for (String r : request.getResources()) {
                                if (android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) {
                                    needsCamera = true;
                                    break;
                                }
                            }
                            if (!needsCamera) {
                                request.deny();
                                return;
                            }
                            if (isCameraGranted()) {
                                request.grant(new String[] { android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE });
                                return;
                            }
                            // Pehli baar: OS prompt dikhao; grant tab karo jab user Allow kare —
                            // warna getUserMedia turant reject ho kar native picker fallback par chala jata hai.
                            pendingCameraRequest = request;
                            requestPermissions(new String[] { android.Manifest.permission.CAMERA }, CAMERA_PERMISSION_REQUEST);
                        } catch (Throwable ignored) {
                            /* ignore */
                        }
                    });
                }
            });
        } catch (Throwable ignored) {
            /* Bridge/WebView init race — ignore */
        }
    }

    private static final int CAMERA_PERMISSION_REQUEST = 7711;
    /** Pehla getUserMedia request jab tak user OS prompt ka jawab na de. */
    private android.webkit.PermissionRequest pendingCameraRequest;

    private boolean isCameraGranted() {
        return checkSelfPermission(android.Manifest.permission.CAMERA)
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != CAMERA_PERMISSION_REQUEST) return;
        android.webkit.PermissionRequest pending = pendingCameraRequest;
        pendingCameraRequest = null;
        if (pending == null) return;
        try {
            if (isCameraGranted() && grantResults.length > 0
                    && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                pending.grant(new String[] { android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE });
            } else {
                // Denied — getUserMedia reject hoga aur app native camera picker par fallback karegi.
                pending.deny();
            }
        } catch (Throwable ignored) {
            /* ignore */
        }
    }

    /** Chromium WebView FORCE_DARK_OFF — `color-scheme` CSS ke alava native layer bhi light palette pakki karo (S25 APK vs Chrome). */
    private void disableWebViewAlgorithmicDarkening() {
        try {
            Bridge b = getBridge();
            if (b == null) return;
            WebView wv = b.getWebView();
            if (wv == null) return;
            if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
                WebSettingsCompat.setForceDark(wv.getSettings(), WebSettingsCompat.FORCE_DARK_OFF);
            }
        } catch (Throwable ignored) {
            /* Bridge/WebView init race — ignore */
        }
    }
    /** APK update: purana bundled JS/CSS/WebView HTTP cache hatao; SQLite/IndexedDB/localStorage safe rakho. */
    private void clearWebViewCachesAfterApkUpdate() {
        try {
            String marker = currentApkBuildMarker();
            SharedPreferences prefs = getSharedPreferences(UPGRADE_PREFS, MODE_PRIVATE);
            String previous = prefs.getString(BUILD_MARKER_KEY, "");
            if (marker.equals(previous)) return;

            deleteDirContents(getCacheDir());
            deleteDirContents(new File(getDataDir(), "cache"));
            deleteDirContents(new File(getDataDir(), "code_cache"));
            deleteDirContents(new File(getDataDir(), "app_webview/Default/HTTP Cache"));
            deleteDirContents(new File(getDataDir(), "app_webview/Default/Code Cache"));
            deleteDirContents(new File(getDataDir(), "app_webview/Default/GPUCache"));
            deleteDirContents(new File(getDataDir(), "app_webview/Default/Service Worker/CacheStorage"));
            deleteDirContents(new File(getDataDir(), "app_webview/Default/Service Worker/ScriptCache"));

            prefs.edit().putString(BUILD_MARKER_KEY, marker).apply();
            cachesClearedThisLaunch = true;
        } catch (Throwable ignored) {
            /* Cache refresh best-effort; app boot must continue. */
        }
    }

    private void clearCurrentWebViewHttpCacheAfterApkUpdate() {
        try {
            Bridge b = getBridge();
            if (b == null) return;
            WebView wv = b.getWebView();
            if (wv == null) return;
            wv.clearCache(true);
        } catch (Throwable ignored) {
            /* Bridge/WebView init race - ignore */
        }
    }

    private String currentApkBuildMarker() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return info.versionName + ":" + info.versionCode + ":" + info.lastUpdateTime;
        } catch (Throwable ignored) {
            return "unknown";
        }
    }

    private void deleteDirContents(File dir) {
        if (dir == null || !dir.exists()) return;
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            deleteRecursively(f);
        }
    }

    private void deleteRecursively(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) {
                for (File child : children) deleteRecursively(child);
            }
        }
        try {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        } catch (Throwable ignored) {
            /* best-effort */
        }
    }
}
