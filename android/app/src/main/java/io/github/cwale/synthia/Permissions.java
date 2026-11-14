package io.github.cwale.synthia;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import java.util.ArrayList;
import java.util.List;

/** Which runtime permissions this Android version wants, and whether we have them. */
final class Permissions {
    private Permissions() { }

    static String[] bluetooth() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return new String[] { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT };
        }
        // Android 11 and older tie Bluetooth scanning to location.
        return new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION };
    }

    static boolean hasBluetooth(Context c) {
        for (String p : bluetooth()) {
            if (c.checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        }
        return true;
    }

    /** Everything worth asking for up front: Bluetooth, and notifications on 13+. */
    static String[] missing(Context c) {
        List<String> out = new ArrayList<>();
        for (String p : bluetooth()) {
            if (c.checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) out.add(p);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            out.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        return out.toArray(new String[0]);
    }
}
