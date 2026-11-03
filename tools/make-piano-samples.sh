#!/bin/bash
# Rebuild samples/piano from the Versilian Community Sample Library (CC0).
#
# Takes the Steinway B, non-sustained, close-miked set: C, E and G# in every
# octave (so no key is more than two semitones from a recording), at the three
# recorded dynamics. Each note has its leading silence removed, is capped in
# length by pitch, and is encoded to stereo VBR MP3. Quality 2 is effectively
# transparent, which matters on in-ear monitors; mono at a fixed 96k halves the
# size and is indistinguishable on a phone or Bluetooth speaker.
#
#   git clone --depth 1 --filter=blob:none --no-checkout \
#     https://github.com/sgossner/VCSL.git /tmp/vcsl
#   tools/make-piano-samples.sh /tmp/vcsl samples/piano            # stereo, VBR q2
#   tools/make-piano-samples.sh /tmp/vcsl samples/piano mono 96k   # small
#
# Files are fetched one at a time and deleted after conversion, so the full
# library (several GB) never needs to be on disk. Existing outputs are kept;
# delete samples/piano first to re-encode differently.
set -euo pipefail
SRC="$1"; OUT="$2"; LAYOUT="${3:-stereo}"; BR="${4:-}"
if [ "$LAYOUT" = mono ]; then CH=(-ac 1); else CH=(-ac 2); fi
if [ -n "$BR" ]; then ENC=(-b:a "$BR"); else ENC=(-q:a 2); fi
mkdir -p "$OUT"
idx() { case $1 in C) echo 0;; E) echo 4;; 'G#') echo 8;; esac; }
for oct in 1 2 3 4 5 6 7; do
  for name in C E 'G#'; do
    midi=$(( (oct + 1) * 12 + $(idx "$name") ))
    # Low strings ring for ages; past a few seconds nobody hears the tail of a
    # bass note under what came next, so cap length by pitch.
    cap=$(python3 -c "print(round(max(3.0, min(9.0, 9 - ($midi-24)*0.075)),2))")
    fade=1.2
    for vl in 2 3 4; do
      rel="Chordophones/Zithers/Grand Piano, Steinway B/NoSus/JHPiano_NoSus_Close_${name}${oct}_vl${vl}_rr1.wav"
      safe=$(echo "${name}" | sed 's/#/s/')
      dst="$OUT/${safe}${oct}-v${vl}.mp3"
      [ -f "$dst" ] && continue
      git -C "$SRC" checkout -q HEAD -- "$rel" 2>/dev/null || { echo "missing $rel"; continue; }
      ffmpeg -hide_banner -loglevel error -y -i "$SRC/$rel" \
        -af "silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.004,atrim=0:${cap},afade=t=out:st=$(python3 -c "print($cap-$fade)"):d=${fade}" \
        "${CH[@]}" -ar 44100 -c:a libmp3lame "${ENC[@]}" "$dst"
      rm -f "$SRC/$rel"
      echo "$midi ${name}${oct} v${vl} cap=${cap}s $(stat -c %s "$dst")B"
    done
  done
done
