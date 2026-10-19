import type { VoicePageBridge } from "./bridge";
import { ReplyInbox } from "./reply-inbox";
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

const inbox = new ReplyInbox();

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
	onDrained: () => inbox.drained(),
	fetchSegment: (index, signal) => inbox.pull(index, signal),
});

bridge.onPlay((message) => {
	const { accepted, fresh } = inbox.push(message);
	if (!accepted) return;
	// A new reply restarts the scheduler (play() stops the old one first).
	if (fresh || !scheduler.playing) void scheduler.play();
});
bridge.onStop(() => {
	inbox.stop();
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
		inbox.stop();
		scheduler.stop();
	},
});
// A failed start (no detector yet, or the microphone refused) must not be an
// unhandled rejection; the page has no error channel up yet, so it reports
// "no speech" by staying silent and logs for the app's console capture.
vad.start().catch((error: unknown) => {
	console.error("voice page: listening did not start", error);
});
window.addEventListener("pagehide", () => void vad.close());
