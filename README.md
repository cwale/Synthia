# Synthia

Synth sound box for your Bluetooth midi device.

A synth and drum box for a Bluetooth MIDI keyboard, running in the browser on
your phone. Play the keyboard, hear it out of the phone speaker. Built for an
**M-VAVE SMK-37** (37 keys, 16 pads) but it works with any MIDI controller.

Two things it does well:

- **Play mode** — 18 sounds in six styles, three each: classical and easy
  listening, classic synth, funky, drum & bass, techno, and fun and strange.
  Seven pad kits to match: acoustic, orchestral, hand percussion, 808, techno,
  drum & bass and playroom. Arpeggiator, backing beats, macro knobs, and a
  recorder for keeping the good bits.
- **Bash mode** — one tap hands the whole screen to a toddler. Every note is
  bent onto a scale so nothing sounds wrong, the volume is capped, held notes
  release themselves, and getting out needs a three-second hold.

No dependencies and no build step. One sound is recorded, the grand piano;
everything else is generated live with the Web Audio API. The app itself is a
few hundred kilobytes and works offline once installed; the piano is 7 MB more,
fetched the first time it plays and kept from then on.

## How the sounds are made

| Style | Sounds |
|---|---|
| Classical & Easy | Grand Piano, Electric Piano, Concert Harp |
| Classic Synth | Supersaw Lead, Velvet Pad, Rubber Bass |
| Funky | Clavinet, Drawbar Organ, Funk Bass |
| Drum & Bass | Reese Bass, Wobble Bass, Dream Choir |
| Techno | Acid Bass, Dub Chord Stab, Hoover |
| Fun & Strange | Backwards Piano, Singing Bowl, Robot Burp |

Bash mode keeps its own gentle set (bells, marimba, music box, toy piano and
two of the above), which the picker doesn't show.

| How | Used for | Why |
|---|---|---|
| **Recorded** Steinway B, 21 notes at three dynamics | Grand and Backwards Piano | A piano is the one instrument a practical model can't make convincing |
| **Modal synthesis**: each instrument's measured resonant modes, each a sine with its own decay | Electric piano, singing bowl, Bash mode's mallets | Struck bars, tines and bowls really are a handful of decaying modes, so this is the instrument's physics rather than an imitation |
| **Karplus–Strong** strings with fractional-delay tuning and body resonances | Harp, clavinet, funk bass | A plucked or struck string is a delay line losing energy; tuned this way it stays within a cent |
| **Modelled membranes, bars and cymbals** | Acoustic, orchestral, hand percussion and drum & bass kits | Drumheads ring at known mode ratios; cymbals are filtered noise plus inharmonic partials |
| Subtractive and FM synthesis | The synth, DnB and techno patches, the 808 and techno kits | They were never meant to sound like anything real |

Every acoustic sound treats velocity as more than volume: a harder hit brings
up the upper modes, the beater click, the snare wires, the slap on the funk
bass, exactly as on the real instrument. Real-instrument behaviour is modelled
where it matters to playing: the top piano octaves have no dampers and ring on
as a real piano's do; a clavinet's notes stop the instant the key comes up;
closing the hi-hat chokes an open one.

`node tools/sound-check.mjs` renders every patch and pad and measures it —
tuning, clipping at full velocity, silence, balance between patches, whether a
harder hit is actually brighter, whether every note's ending fades rather than
clicks, and whether a dense passage at full volume ever passes full scale. CI runs it on every push. The
modelled instruments measure within 2 cents of true pitch; the piano reads up to 17 cents flat in the bass, which is the stretch tuning
a concert piano is given, not an error.

### The piano recordings

