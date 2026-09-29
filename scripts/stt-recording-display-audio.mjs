#!/usr/bin/env node
/**
 * Writes the speech-shaped WAV a recording-display capture feeds to the rig's
 * synthetic microphone.
 *
 *     node scripts/stt-recording-display-audio.mjs <out.wav>
 *
 * WHY A FILE. The plain synthetic device is near-silent (measured: RMS
 * ~0.0008 from `getFloatTimeDomainData` under Electron 44.3.0), so frames taken
 * under it can show a lane's amplitude but never its DYNAMICS - and the
 * recording display's claim (adaptive gain: a quiet phrase stays visible, a
 * loud one stays bounded, the strip reads as movement rather than a line) is a
 * claim about a signal that changes loudness. `scripts/stt-dictation-proof.mjs`
 * plays this file into a PAGE-SIDE synthetic microphone when
 * `LO_PROOF_AUDIO_FILE` points at it.
 *
 * THE SHAPE, and why each term sits where it does. A 2 s loop - one 0.8 s
 * phrase at speech level, a 0.2 s gap, one 0.8 s phrase at roughly a quarter
 * of that level, a 0.2 s gap - so a capture that holds the take for ~8 s
 * photographs BOTH gain regimes and the gaps between them in one strip; each
 * phrase is modulated at a syllable rate so the strip has structure within a
 * phrase. The levels are chosen against the level pipeline's own constants
 * (noise floor 0.015, reference floor 0.05), so the loud phrase's in-window
 * RMS lands near the recent-loudest reference and the quiet phrase's below
 * it - the exact pair the normalization's two claims are read on. The file
 * is deterministic (a fixed LCG seeds the breath noise), so two runs of the
 * rig photograph the same signal.
 *
 * The file is a rig INPUT, never evidence: it is generated into the run's own
 * scratch, and nothing committed beside the frames depends on it.
 */
import { writeFileSync } from "node:fs";

const RATE = 44100;
const SECONDS = 2;
const TOTAL = RATE * SECONDS;

/** A seeded LCG: regenerating the file must yield the same bytes every time. */
let seed = 0x20260929;
const nextUnit = () => {
	seed = (seed * 1664525 + 1013904223) >>> 0;
	return seed / 2 ** 32;
};

/*
 * The loop's segments, in order: start and end (seconds), the carrier gain,
 * and whether the segment is speech or a gap's room tone. Gains are the
 * carrier's peak multiplier, not the RMS the pipeline sees.
 */
const SEGMENTS = [
	{ start: 0, end: 0.8, gain: 0.5, speech: true },
	{ start: 0.8, end: 1.0, gain: 0, speech: false },
	{ start: 1.0, end: 1.8, gain: 0.12, speech: true },
	{ start: 1.8, end: 2.0, gain: 0, speech: false },
];

/** The voiced carrier: a small harmonic stack, so the device hears "voice". */
const carrier = (t) =>
	0.62 * Math.sin(2 * Math.PI * 172 * t) +
	0.3 * Math.sin(2 * Math.PI * 344 * t + 0.4) +
	0.22 * Math.sin(2 * Math.PI * 690 * t + 1.1) +
	0.12 * Math.sin(2 * Math.PI * 1240 * t + 2.3);

const samples = new Int16Array(TOTAL);
for (let i = 0; i < TOTAL; i++) {
	const t = i / RATE;
	const segment = SEGMENTS.find((s) => t >= s.start && t < s.end);
	const within = segment ? t - segment.start : 0;
	/*
	 * The syllable envelope: a fixed offset plus a rectified sine at ~2.7 Hz,
	 * so a phrase reads as speech-shaped bursts rather than a held tone. The
	 * offset keeps the quiet phrase's bursts connected instead of gated.
	 */
	const envelope = segment?.speech
		? 0.15 + 0.85 * Math.abs(Math.sin(2 * Math.PI * 2.7 * within))
		: 1;
	const breath = (nextUnit() - 0.5) * 0.06;
	const raw = segment?.speech
		? segment.gain * envelope * (carrier(t) + breath)
		: 0.006 * (nextUnit() * 2 - 1);
	samples[i] = Math.round(Math.max(-1, Math.min(1, raw)) * 32767);
}

const out = process.argv[2];
if (!out) {
	console.error(
		"usage: node scripts/stt-recording-display-audio.mjs <out.wav>",
	);
	process.exit(2);
}

/* A canonical 44-byte PCM header, written by hand so this file adds no import. */
const dataBytes = TOTAL * 2;
const buffer = Buffer.alloc(44 + dataBytes);
buffer.write("RIFF", 0);
buffer.writeUInt32LE(36 + dataBytes, 4);
buffer.write("WAVE", 8);
buffer.write("fmt ", 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20); // PCM
buffer.writeUInt16LE(1, 22); // mono
buffer.writeUInt32LE(RATE, 24);
buffer.writeUInt32LE(RATE * 2, 28);
buffer.writeUInt16LE(2, 32);
buffer.writeUInt16LE(16, 34);
buffer.write("data", 36);
buffer.writeUInt32LE(dataBytes, 40);
for (let i = 0; i < TOTAL; i++) buffer.writeInt16LE(samples[i], 44 + i * 2);

writeFileSync(out, buffer);
console.log(`wrote ${out} (${SECONDS}s, ${RATE} Hz, mono, 16-bit)`);
