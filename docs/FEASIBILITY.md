# Feasibility: a phone-based synth for a Bluetooth MIDI keyboard

Scoping notes for Snythia, written before the build and updated after it.
Target hardware: **M-VAVE SMK-37** (sold as "M-Wave Elite / Elite Pro") — 37
velocity-sensitive keys, 16 velocity + aftertouch pads, 8 encoders, 4 faders,
pitch and mod wheels, BLE MIDI 5.0, USB-C, TRS MIDI out.

## Verdict

**Feasible, and built.** One web codebase covers Android, desktop and iPad/iPhone
— with one platform caveat that is not a bug and cannot be coded around.

| Platform | Keyboard over Bluetooth | Sound from the phone | Verdict |
|---|---|---|---|
| Android, Chrome / Samsung Internet | Yes — two independent routes | Yes | Works fully as a PWA |
| Desktop Chrome / Edge / Opera | Yes | Yes | Works fully |
| iPhone / iPad, **Safari** | **No** | Yes | On-screen play only |
| iPhone / iPad, Web MIDI Browser (free app) | Yes | Yes | Works fully |
| iPhone / iPad, Bluefy (free app) | Yes, via direct BLE | Yes | Works fully |
| iPhone / iPad, native wrapper | Yes | Yes | Works fully, needs a build |
| Desktop Safari / Firefox | No | Yes | On-screen play only |

## The one hard constraint

Safari implements neither the **Web MIDI API** nor **Web Bluetooth**, and Apple
requires every iOS browser to use WebKit — so Chrome and Firefox on iOS inherit
the same gap. WebKit has declined Web MIDI for years on fingerprinting grounds
and there is no announced roadmap. No amount of clever code gets a website in
Safari talking to a MIDI device.

Everything else on iOS is fine: Web Audio is solid in WKWebView, so the synth,
the pads, recording and Bash mode all work in Safari — you just can't use the
physical keyboard there.

Three ways around it, in order of effort:

1. **Web MIDI Browser** (free, Takashi Mizuhiki) — a WebKit browser that ships a
   Web MIDI shim plus the iOS Bluetooth-MIDI pairing sheet. Open the app's URL
   inside it and the keyboard just works. Zero build effort.
2. **Bluefy** (free) — adds Web Bluetooth to iOS. Snythia's BLE-MIDI transport
   talks the GATT MIDI service directly, so this route needs nothing from Apple's
   MIDI stack at all.
3. **Native wrapper** — a Capacitor shell with ~150 lines of Swift over CoreMIDI.
   Reuses this codebase unchanged; see [IOS.md](IOS.md).

## Two independent MIDI routes, which is why the app is reliable

The app has a pluggable transport layer (`js/midi/`), and the choice matters more
than it first appears.

**Web MIDI API** (`webmidi.js`) goes through the OS MIDI stack. On Android this is
the fragile path: a BLE MIDI device has to be bound into Android's MIDI service
before Chrome will enumerate it, and depending on the Android version that needs
either a system pairing that happens to work or a third-party Bluetooth-MIDI
helper app. When it works it's the least effort; when it doesn't, it's opaque.

**Web Bluetooth** (`blemidi.js`) skips all of that. BLE MIDI is a standardised
GATT service — service `03B80E5A-…C700`, characteristic `7772E5DB-…6BF3` — so the
app connects to the keyboard itself and decodes the packet format directly. This
is the recommended route on Android, and the only route inside Bluefy on iOS.

The packet format is the fiddly part and is implemented and unit-tested:
each notification is a header byte, then `[timestamp][MIDI message]` groups, with
running status allowed and timestamps optionally omitted for messages sharing the
previous one. `decodeBleMidiPacket()` handles single messages, running status,
several messages per packet, and skips sysex.

A third transport (`native.js`) exposes a tiny `window.SnythiaNative` contract for
the wrapper builds. The app above the transport layer does not know or care which
one is in use.

## Latency — the honest numbers

Latency is the thing most likely to disappoint, and it has two separate parts.

**Browser output latency** is what `AudioContext.baseLatency + outputLatency`
report, and the app shows it in Settings › Audio. Expect roughly 20–40 ms on
Android Chrome with `latencyHint: 'interactive'`, and similar in iOS WKWebView.
Under about 30 ms feels immediate; up to ~50 ms is fine for pads and chords and
slightly soft for fast runs.

