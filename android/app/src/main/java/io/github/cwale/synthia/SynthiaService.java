package io.github.cwale.synthia;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * What keeps Synthia alive with the screen off.
 *
 * Android stops a backgrounded app whenever it likes, and a web page stops
 * sooner still. A foreground service — the kind a music player runs, with a
 * notification you can always see — tells the system this app is doing
 * something the person is listening to, so it is left running. The service
 * itself does no work: the audio and the keyboard connection live in
 * MainActivity's WebView and MidiBridge; this holds the process up around
 * them, plus a CPU wake lock so audio keeps rendering with the screen off.
 */
public class SynthiaService extends Service {
    static final String ACTION_UPDATE = "io.github.cwale.synthia.UPDATE";
    static final String EXTRA_TEXT = "text";
    private static final String CHANNEL = "running";
    private static final int ID = 1;
    /** The wake lock times out on its own, so a bug here can't drain the
     *  battery for days; while the service runs it is renewed well before. */
    private static final long WAKE_MS = 2 * 60 * 60 * 1000L;
    private static final long RENEW_MS = 60 * 60 * 1000L;

    /** The running instance, if any; touched only on the main thread. */
    private static SynthiaService current;

    private PowerManager.WakeLock wakeLock;
    private String text;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable renew = new Runnable() {
        @Override
        public void run() {
            if (wakeLock != null) wakeLock.acquire(WAKE_MS);
            handler.postDelayed(this, RENEW_MS);
        }
    };

    /** Start (or restart) the service. Only allowed while the app is in front. */
    static void start(Context c, String text) {
        Intent i = new Intent(c, SynthiaService.class).setAction(ACTION_UPDATE).putExtra(EXTRA_TEXT, text);
        c.startForegroundService(i);
    }

    /**
     * Change what the notification says. Safe from the background: a running
     * service redraws its own notification, because since Android 12 starting
     * a foreground service from the background throws — and the keyboard
     * reconnecting with the screen off is exactly that moment.
     */
    static void update(Context c, String text) {
        if (current != null) {
            current.text = text;
            current.getSystemService(NotificationManager.class).notify(ID, current.buildNotification());
        } else {
            try {
                start(c, text);
            } catch (IllegalStateException e) {
                // In the background with no service running: nothing to update.
            }
        }
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, SynthiaService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel ch = new NotificationChannel(CHANNEL, getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW);
        ch.setDescription(getString(R.string.channel_description));
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);

        PowerManager pm = getSystemService(PowerManager.class);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Synthia:audio");
        wakeLock.setReferenceCounted(false);
        renew.run();
        current = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getStringExtra(EXTRA_TEXT) != null) text = intent.getStringExtra(EXTRA_TEXT);
        if (text == null) text = getString(R.string.notification_waiting);

        int types = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
        // "Connected device" may only be claimed once Bluetooth is permitted.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && Permissions.hasBluetooth(this)) {
            types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE;
        }
        ServiceCompat.startForeground(this, ID, buildNotification(), types);
        // If the system kills us anyway, don't come back without the activity.
        return START_NOT_STICKY;
    }

    private Notification buildNotification() {
        int immutable = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Intent quit = new Intent(this, MainActivity.class).setAction(MainActivity.ACTION_QUIT)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_synthia)
                .setContentTitle(getString(R.string.notification_title))
                .setContentText(text)
                .setOngoing(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(PendingIntent.getActivity(this, 0, open, immutable))
                .addAction(0, getString(R.string.action_stop), PendingIntent.getActivity(this, 1, quit, immutable))
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .build();
    }

    /** Swiping Synthia away in recents means "I'm done": stop holding on. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (current == this) current = null;
        handler.removeCallbacks(renew);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