The Steinway B comes from the [Versilian Community Sample Library](https://github.com/sgossner/VCSL)
by Versilian Studios, released under CC0 — public domain, no conditions. Credit
is given here because it's deserved, not because it's required.

The set is every major third (C, E and G♯ in each octave, so no key is more
than two semitones from a recording) at the three dynamics it was recorded at,
trimmed and encoded to stereo VBR MP3 at a quality that's transparent on
in-ear monitors. `tools/make-piano-samples.sh` rebuilds it from the library;
it can also produce a mono set half the size, which is indistinguishable on a
phone or Bluetooth speaker.

The recordings sit in their own service-worker cache, separate from the app's,
so updating Synthia doesn't download the piano again.

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

Some controllers don't number their pads contiguously — the SMK-37 runs 36–47
and then drops to 16–19 for the last four. Any note arriving on a channel that
Learn has already established as a pad channel is folded into the pad range, so
those outliers land on pads 13–16 rather than playing the synth. If one still
lands in the wrong slot, **Mapping › Individual pads** lets you tap a slot and
hit that pad to fix it on its own.

### Pads that only send a release

Some pads report a hit as a release with no matching press — either *note on,
velocity 0* or a plain note-off. Both read as "let go" under the MIDI spec, so
the hit is discarded and the pad appears dead.

The app decides by what was actually held rather than by the status byte: a
release for a note nothing was holding didn't release anything, so on the pad
channel it's counted as a hit and fired at a set velocity (**Mapping › Pads that
send no velocity**). Pads that press and release properly never reach that
branch, so they can't start double-triggering.

This is a workaround for a keyboard setting, and the SMK-37 can be fixed at the
source: **hold Globe and turn K5** to set the pad velocity curve, where 4 means
every pad sends full velocity. The same menu holds the pad channel (K3), the key
channel (K2) and pad aftertouch (K6). **Mapping › Fixing this on the keyboard
itself** lists these in the app.

Because the pad notes, channel and velocity curve are all user-configurable —
and M-Vave's MIDI Suite can rewrite them entirely, across eight presets — there
is no factory pad map worth shipping. The app has to learn whatever your
keyboard has been set to, which is why Learn exists.

## Knobs and faders

Set up for the SMK-37 out of the box:

| Control | CC | Drives |
|---|---|---|
| Fader 1–4 | 64–67 | Tone, Bite, Space, Echo — the four on-screen knobs |
| K1–K8 | 48–55 | Attack, Release, Sweep, Wobble rate, Wobble, Grit, Width, Volume |

Anything can be reassigned under **Mapping › Knobs and faders**: tap *Learn* on a
row, move the control, done.

### Endless knobs vs faders

The SMK-37's four faders are slide potentiometers; its eight K knobs are
**endless 360° encoders**. Those report position in incompatible ways, and
nothing in the MIDI message says which you have:

- a fader sends its absolute position, 0–127
- an encoder has no position, so it sends *movement* — typically `1` for a click
  clockwise and `127` for one anticlockwise

Read an encoder as a fader and one click clockwise sets the target to 1/127 —
almost zero — while one click back sets it to full. The knob appears to have two
settings and no travel.

Synthia works out which it has from what each control sends, and shows the verdict
in **Mapping › Knobs and faders** and in the Monitor's controller summary.
Detection is deliberately lopsided: absolute is the default and the only state
reached without evidence, because misreading a fader as an encoder would make a
working control drift. A control is only taken for an encoder once it has
repeated at most two distinct in-band values — a moving fader produces a third
almost immediately.

While a control is still ambiguous its values are held rather than guessed at,
which is what stops a knob slamming to an extreme on first touch. The cost is
that a control sending a single in-band value per gesture — a button fixed at
127, say — waits forever; set it to *Fader* under **Mapping › How each control
reports**, where any control's mode can be forced either way.

One trap worth knowing about, since it bites on this hardware: the faders sit on
**CC64–67, which the MIDI spec reserves for the pedals** — CC64 *is* the sustain
pedal. A control mapped in this app deliberately overrides the spec meaning for
its CC number, so fader 1 sweeps the filter instead of jamming sustain on. If you
unmap it, CC64 goes back to behaving as a pedal.

Pitch bend and the mod wheel (CC1) work out of the box.

## A note on latency

The app shows its measured output latency in **Settings › Audio**. Expect
20–40 ms from the phone's own speaker or a wired output, which feels immediate.