**Bluetooth audio output** adds 100–200 ms on top, and that is the killer. It has
nothing to do with this app or with the web platform — it's the A2DP codec
pipeline. A Bluetooth speaker makes playing in time genuinely hard. The phone's
own speaker or wired headphones are the answer, and the app warns once on first
run if the measured figure is high.

BLE MIDI *input* latency is small by comparison, typically under 10 ms.

Native code could improve the first number (Oboe/AAudio on Android, AVAudioEngine
on iOS, realistically 10–20 ms) but can do nothing about the second.

## Should this be native instead, to be platform-agnostic?

Worth addressing head-on, because the intuition runs the other way: **the web app
is the more platform-agnostic choice here**, and the native option is narrower
than it looks.

A PWA is one codebase that runs on Android, iPhone, iPad, and every desktop, is
distributed by sending a link, installs to the home screen, updates itself, works
offline, and needs no store review, signing certificate, or annual fee. The only
thing it gives up is MIDI hardware access inside Safari specifically.

Going native to fix that one gap costs a lot:

| Approach | Codebase | iOS MIDI | Latency | Cost |
|---|---|---|---|---|
| PWA (this) | 1, web | Safari: no. Helper app: yes | 20–40 ms | Push to a URL |
| Capacitor shell | 1, web + ~150 lines Swift/Kotlin | Yes | Same as PWA | Mac + Xcode, $99/yr Apple, store review |
| Flutter / React Native | 1, rewrite | Yes | Better, if you add a native audio engine | Full rewrite; no synth DSP included |
| JUCE (C++) | 1, rewrite | Yes | 10–20 ms, best possible | Full C++ rewrite; the "real synth app" route |
| Two native apps | 2, rewrite each | Yes | Best | Double everything |

The recommendation, and what this repo does: **keep the web app as the product,
and treat native as a thin optional shell for iOS only.** The transport
abstraction means the Capacitor wrapper is additive — a small Swift file and a
config, with zero changes to the app itself. Nothing is lost by starting on the
web, and if the iPhone case becomes important the wrapper is a weekend, not a
rewrite.

JUCE would be the right answer for a product where latency is the feature — a
performance instrument you gig with. For "play now and then, and hand it to a
toddler," the ability to open a link on any phone in the house beats 15 ms.

## Mapping the hardware without documentation

The SMK-37's factory MIDI assignments aren't published in usable detail, and
firmware revisions differ. Guessing would be fragile, so the app measures instead:

- **Learn Pads** records exactly what each of the 16 pads sends, in order. This is
  the reliable path and works on any controller.
- **MIDI Monitor** shows every incoming message with channel and note, so the
  hardware can be inspected directly.
- Manual fallbacks: split by channel (default channel 10, pad 1 = note 36, the
  common convention) or by note range.
- Pitch bend, mod wheel (CC1) and sustain (CC64) are wired by default; the
  encoders and faders can be learned onto the four macro knobs.

There is a real ambiguity worth knowing about: a 37-key controller starting at C2
sends notes 36–72, which **overlaps** the usual pad range of 36–51. So keys and
pads must be distinguished by channel, not note — which is why channel split is
the default and Learn exists.

## What was built

- Polyphonic subtractive/FM synth, 12 patches, per-voice filter and amp
  envelopes, LFO, unison, glide, mono mode, velocity mapping.
- 20+ synthesised percussion and one-shot voices, 4 pad kits. No samples — the
  whole app is a few hundred KB and works offline immediately.
- Shared effect rack: convolution reverb from a generated impulse, tempo-synced
  ping-pong delay, chorus, soft-clip drive, tilt EQ, and a limiter that keeps a
  toddler's twenty-note chord from clipping the speaker.
- One look-ahead clock driving both the arpeggiator and the backing-beat
  sequencer, so they can't drift apart.
- Audio recording of the master mix, with share/download.
- Bash mode: full-screen tiles, scale quantising, volume ceiling, softened
  treble, self-releasing notes, and a three-second hold to escape.
- PWA: installable, offline, generated icons.

## Known limits

- Bluetooth audio output latency, as above. Not fixable at this layer.
- Web Bluetooth needs a user gesture for the device chooser every first
  connection; `getDevices()` allows silent reconnection afterwards where
  supported.
- Recordings live in memory for the session only, and must be downloaded to keep.
- No MIDI *output*, so the keyboard's own pad LEDs aren't driven. Adding it is
  straightforward — the BLE characteristic supports writes.
- The aftertouch the pads send is received but not yet mapped to anything.
