import type { VoicePageBridge } from "./bridge";
import { SegmentScheduler } from "./scheduler";
import { VadController } from "./vad";
import { createVad } from "./vad-factory";

/**
 * The voice page's entry (plan D2): listening and playback, in a hidden
 * app-owned document. Pure rules live in the sibling modules; this file only
 * wires them to Web Audio and the preload's bridge.
 */
const bridge = (window as unknown as { voicePage: VoicePageBridge }).voicePage;
const context = new AudioContext();
const gain = context.createGain();
gain.connect(context.destination);

/** Segments the bridge has delivered, keyed by id order of arrival. */
const inbox: Uint8Array[] = [];
let waiter: ((bytes: Uint8Array | null) => void) | null = null;
let ended = false;

const scheduler = new SegmentScheduler({
	audio: {
		get currentTime() {
			return context.currentTime;
		},
		async decode(bytes) {
			// decodeAudioData detaches its input, so give it a copy.
			const buffer = await context.decodeAudioData(bytes.slice().buffer);
			return { duration: buffer.duration, buffer };
		},
		start(buffer, when) {
			const source = context.createBufferSource();
			source.buffer = buffer as AudioBuffer;
			source.connect(gain);
			source.start(when);
			return { stop: () => source.stop() };
		},
		waitUntil(time, signal) {
			return new Promise((resolve, reject) => {
				const ms = Math.max(0, (time - context.currentTime) * 1000);
				const timer = setTimeout(resolve, ms);
				signal.addEventListener("abort", () => {
					clearTimeout(timer);
					reject(new Error("stopped"));
				});
			});
		},
	},
	// Main pushes segments as it fetches them (one ahead); the scheduler pulls.
	onDrained: () => {
		ended = false;
	},
	fetchSegment: (_index, signal) =>
		new Promise((resolve) => {
			const next = inbox.shift();
			if (next) return resolve(next);
			if (ended) return resolve(null);
			waiter = resolve;
			signal.addEventListener("abort", () => resolve(null));
		}),
});

bridge.onPlay(({ bytes, last }) => {
	if (last) ended = true;
	if (waiter) {
		const resolve = waiter;
		waiter = null;
		resolve(bytes);
	} else inbox.push(bytes);
	if (!scheduler.playing) void scheduler.play();
});
bridge.onStop(() => {
	inbox.length = 0;
	ended = false;
	scheduler.stop();
});
bridge.onMute((muted) => {
	gain.gain.value = muted ? 0 : 1;
});

const vad = new VadController({
	createVad,
	sendTake: (wav) => bridge.sendTake(wav),
	sendVad: (kind) => bridge.sendVad(kind),
	isPlaying: () => scheduler.playing,
	stopPlayback: () => {
		inbox.length = 0;
		scheduler.stop();
	},
});
void vad.start();
window.addEventListener("pagehide", () => void vad.close());
