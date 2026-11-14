package io.github.cwale.synthia;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.SharedPreferences;
import android.media.midi.MidiDevice;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiManager;
import android.media.midi.MidiOutputPort;
import android.media.midi.MidiReceiver;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.os.SystemClock;
import android.util.Log;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The keyboard connection, done natively.
 *
 * Android's WebView has neither Web MIDI nor Web Bluetooth, so the page can't
 * reach the keyboard itself. This finds it over Bluetooth LE, opens it through
 * Android's MIDI service — which speaks the BLE-MIDI protocol for us — and
 * hands every complete message to the page.
 *
 * Device ids are "ble:AA:BB:CC:DD:EE:FF" for a Bluetooth keyboard, which can be
 * opened directly from a remembered address with no scan, and "midi:12" for
 * anything Android already lists (a USB keyboard, say).
 */
final class MidiBridge {
    private static final String TAG = "SynthiaMidi";
    /** The BLE-MIDI service every Bluetooth MIDI instrument advertises. */
    static final ParcelUuid MIDI_SERVICE =
            ParcelUuid.fromString("03B80E5A-EDE8-4B33-A751-6CE34EC4C700");
    /** Keyboards that don't advertise the service still have telling names. */
    private static final Pattern MIDI_NAME = Pattern.compile("(?i)midi|smk|m-?vave|keystation|launchkey|akai|korg|roland|yamaha");
    private static final long SCAN_MS = 3500;
    private static final long RETRY_MS = 4000;
    private static final long OPEN_TIMEOUT_MS = 12000;
    /** Tags the retry and open-timeout callbacks, so disconnect() can cancel
     *  exactly those and not, say, a scan that is still running. */
    private static final Object RETRY = new Object();

    interface Listener {
        /** A batch of complete MIDI messages, each [status, data1, data2]. */
        void onMessages(List<int[]> messages);
        /** "connecting", "connected", "waiting" (reconnecting) or "idle". */
        void onStatus(String status, String name);
    }

    interface DevicesCallback {
        void onDevices(List<Map<String, String>> devices);
    }

    interface ResultCallback {
        void onResult(boolean ok, String error);
    }

    private final Context context;
    private final Listener listener;
    private final MidiManager midi;
    private final BluetoothAdapter adapter;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final SharedPreferences prefs;

    private MidiDevice device;
    private MidiOutputPort port;
    private String currentId;
    private String currentName = "";
    /** True while we should keep trying to get the keyboard back. */
    private boolean wanted;
    private int attempt;

    MidiBridge(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
        this.midi = (MidiManager) context.getSystemService(Context.MIDI_SERVICE);
        BluetoothManager bm = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        this.adapter = bm != null ? bm.getAdapter() : null;
        this.prefs = context.getSharedPreferences("midi", Context.MODE_PRIVATE);
        if (midi != null) {
            midi.registerDeviceCallback(new MidiManager.DeviceCallback() {
                @Override
                public void onDeviceRemoved(MidiDeviceInfo info) {
                    if (device != null && device.getInfo().getId() == info.getId()) {
                        Log.i(TAG, "device removed: " + currentName);
                        dropConnection();
                        if (wanted) {
                            listener.onStatus("waiting", currentName);
                            scheduleRetry();
                        }
                    }
                }
            }, handler);
        }
    }

    String rememberedId() {
        return prefs.getString("lastId", null);
    }

    String currentName() {
        return currentName;
    }

    boolean isConnected() {
        return port != null;
    }

    /* ---- finding devices ------------------------------------------------- */

