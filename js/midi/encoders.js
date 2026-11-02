/* Telling an endless encoder apart from a fader, and reading what it sends.

   The SMK-37's eight K knobs are endless 360-degree encoders; its four faders
   are slide potentiometers. Those report position in fundamentally different
   ways, and reading one as the other is not a small error:

   - A fader sends its absolute position, 0..127. Reading it absolutely is right.
   - An encoder has no position to send, so it reports movement instead, as a
     small signed delta. Read absolutely, one click clockwise (value 1) slams
     the target to almost zero and one click anticlockwise (value 127) slams it
     to full. The knob then appears to have two settings and no travel.

   There is no bit in the message saying which it is, so this classifies by what
   a control actually sends. The rule is deliberately lopsided: absolute is the
   default and the only state reached without evidence, because misreading a
   fader as an encoder would make it drift, which is worse than the honest
   failure of not detecting an encoder at all. A fader nudged near the end of
   its travel sends in-band values too, so the test is that the control repeats
   at most two distinct values — a fader moving produces a third almost at once,
   while an encoder has only "a click up" and "a click down" to send. */

/** Two's-complement: 1..63 is clockwise, 65..127 is anticlockwise. */
const TWOS = 'twos';
/** Binary offset: 64 is still, above is clockwise, below is anticlockwise. */
const OFFSET = 'offset';

export const CC_MODES = [
  { key: 'auto', name: 'Auto', blurb: 'Work it out from what the control sends.' },
  { key: 'absolute', name: 'Fader', blurb: 'Sends its position, 0 to 127.' },
  { key: TWOS, name: 'Encoder', blurb: 'Endless knob reporting movement (1 up, 127 down).' },
  { key: OFFSET, name: 'Encoder (centred)', blurb: 'Endless knob reporting movement either side of 64.' },
];

/** How many messages before a classification is allowed to leave "absolute". */
const MIN_EVIDENCE = 4;

/**
 * Decode one message into a change in position, in encoder clicks.
 * @returns {number} signed clicks; positive is clockwise
 */
export function relativeDelta(value, encoding = TWOS) {
  if (encoding === OFFSET) return value - 64;
  return value < 64 ? value : value - 128;
}

/**
 * Watches the values one CC has sent and decides how to read it.
 *
 * Both encoder encodings have a signature a fader cannot imitate: the values
 * stay in a couple of narrow bands around the encoding's zero point, and the
 * same handful repeat however far the knob is turned, because each message is
 * one step rather than a place on a track. A fader leaves those bands within a
 * few millimetres of travel, and once it has, this never reconsiders.
 */
export class CcProfiler {
  constructor() {
    /** cc -> { count, values:Set, ruled:boolean, mode:string } */
    this.byCc = new Map();
  }

  _entry(cc) {
    let e = this.byCc.get(cc);
    if (!e) {
      e = { count: 0, values: new Set(), ruled: false, mode: 'absolute' };
      this.byCc.set(cc, e);
    }
    return e;
  }

  /** Record a value and return the mode to read this CC as. */
  observe(cc, value) {
    const e = this._entry(cc);
    e.count++;
    if (e.values.size < 12) e.values.add(value);
    if (e.ruled) return e.mode;

    // A value in neither band can only have come from something with a
    // position, which settles it for good.
    if (!inTwosBand(value) && !inOffsetBand(value)) {
      e.ruled = true;
      e.mode = 'absolute';
      return e.mode;
    }

    if (e.count >= MIN_EVIDENCE && e.values.size <= 2) {
      const all = [...e.values];
      if (all.every(inTwosBand)) e.mode = TWOS;
      else if (all.every(inOffsetBand)) e.mode = OFFSET;
    }
    return e.mode;
  }

  /** How many messages this CC has sent, for deciding how much to trust it. */
  seenCount(cc) {
    return this.byCc.get(cc)?.count || 0;
  }

  /** What this CC is currently being read as, without recording anything. */
  modeFor(cc) {
    return this.byCc.get(cc)?.mode || 'absolute';
  }

  /** True once enough has been seen to trust modeFor. */
  settled(cc) {
    const e = this.byCc.get(cc);
    return !!e && (e.ruled || e.count >= MIN_EVIDENCE);
  }

  forget() {
    this.byCc.clear();
  }
}

/* 0 is excluded from both bands: an encoder never sends "no movement", while a
   fader at rest at the bottom of its travel sends exactly that. */
function inTwosBand(v) {
  return (v >= 1 && v <= 8) || (v >= 120 && v <= 127);
}

function inOffsetBand(v) {
  return v >= 56 && v <= 72 && v !== 64;
}
