package com.pocketledger.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import androidx.browser.customtabs.CustomTabsIntent;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens a URL in the device's real external browser (Chrome / whatever the user chose), NOT in an
 * in-app Custom Tab.
 *
 * Why this exists: Capacitor's own `Browser` plugin opens a Custom Tab — a chrome-less web view
 * layered over the app. It has no visible close button of its own on some devices, the Android
 * back gesture is swallowed by it, and the user gets stuck on a page with no way out. An ordinary
 * VIEW intent hands the URL to the browser app, which owns its own toolbar, its own back stack,
 * and returns the user to Pocket Ledger when they press back.
 *
 * `openExternal` is the safe default. `openCustomTab` keeps the old behaviour for flows that must
 * stay inside the app (e.g. an OAuth hand-off that has to come back to a redirect URI).
 */
@CapacitorPlugin(name = "ExternalBrowser")
public class ExternalBrowserPlugin extends Plugin {

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.trim().isEmpty()) {
            call.reject("url is required");
            return;
        }
        Uri uri = Uri.parse(url.trim());
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if (!scheme.equals("http") && !scheme.equals("https")) {
            call.reject("only http(s) urls can be opened externally");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            // A separate task so the app keeps its own back stack and comes back intact.
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
            return;
        } catch (ActivityNotFoundException ignored) {
            // No browser installed — fall through to the Custom Tab, which at least stays in-app.
        }
        openCustomTabInternal(url.trim());
        call.resolve();
    }

    @PluginMethod
    public void openCustomTab(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.trim().isEmpty()) {
            call.reject("url is required");
            return;
        }
        openCustomTabInternal(url.trim());
        call.resolve();
    }

    private void openCustomTabInternal(String url) {
        try {
            CustomTabsIntent customTabsIntent = new CustomTabsIntent.Builder().build();
            customTabsIntent.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            customTabsIntent.launchUrl(getContext(), Uri.parse(url));
        } catch (Exception ignored) {
            // Nothing else to do; the caller already showed the user a message if it needed to.
        }
    }
}