    /**
     * Everything that looks like a MIDI instrument: whatever Android already
     * lists, bonded Bluetooth devices with MIDI-ish names, and a short scan for
     * anything advertising the BLE-MIDI service.
     */
    @SuppressLint("MissingPermission")
    void listDevices(DevicesCallback callback) {
        Map<String, Map<String, String>> found = new LinkedHashMap<>();

        if (midi != null) {
            for (MidiDeviceInfo info : midi.getDevices()) {
                if (info.getOutputPortCount() == 0) continue;   // can't send us anything
                Bundle props = info.getProperties();
                String name = props.getString(MidiDeviceInfo.PROPERTY_NAME, "MIDI device");
                BluetoothDevice bt = props.getParcelable(MidiDeviceInfo.PROPERTY_BLUETOOTH_DEVICE);
                String id = bt != null ? "ble:" + bt.getAddress() : "midi:" + info.getId();
                found.put(id, entry(id, name));
            }
        }

        if (adapter == null || !adapter.isEnabled() || !Permissions.hasBluetooth(context)) {
            callback.onDevices(new ArrayList<>(found.values()));
            return;
        }

        try {
            for (BluetoothDevice bt : adapter.getBondedDevices()) {
                String name = bt.getName();
                if (name != null && MIDI_NAME.matcher(name).find()) {
                    found.putIfAbsent("ble:" + bt.getAddress(), entry("ble:" + bt.getAddress(), name));
                }
            }
        } catch (SecurityException e) {
            Log.w(TAG, "bonded devices unavailable", e);
        }

        BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) {
            callback.onDevices(new ArrayList<>(found.values()));
            return;
        }
        ScanCallback scan = new ScanCallback() {
            @Override
            public void onScanResult(int type, ScanResult result) {
                BluetoothDevice bt = result.getDevice();
                ScanRecord record = result.getScanRecord();
                String name = bt.getName();
                if (name == null && record != null) name = record.getDeviceName();
                boolean advertisesMidi = record != null && record.getServiceUuids() != null
                        && record.getServiceUuids().contains(MIDI_SERVICE);
                boolean looksMidi = name != null && MIDI_NAME.matcher(name).find();
                if (advertisesMidi || looksMidi) {
                    String id = "ble:" + bt.getAddress();
                    found.putIfAbsent(id, entry(id, name != null ? name : "Bluetooth MIDI"));
                }
            }
        };
        try {
            ScanSettings settings = new ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
            scanner.startScan(null, settings, scan);
        } catch (SecurityException e) {
            Log.w(TAG, "scan refused", e);
            callback.onDevices(new ArrayList<>(found.values()));
            return;
        }
        handler.postDelayed(() -> {
            try {
                scanner.stopScan(scan);
            } catch (SecurityException | IllegalStateException ignored) {
                // Bluetooth was switched off mid-scan; what we found still stands.
            }
            callback.onDevices(new ArrayList<>(found.values()));
        }, SCAN_MS);
    }

    private static Map<String, String> entry(String id, String name) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("name", name);
        return m;
    }

    /* ---- connecting ------------------------------------------------------ */

    void connect(String id, ResultCallback callback) {
        disconnect();
        wanted = true;
        attempt = 0;
        currentId = id;
        open(id, callback);
    }

    @SuppressLint("MissingPermission")
    private void open(String id, ResultCallback callback) {
        if (midi == null) {
            callback.onResult(false, "This phone has no MIDI support");
            return;
        }
        listener.onStatus("connecting", currentName);
        final boolean[] settled = { false };
        MidiManager.OnDeviceOpenedListener opened = d -> {
            if (settled[0]) {
                // Opened after we gave up on it: don't leak it.
                if (d != null) closeQuietly(d);
                return;
            }
            settled[0] = true;
            if (d == null) {
                callback.onResult(false, "The keyboard didn't answer");
                return;
            }
            attach(d, id);
            callback.onResult(true, null);
        };

        try {
            if (id.startsWith("ble:")) {
                if (adapter == null || !adapter.isEnabled()) {
                    callback.onResult(false, "Bluetooth is off");
                    return;
                }
                if (!Permissions.hasBluetooth(context)) {
                    callback.onResult(false, "Bluetooth permission not granted");
                    return;
                }
                BluetoothDevice bt = adapter.getRemoteDevice(id.substring(4));
                if (currentName.isEmpty() && bt.getName() != null) currentName = bt.getName();
                midi.openBluetoothDevice(bt, opened, handler);
            } else if (id.startsWith("midi:")) {
                int wantedId = Integer.parseInt(id.substring(5));
                MidiDeviceInfo match = null;
                for (MidiDeviceInfo info : midi.getDevices()) {
                    if (info.getId() == wantedId) match = info;
                }
                if (match == null) {
                    callback.onResult(false, "That device is no longer connected");
                    return;
                }
                midi.openDevice(match, opened, handler);
            } else {
                callback.onResult(false, "Unknown device id " + id);
                return;
            }
        } catch (SecurityException | IllegalArgumentException e) {
            callback.onResult(false, e.getMessage());
            return;
        }

        // Android never calls back for a Bluetooth keyboard that is switched
        // off, so put a limit on the wait.
        handler.postAtTime(() -> {
            if (!settled[0]) {
                settled[0] = true;
                callback.onResult(false, "Timed out waiting for the keyboard");
            }
        }, RETRY, SystemClock.uptimeMillis() + OPEN_TIMEOUT_MS);
    }

    private void attach(MidiDevice d, String id) {
        MidiDeviceInfo info = d.getInfo();
        String name = info.getProperties().getString(MidiDeviceInfo.PROPERTY_NAME);
        if (name != null) currentName = name;
        // An instrument's "output" port is the one it sends to us on.
        if (info.getOutputPortCount() == 0) {
            closeQuietly(d);
            listener.onStatus("idle", currentName);
            return;
        }
        MidiOutputPort p = d.openOutputPort(0);
        if (p == null) {
            closeQuietly(d);
            listener.onStatus("idle", currentName);
            return;
        }
        p.connect(new Parser());
        device = d;
        port = p;
        attempt = 0;
        prefs.edit().putString("lastId", id).putString("lastName", currentName).apply();
        listener.onStatus("connected", currentName);
        Log.i(TAG, "connected to " + currentName);
    }

    /** Keep trying to reopen a keyboard that went away, until told to stop. */
    private void scheduleRetry() {
        if (!wanted || currentId == null) return;
        long delay = Math.min(RETRY_MS * (1L << Math.min(attempt, 3)), 30000);
        attempt++;
        handler.postAtTime(() -> {
            if (!wanted || isConnected()) return;
            open(currentId, (ok, err) -> {
                if (!ok) {
                    listener.onStatus("waiting", currentName);
                    scheduleRetry();
                }
            });
        }, RETRY, SystemClock.uptimeMillis() + delay);
    }

    void disconnect() {
        wanted = false;
        handler.removeCallbacksAndMessages(RETRY);
        boolean was = isConnected();
        dropConnection();
        if (was) listener.onStatus("idle", currentName);
    }

    private void dropConnection() {
        if (port != null) {
            try { port.close(); } catch (IOException ignored) { }
            port = null;
        }
        if (device != null) {
            closeQuietly(device);
            device = null;
        }
    }

    private static void closeQuietly(MidiDevice d) {
        try { d.close(); } catch (IOException ignored) { }
    }

    void release() {
        disconnect();
    }

    /* ---- parsing --------------------------------------------------------- */

    /**
     * Turns the byte stream into whole channel messages. Android delivers BLE
     * MIDI already decoded, but one callback can carry several messages and
     * may rely on running status. Clock and other real-time bytes are dropped
     * here, as the page would drop them anyway; SysEx is skipped.
     */
    private final class Parser extends MidiReceiver {
        private int running;
        private final int[] data = new int[2];
        private int have;
        private int need;
        private boolean inSysex;

        @Override
        public void onSend(byte[] msg, int offset, int count, long timestamp) {
            List<int[]> out = new ArrayList<>();
            for (int i = offset; i < offset + count; i++) {
                int b = msg[i] & 0xFF;
                if (b >= 0xF8) continue;                 // real-time: clock, active sensing
                if (b == 0xF0) { inSysex = true; continue; }
                if (b == 0xF7) { inSysex = false; continue; }
                if (inSysex) continue;
                if (b >= 0x80) {
                    if (b >= 0xF0) { running = 0; continue; }   // system common: not used
                    running = b;
                    have = 0;
                    int type = b & 0xF0;
                    need = (type == 0xC0 || type == 0xD0) ? 1 : 2;
                    continue;
                }
                if (running == 0) continue;              // data with no status: ignore
                data[have++] = b;
                if (have == need) {
                    out.add(need == 1 ? new int[] { running, data[0], 0 } : new int[] { running, data[0], data[1] });
                    have = 0;                            // running status: same status may follow
                }
            }
            if (!out.isEmpty()) listener.onMessages(out);
        }
    }
}
