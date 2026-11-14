# Synthia for Android

The website stops making sound when the screen turns off or you switch apps.
That's partly deliberate, and partly Android: a web page in the background can
be paused or closed whenever the phone likes. The Android app exists to keep
playing.

## Installing

1. On the phone, open
   **https://github.com/cwale/Synthia/releases/latest/download/synthia.apk**.
   That link always fetches the newest build.
2. Open the downloaded file. Android will ask you to allow your browser to
   install apps — allow it, once.
3. Open **Synthia**. Allow **Nearby devices** (that's Bluetooth) and
   **Notifications** when asked.
4. Tap **Tap to start**, then **Keyboard › Connect › Search**, and pick your
   keyboard. From then on it reconnects by itself when the app opens.

To update, do the same again: the new APK installs over the old one and keeps
your settings.

The app keeps its own settings, separate from the browser's, so the first time
you'll need to redo **Mapping › Learn my pads**.

## What keeps it running

- **A foreground service.** The "Synthia is running" notification is the visible
  half of it: Android leaves alone an app that shows one, the same way it leaves
  a music player alone. Tap **Stop** on the notification to quit properly;
  swiping Synthia away in recent apps does the same.
- **A native keyboard connection.** Android's built-in WebView has neither Web
  MIDI nor Web Bluetooth, so the app opens the keyboard through Android's own
  MIDI service and passes every message into the page. The page is the same
  Synthia either way: it notices `window.SynthiaNative` and uses it
  (`js/midi/native.js`).
- **No pausing.** In a browser, Synthia stops everything when hidden. In the
  app it doesn't, and the app never pauses its WebView.
- **A CPU wake lock** while the service runs, so audio keeps rendering with the
  screen off. It renews itself hourly and expires on its own if anything goes
  wrong.

Back sends the app to the background instead of closing it.

## If it still stops

Some phones — Samsung, Xiaomi, OnePlus and Huawei especially — have battery
savers that stop apps even when they show a notification. If Synthia goes quiet
after a while with the screen off:

**Settings › Apps › Synthia › Battery › Unrestricted** (the wording varies;
look for "Don't optimise" or "No restrictions").

[dontkillmyapp.com](https://dontkillmyapp.com) lists the exact steps per phone.

## Updates

The app loads the live site, so changes to sounds, mapping and the interface
arrive the next time it opens, with no reinstall. A copy of the site is built
into the APK for the first launch without signal; after that the site's own
offline cache takes over.

A new APK is only needed when the Android part changes. GitHub Actions builds
one whenever `android/` changes on `main` and publishes it as the latest
release.

## Signing

Each APK is signed with `android/app/sideload.jks`, which is committed with its
password in `android/app/build.gradle`. That's what lets each build install as
an update instead of asking you to uninstall first. The key only tells your
phone that two APKs come from the same place; it guards nothing secret, and
since it is public anyone could sign an APK with it. Only install Synthia from
the link above. Publishing to the Play Store would need a private key instead.

## Building it yourself

Needs JDK 17+, Gradle 8.9+ and the Android SDK (platform 35):

```sh
cd android
echo "sdk.dir=$ANDROID_HOME" > local.properties
gradle assembleRelease lintRelease
# app/build/outputs/apk/release/app-release.apk
```

The build copies the web app from the repository root into the APK, so there
is nothing else to prepare.

## Layout

```
android/app/src/main/java/io/github/cwale/synthia/
  MainActivity.java    WebView, the JavaScript bridge, lifecycle
  MidiBridge.java      Bluetooth search, Android MIDI, message parsing, reconnecting
  SynthiaService.java  the foreground service and notification
  Permissions.java     which permissions this Android version wants
```
