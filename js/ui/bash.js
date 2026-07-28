/* Bash mode — the screen you hand to a toddler.

   Design rules, all of them learned the hard way by anyone who has given a
   two-year-old a music app:
     - Nothing can sound wrong: every note is bent onto a pentatonic scale.
     - Nothing can get loud: a hard volume ceiling, plus softened treble.
     - Nothing can drone: held notes release themselves after a few seconds.
     - Nothing can be broken: no menus, no settings, no browser chrome.
     - An adult can still get out: a three-second hold in one corner. */

import { h, multitouch, holdToConfirm } from './dom.js';
import { clamp, quantiseToScale, SCALES, haptic } from '../util.js';
import { settings } from '../state.js';
import { getPreset, BASH_SOUNDS } from '../audio/presets.js';
import { getKit } from '../audio/kits.js';

const HOLD_MS = 3000;
const RING_CIRCUMFERENCE = 119.4;   // 2πr with r = 19, matching the SVG

export class BashMode {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('bash');
    this.tilesEl = document.getElementById('bash-tiles');
    this.ring = document.getElementById('bash-ring');
    this.exitEl = document.getElementById('bash-exit');
    this.toastEl = document.getElementById('bash-toast');
    this.active = false;
    this.tiles = [];
    this._tileNotes = [];
    this._releaseTimers = new Map();
    this._noteToTile = new Map();

    multitouch(this.tilesEl, {
      resolve: (el) => {
        const tile = el.closest('.tile');
        return tile ? Number(tile.dataset.tile) : null;
      },
      onPress: (index, velocity) => this.tileDown(index, velocity),
      onRelease: (index) => this.tileUp(index),
    });

