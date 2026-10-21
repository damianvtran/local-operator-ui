import type { VoicePageBridge } from "./bridge";
import type { PageStatusCode } from "./channels";
import type { Listener, Speaker } from "./engine";
import { LocalReply } from "./local-reply";
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

let reply: LocalReply | null = null;
/** The local engine, once `start()` has loaded it; null until then. */
let listener: Listener | null = null;
let speaker: Speaker | null = null;

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
	// The local reply pump pushes segments as it makes them; the scheduler pulls.
	onDrained: () => {
		inbox.drained();
		reply = null;
		bridge.sendPlayback("ended");
	},
	onSegmentStart: (index) => {
		if (index === 0) bridge.sendPlayback("started");
		reply?.noteStarted(index);
	},
	fetchSegment: (index, signal) => inbox.pull(index, signal),
});

bridge.onPlay((message) => {
	const { accepted, fresh } = inbox.push(message);
	if (!accepted) return;
	// A new reply restarts the scheduler (play() stops the old one first).
	if (fresh || !scheduler.playing) void scheduler.play();
});
function stopAll(): void {
	const wasPlaying = scheduler.playing || reply !== null;
	reply?.stop();
	reply = null;
	inbox.stop();
	scheduler.stop();
	if (wasPlaying) bridge.sendPlayback("cancelled");
}
bridge.onStop(stopAll);

let replyCounter = 0;
bridge.onSpeak((message) => {
	if (!speaker) return;
	stopAll();
	const replyId = `${message.replyId}:${++replyCounter}`;
	const current: LocalReply = new LocalReply(
		{
			speaker,
			push: (index, wav, last) => {
				if (reply !== current) return;
				const { accepted, fresh } = inbox.push({
					id: { replyId, index },
					bytes: wav,
					last,
				});
				if (accepted && fresh) void scheduler.play();
			},
			end: (lastIndex) => {
				if (reply !== current) return;
				if (lastIndex < 0) {
					reply = null;
					bridge.sendPlayback("ended");
				} else inbox.end(replyId, lastIndex);
			},
			// The sentence in hand still plays; the rest stay on screen only.
			onTooSlow: () => bridge.sendStatus("speech_too_slow"),
			onError: (error) => console.error("voice page: synthesis failed", error),
		},
		message.segments,
	);
	reply = current;
	void current.run();
});
bridge.onMute((muted) => {
	gain.gain.value = muted ? 0 : 1;
});

const vad = new VadController({
	createVad,
	sendTake: (wav) => bridge.sendTake(wav),
	// Local mode: the utterance never leaves the page as audio, only as text.
	onUtterance: (samples) => {
		if (!listener) return;
		listener.transcribe(samples).then(
			(text) => {
				if (text.trim()) bridge.sendTranscript(text);
			},
			(error: unknown) => {
				// A too-short clip is normal noise; anything else is worth a status.
				if ((error as { code?: string })?.code === "audio_too_short") return;
				console.error("voice page: transcription failed", error);
			},
		);
	},
	sendVad: (kind) => bridge.sendVad(kind),
	isPlaying: () => scheduler.playing,
	stopPlayback: stopAll,
});
/**
 * START (L1, L3): load the local engine, then open the microphone. Nothing is
 * imported or created before this runs, so a page that is never opened costs
 * nothing; the import is dynamic so the page's entry never statically reaches
 * the runtime. A failure is reported as a status from a closed set, never text.
 */
async function start(): Promise<void> {
	const report = (code: PageStatusCode) => bridge.sendStatus(code);
	try {
		const { LocalEngine } = await import("./local-engine");
		const engine = new LocalEngine({
			loadModel: (name) => bridge.loadModel(name),
		});
		await engine.start();
		listener = engine;
		speaker = engine;
	} catch (error) {
		console.error("voice page: the engine did not load", error);
		report("listening_failed");
		return;
	}
	try {
		await vad.start();
		report("listening");
	} catch (error) {
		console.error("voice page: listening did not start", error);
		const denied = (error as { name?: string })?.name === "NotAllowedError";
		report(denied ? "mic_unavailable" : "listening_failed");
	}
}
void start();
window.addEventListener("pagehide", () => void vad.close());
