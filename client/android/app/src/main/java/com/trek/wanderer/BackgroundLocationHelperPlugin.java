package com.trek.wanderer;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

// @capacitor-community/background-geolocation only ever requests
// ACCESS_COARSE_LOCATION / ACCESS_FINE_LOCATION ("while using the app").
// On Android 10+ that is NOT enough on its own to guarantee GPS keeps
// running once the app leaves the foreground — plenty of OEM builds also
// need ACCESS_BACKGROUND_LOCATION ("Allow all the time") granted, and their
// battery managers kill the foreground service anyway unless the app is
// exempted from battery optimization. Android forces ACCESS_BACKGROUND_LOCATION
// to be requested as its own, separate prompt *after* foreground location is
// already granted — this plugin exists solely to do that second prompt and
// to offer the battery-optimization exemption screen.
@CapacitorPlugin(
        name = "BackgroundLocationHelper",
        permissions = {
                @Permission(
                        strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION },
                        alias = "background"
                )
        }
)
public class BackgroundLocationHelperPlugin extends Plugin {

    @PluginMethod
    public void checkBackgroundPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasBackgroundPermission());
        call.resolve(result);
    }

    @PluginMethod
    public void requestBackgroundPermission(PluginCall call) {
        if (hasBackgroundPermission()) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // No separate background permission before Android 10.
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        requestPermissionForAlias("background", call, "backgroundPermissionCallback");
    }

    @PermissionCallback
    private void backgroundPermissionCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasBackgroundPermission());
        call.resolve(result);
    }

    private boolean hasBackgroundPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
        return getPermissionState("background") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ignoring", isIgnoringBatteryOptimizations());
        call.resolve(result);
    }

    private boolean isIgnoringBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    // Opens the system "ignore battery optimizations" prompt for this app.
    // Requires REQUEST_IGNORE_BATTERY_OPTIMIZATIONS in the manifest. Some
    // OEMs (Xiaomi, Samsung, etc.) also have their own extra battery/auto-start
    // managers this can't reach — those still need manual whitelisting, which
    // openAppSettings() below at least gets the user one tap closer to.
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !isIgnoringBatteryOptimizations()) {
            try {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(intent);
            } catch (Exception ignore) {
                // Some OEM ROMs (custom battery managers) don't implement this
                // intent — fall through and just resolve, nothing more we can do.
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        getContext().startActivity(intent);
        call.resolve();
    }
}