    holdToConfirm(this.exitEl, {
      durationMs: HOLD_MS,
      onProgress: (p) => {
        this.ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - p));
      },
      onComplete: () => this.app.exitBash(),
    });

    this._orientationHandler = () => { if (this.active) this.buildTiles(); };
    window.addEventListener('resize', this._orientationHandler);
  }

  /* ---- lifecycle -------------------------------------------------------- */

  enter() {
    this.active = true;
    this.root.hidden = false;
    document.body.dataset.mode = 'bash';
    this.buildTiles();
    this.applySound();
    this.applyGroove();
    this.app.engine.setCeiling(settings.bash.maxVolume);
    this.showToast('Hold the ring in the corner for three seconds to get out');
  }

  exit() {
    this.active = false;
    this.root.hidden = true;
    document.body.dataset.mode = 'play';
    for (const t of this._releaseTimers.values()) clearTimeout(t);
    this._releaseTimers.clear();
    this.ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
  }

  showToast(text, ms = 4200) {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this.toastEl.hidden = true; }, ms);
  }

  /* ---- sound ------------------------------------------------------------ */

  applySound() {
    const choice = BASH_SOUNDS.find((s) => s.id === settings.bash.soundSet) || BASH_SOUNDS[0];
    const preset = getPreset(choice.presetId);
    this.app.synth.setPatch(preset);
    this.app.synthStrip.setReverb(Math.max(0.35, preset.send.reverb));
    this.app.synthStrip.setDelay(preset.send.delay * 0.6);
    this.app.synth.setMacro('cutoff', settings.bash.softenHighs ? 0.6 : preset.macroCutoff);
    this.app.synth.setMacro('resonance', 0.06);   // nothing squelchy or shrill
    // Roll the top end off at the master stage as well.
    if (this.app.engine.highShelf) {
      this.app.engine.highShelf.gain.value = settings.bash.softenHighs ? -5 : 1.5;
    }
    this.kit = getKit(settings.bash.padsAreDrums ? 'playroom' : 'melodic');
  }

  applyGroove() {
    if (settings.bash.groove) {
      this.app.clock.setTempo(settings.bash.tempo);
      this.app.groove.setPattern('clappy');
      this.app.groove.setLevel(0.5);
      this.app.groove.start();
      this.app.clock.start();
    } else {
      this.app.groove.stop();
      if (!settings.arp.on) this.app.clock.stop();
    }
  }

  /** Restore what Bash mode changed, so Play mode is untouched. */
  restore() {
    if (this.app.engine.highShelf) this.app.engine.highShelf.gain.value = 1.5;
    this.app.groove.stop();
  }

  /* ---- tiles ------------------------------------------------------------ */

  buildTiles() {
    const landscape = window.matchMedia('(orientation: landscape)').matches;
    const columns = landscape ? 7 : 5;
    const cells = landscape ? 21 : 20;
    // The exit control takes the top-right cell rather than floating over a
    // tile — a toddler resting a finger in the corner should not be able to
    // hold down both a note and the way out.
    const count = cells - 1;
    const scale = SCALES[settings.bash.scaleName] || SCALES.majorPentatonic;
    const steps = scale.steps;

    this.tilesEl.textContent = '';
    this.tiles = [];
    this._tileNotes = [];
    this._noteToTile.clear();

    const startNote = 48 + settings.bash.root;
    for (let i = 0; i < count; i++) {
      const octave = Math.floor(i / steps.length);
      const note = startNote + steps[i % steps.length] + octave * 12;
      this._tileNotes.push(note);
      this._noteToTile.set(note, i);

      // Rainbow across the grid so it reads as a scale, not a random spread.
      const hue = (i / count) * 320;
      const el = h('div.tile', {
        dataset: { tile: String(i) },
        style: { '--tc': `hsl(${hue} 72% 58%)` },
        'aria-label': `Note ${i + 1}`,
      }, h('span.tile__burst'));
      this.tiles.push(el);
      this.tilesEl.append(el);
    }

    // Slot the exit control into the first row's last cell.
    this.tilesEl.insertBefore(this.exitEl, this.tiles[columns - 1] || null);
  }

  flashTile(index, velocity = 0.9) {
    const el = this.tiles[index];
    if (!el) return;
    el.classList.remove('is-hit');
    void el.offsetWidth;
    el.classList.add('is-hit');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('is-hit'), 220 + velocity * 200);
  }

  tileDown(index, velocity) {
    const note = this._tileNotes[index];
    if (note == null) return;
    this.flashTile(index, velocity);
    if (settings.ui.haptics) haptic(10);
    this.app.playBashNote(note, velocity, `tile:${index}`);
    this._scheduleRelease(`tile:${index}`);
  }

  tileUp(index) {
    this.app.stopBashNote(`tile:${index}`);
    this._clearRelease(`tile:${index}`);
  }

  /* ---- hardware input --------------------------------------------------- */

  /** A note from the physical keyboard: quantise it and light the matching tile. */
  hardwareNoteOn(rawNote, velocity) {
    const note = quantiseToScale(
      rawNote,
      settings.bash.root,
      settings.bash.scaleName,
      'snap',
    );
    const tile = this._noteToTile.get(note);
    if (tile != null) this.flashTile(tile, velocity);
    this.app.playBashNote(note, velocity, `hw:${rawNote}`);
    this._scheduleRelease(`hw:${rawNote}`);
    return note;
  }

  hardwareNoteOff(rawNote) {
    this.app.stopBashNote(`hw:${rawNote}`);
    this._clearRelease(`hw:${rawNote}`);
  }

  /** Pads in Bash mode always play the fun kit, whatever is loaded in Play mode. */
  padDef(index) {
    return this.kit?.pads[clamp(index, 0, 15)] || null;
  }

  /* ---- auto-release ----------------------------------------------------- */

  _scheduleRelease(key) {
    this._clearRelease(key);
    const ms = settings.bash.autoReleaseSec * 1000;
    this._releaseTimers.set(key, setTimeout(() => {
      this.app.stopBashNote(key);
      this._releaseTimers.delete(key);
    }, ms));
  }

  _clearRelease(key) {
    const t = this._releaseTimers.get(key);
    if (t) {
      clearTimeout(t);
      this._releaseTimers.delete(key);
    }
  }
}
