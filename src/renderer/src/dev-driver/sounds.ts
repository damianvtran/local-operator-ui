import {
	installAudioOutputGraph,
	useAudioEngineStore,
} from "@shared/store/audio-engine-store";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useSpeechStore } from "@shared/store/speech-store";

let context: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let gain: GainNode | null = null;
let input: AnalyserNode | null = null;
let finishScrub: (() => void) | null = null;

/** Armed driver only. Install BEFORE an element exists, otherwise a decoder
 * could reach the device before the safety route. This refusal is the negative
 * control; a production element is never silently adopted into a test graph. */
export const soundDriverVerbs = {
	soundsArm: async () => {
		if (useAudioEngineStore.getState().element)
			throw new Error("sounds safety: element already exists");
		if (context) throw new Error("sounds safety: graph already armed");
		context = new AudioContext();
		await context.resume();
		installAudioOutputGraph((element) => {
			if (!context) throw new Error("sounds safety: no context");
			const source = context.createMediaElementSource(element);
			gain = context.createGain();
			gain.gain.value = 0;
			analyser = context.createAnalyser();
			input = context.createAnalyser();
			source.connect(input);
			input.connect(gain);
			gain.connect(analyser);
			analyser.connect(context.destination);
		});
		return { armed: true, contextState: context.state };
	},
	soundsFacts: () => {
		const state = useAudioEngineStore.getState();
		const samples = new Float32Array(analyser?.fftSize ?? 32);
		analyser?.getFloatTimeDomainData(samples);
		const raw = new Float32Array(input?.fftSize ?? 32);
		input?.getFloatTimeDomainData(raw);
		return {
			ownerId: state.ownerId,
			status: state.status,
			time: state.element?.currentTime ?? 0,
			duration: state.element?.duration ?? 0,
			paused: state.element?.paused ?? true,
			gain: gain?.gain.value ?? null,
			inputRms: input
				? Math.sqrt(raw.reduce((sum, n) => sum + n * n, 0) / raw.length)
				: null,
			players: Array.from(document.querySelectorAll("[data-sound-player]")).map(
				(player) => ({
					status: player.getAttribute("data-sound-status"),
					clock: player.querySelector("[data-sound-time]")?.textContent,
					clip: (
						player.querySelectorAll("canvas")[1] as
							| HTMLCanvasElement
							| undefined
					)?.style.clipPath,
					numeric: getComputedStyle(
						player.querySelector("[data-sound-time]") ?? player,
					).fontVariantNumeric,
				}),
			),
			rms: analyser
				? Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length)
				: null,
			src: state.element?.src ?? null,
			nativeElements: document.querySelectorAll("audio").length,
			canvas: Object.values(useCanvasStore.getState().conversations).map(
				(pane) => ({
					selectedTab: pane.selectedTabId,
					files: pane.files?.map((file) => ({
						id: file.id,
						path: file.path,
						artifact: file.artifact ?? null,
					})),
				}),
			),
		};
	},
	soundsScrub: (payload: unknown) => {
		const request = payload as { selector: string; fraction: number };
		const slider = document.querySelector<HTMLElement>(request.selector);
		if (!slider) throw new Error("sounds: no slider");
		const rect = slider.getBoundingClientRect();
		const fire = (type: string, x: number) =>
			slider.dispatchEvent(
				new PointerEvent(type, {
					pointerId: 17,
					pointerType: "mouse",
					clientX: x,
					clientY: rect.y + rect.height / 2,
					bubbles: true,
				}),
			);
		// Synthetic pointers have no native capture registration; dispatch the same
		// handlers without pretending this establishes outside-window capture proof.
		const capture = slider.setPointerCapture;
		const release = slider.releasePointerCapture;
		slider.setPointerCapture = () => {};
		slider.releasePointerCapture = () => {};
		fire("pointerdown", rect.left + 1);
		fire("pointermove", rect.left + rect.width * request.fraction);
		/*
		 * THE STATUS IS SAMPLED AFTER IT COMMITS, NOT ON THE NEXT FRAME. The
		 * pointermove's `setScrubbing(true)` is a React state update, so the
		 * `data-sound-status` attribute lands on the commit that follows the
		 * event - which is not guaranteed to be the very next rAF. That is the
		 * one-frame-early read QA measured as `{"during":"playing",
		 * "seconds":7.799999}` on two of two runs while the seek itself had
		 * committed. Poll a bounded window for the user-visible state; on
		 * timeout resolve with what was seen, so a scrub that never starts
		 * still fails the scene's strict `during === "scrubbing"` assertion
		 * rather than being papered over.
		 */
		const statusNow = () =>
			slider.closest("[data-sound-player]")?.getAttribute("data-sound-status");
		const deadline = performance.now() + 1500;
		return new Promise((resolve) => {
			const sample = () => {
				const during = statusNow();
				if (during !== "scrubbing" && performance.now() < deadline) {
					requestAnimationFrame(sample);
					return;
				}
				finishScrub = () => {
					fire("pointerup", rect.left + rect.width * request.fraction);
					slider.setPointerCapture = capture;
					slider.releasePointerCapture = release;
				};
				resolve({
					during,
					seconds: useAudioEngineStore.getState().element?.currentTime,
				});
			};
			requestAnimationFrame(sample);
		});
	},
	soundsScrubFinish: () => {
		finishScrub?.();
		finishScrub = null;
		return { committed: true };
	},
	soundsEnd: () => {
		const state = useAudioEngineStore.getState();
		if (!state.ownerId || !state.element)
			throw new Error("sounds: no active playback");
		state.seek(state.ownerId, state.element.duration - 0.12);
		return { requested: true };
	},
	soundsSpeech: async () => {
		const state = useAudioEngineStore.getState();
		if (!state.element?.src) throw new Error("sounds: fixture not resolved");
		// Keep the fixture's optional media dependency out of startup evaluation;
		// only an armed speech probe needs this cached/IPC attachment adapter.
		const { fetchAttachmentBlob } = await import(
			"@features/chat/canonical/use-attachment-url"
		);
		const sessionId = useCanonicalSessionsStore.getState().activeSessionId;
		const digest = state.ownerId?.startsWith("sound:")
			? state.ownerId.slice("sound:".length)
			: null;
		if (!sessionId || !digest)
			throw new Error("sounds: missing attachment identity");
		// The speech store is real; synthesis is deliberately replaced by the local
		// PCM fixture so no provider request or charge can escape this evidence rig.
		await useSpeechStore
			.getState()
			.speak("sounds-driver", () =>
				fetchAttachmentBlob({ sessionId, childId: null }, digest),
			);
		return { ownerId: useAudioEngineStore.getState().ownerId };
	},
};
