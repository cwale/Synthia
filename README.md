# Snythia

Synth sound box for your Bluetooth midi device.

A synth and drum box for a Bluetooth MIDI keyboard, running in the browser on
your phone. Play the keyboard, hear it out of the phone speaker. Built for an
**M-VAVE SMK-37** (37 keys, 16 pads) but it works with any MIDI controller.

Two things it does well:

- **Play mode** — twelve synth patches, four pad kits, arpeggiator, backing
  beats, macro knobs, and a recorder for keeping the good bits.
- **Bash mode** — one tap hands the whole screen to a toddler. Every note is
  bent onto a scale so nothing sounds wrong, the volume is capped, held notes
  release themselves, and getting out needs a three-second hold.

No samples, no dependencies, no build step. Every sound is generated live with
the Web Audio API, so the whole thing is a few hundred kilobytes and works
offline once installed.

## Getting it on your phone

Host the folder anywhere over HTTPS and open it. With GitHub Pages: enable Pages
for this repo (Settings › Pages › Source: GitHub Actions) and the included
workflow publishes it on every push to the default branch.

Then, on the phone, install it:

- **Android / Chrome** — ⋮ menu › *Install app*
- **iPhone / Safari** — Share › *Add to Home Screen*

It then runs full screen with no browser bars.

## Connecting the keyboard

Tap the chip at the top left, then pick a route. What's available depends on the
browser, and this is the one place the platforms genuinely differ.

### Android

Two independent routes, and the first is the more reliable one:

1. **Connect over Bluetooth** — put the keyboard in pairing mode, tap *Scan*,
   pick it. This talks BLE-MIDI to the keyboard directly and bypasses Android's
   MIDI service entirely.
2. **Use Web MIDI** — for a keyboard already paired in Android's Bluetooth
   settings, or plugged in over USB. Some Android versions need a Bluetooth-MIDI
   helper app before the keyboard appears as a MIDI port, which is why route 1
   exists.

### iPhone and iPad

**Safari cannot see MIDI hardware.** It implements neither Web MIDI nor Web
Bluetooth, and Apple requires every iOS browser to use Safari's engine, so this
is not something the app can work around. Everything else works in Safari — the
on-screen keys, pads, sounds, recording and Bash mode.

To use the physical keyboard, pick one:

- **Web MIDI Browser** (free) — open this page inside it and pair over
  Bluetooth. It supplies the Web MIDI support Safari lacks.
- **Bluefy** (free) — open this page inside it and use *Connect over Bluetooth*.
  It supplies Web Bluetooth, which the app uses to talk BLE-MIDI directly.
- **Build the native wrapper** — see [docs/IOS.md](docs/IOS.md). Reuses this
  codebase unchanged plus about 150 lines of Swift.

### Desktop

Chrome, Edge and Opera support Web MIDI. Pair or plug in the keyboard, then hit
*Enable*. Safari and Firefox don't support it.

## Mapping the pads

Controllers disagree about what their pads send, and the SMK-37's factory
assignment isn't reliably documented, so the app measures rather than guesses.

Open **Keyboard › Mapping › Learn my pads** and hit each pad once, in order.
That's it. If you'd rather set it by hand, the same screen offers a channel split
(default: channel 10, pad 1 = note 36) or a note-range split, and the **Monitor**
tab shows every incoming message so you can see exactly what your hardware sends.

Worth knowing: a 37-key controller starting at C2 sends notes 36–72, which
overlaps the usual pad range of 36–51. Keys and pads therefore have to be told
apart by MIDI channel, not by note — hence the channel-split default.

Pitch bend, mod wheel (CC1) and sustain (CC64) work out of the box. The eight
encoders and four faders can be learned onto the four macro knobs.

## A note on latency

The app shows its measured output latency in **Settings › Audio**. Expect
20–40 ms, which feels immediate.

A **Bluetooth speaker or Bluetooth headphones will add 100–200 ms** on top, and
that is enough to make playing in time genuinely difficult. This is a property of
Bluetooth audio, not of this app. Use the phone's speaker or wired headphones.

## Playing without hardware

Everything works from the screen alone. On a computer, the letter keys play notes
(`a`–`k` for the white keys, `w e t y u` for the black ones), `z`–`,` fire the
pads, and space toggles the beat.

## Layout

```
index.html            markup and the app shell
css/app.css           the whole visual system
js/main.js            application controller: boot, routing, wiring
js/state.js           persisted settings and the event bus
js/util.js            maths, music theory, platform detection
js/audio/
  engine.js           AudioContext, master bus, channel strips, latency
  voice.js            one synth voice (subtractive + FM)
  polysynth.js        voice allocation, sustain, bend, arpeggiator
  drums.js            synthesised percussion and one-shots
  fx.js               reverb, ping-pong delay, chorus, drive
  clock.js            shared look-ahead scheduler
  groove.js           backing drum patterns
  presets.js kits.js  the sounds themselves
  recorder.js         capture the master mix
js/midi/
  hub.js              routing, key/pad classification, Learn, monitor
  webmidi.js          Web MIDI transport
  blemidi.js          Web Bluetooth BLE-MIDI transport and packet codec
  native.js           bridge for a native shell
js/ui/                keyboard, pads, knobs, sheets, visualiser, Bash mode
tools/make-icons.mjs  generates the PWA icons (node tools/make-icons.mjs)
docs/FEASIBILITY.md   platform research and the native-vs-web trade-off
docs/IOS.md           building the iOS wrapper
```

## Running locally

```sh
npx http-server -p 8123        # or any static server
```

Then open `http://localhost:8123`. Web Bluetooth and Web MIDI need a secure
context, so `localhost` is fine but a plain LAN IP is not — use HTTPS for
on-device testing.

## Background

[docs/FEASIBILITY.md](docs/FEASIBILITY.md) covers the platform research behind
these choices: the browser support matrix, the BLE-MIDI packet format, real
latency numbers, and why this is a web app rather than a native one.