## Playing through a Bluetooth speaker

This works, and needs no setup. The phone holds two Bluetooth links at once — a
BLE connection to the keyboard and a Classic A2DP link to the speaker. They are
different protocols sharing one radio, and phones do this routinely. Whatever the
operating system has set as the default output is where the sound goes.

Whether it is *playable* is a different question, and depends entirely on the
codec the two devices negotiate:

| Codec | Added latency |
|---|---|
| SBC (the universal fallback) | 150–250 ms |
| AAC | 150–200 ms |
| aptX | 70–130 ms |
| aptX Low Latency | 30–40 ms |
| LDAC | 200 ms+ |
| **LC3 / LE Audio** | **20–30 ms** |

**Bluetooth 5.2 does not by itself mean low latency.** 5.2 is the version that
introduced LE Audio and the LC3 codec, which is the row that would make this
genuinely good — but LE Audio is an *optional* part of the spec. Plenty of
speakers are certified 5.2 for the connection improvements while still carrying
audio over ordinary A2DP/SBC. Both ends have to implement it, the phone needs
Android 13 or later (sometimes with a switch in Developer Options), and Apple's
LE Audio support is aimed mostly at hearing devices and AirPods rather than
third-party speakers.

To find out what your own gear negotiates, connect the speaker and read the
figure in **Settings › Audio**. On Android that number generally includes the
Bluetooth output path: under about 30 ms means LE Audio is working, while
150 ms or more means you are on SBC.

In practice this splits cleanly by what you're doing. For **Bash mode, use the
Bluetooth speaker** — latency is irrelevant when the point is that hitting things
makes a fun noise, and louder is better. For **playing yourself, latency is the
whole game**, and 150 ms feels like the instrument is arguing with you; a USB-C
to 3.5 mm dongle into powered speakers, or a small USB-C audio interface, is the
reliable way to get loud and tight at once.

No software can fix this, here or anywhere else: a sound cannot be played before
the key is pressed, so compensation only helps when aligning a recording, never
for live monitoring. One consolation is that everything is delayed equally, so
the arpeggiator and the backing beat stay perfectly in sync with each other — it
is only the gap between your finger and the sound that suffers.

If you get audio stutter or dropped notes with both connected, that is the two
links contending for the same 2.4 GHz radio, and it is worst with greedy codecs.
Forcing SBC in Android's Developer Options usually settles it.

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
  acoustic.js         recorded, modal and string voices
  samples.js          loading and choosing piano recordings
  percussion.js       modelled acoustic drums and percussion
  acoustic-presets.js the acoustic instruments' numbers
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
samples/piano/        the recorded grand piano
tools/make-icons.mjs  generates the PWA icons (node tools/make-icons.mjs)
tools/sound-check.mjs measures every sound (tuning, clipping, balance)
tools/make-piano-samples.sh  rebuilds samples/piano from VCSL
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

Run the checks with `node tools/smoke-test.mjs` (set `CHROMIUM_PATH` if you want
it to use a Chromium already on the machine).

### Stamping a build

After changing anything under `js/`, `css/`, `index.html` or the manifest:

```sh
node tools/stamp.mjs
```

This writes a content hash into `js/version.js`, `version.json` and the service
worker's cache name, which is what the splash screen reports and what makes a
deploy invalidate the old cache. CI runs `node tools/stamp.mjs --check` and fails
if it's stale, so the app can't claim to be a build it isn't.

It runs at commit time rather than at deploy time on purpose: this repository has
both a custom Pages workflow and GitHub's built-in branch-based Pages build, they
both fire on a push to main, and whichever finishes last wins. Anything edited
during a deploy is discarded about half the time. Stamping the committed files
means both publishers serve the same bytes.

## Background

[docs/FEASIBILITY.md](docs/FEASIBILITY.md) covers the platform research behind
these choices: the browser support matrix, the BLE-MIDI packet format, real
latency numbers, and why this is a web app rather than a native one.
