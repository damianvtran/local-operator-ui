import type { MicVAD } from "@ricky0123/vad-web";
import type { VadFactory } from "./vad";
import { VAD_MODEL } from "./vad-assets";

/**
 * What the detector glue needs from its environment, so a test can drive it
 * without a browser: vad-web's `MicVAD` and the page's `navigator.mediaDevices`.
 */
export type MicVadEnvironment = {
	MicVAD: Pick<typeof MicVAD, "new">;
	mediaDevices: Pick<
		MediaDevices,
		"getUserMedia" | "addEventListener" | "removeEventListener"
	>;
	/** Where the model, worklet and WASM are served from (the page's own origin). */
	assetBase: string;
};

/**
 * The real detector: vad-web's `MicVAD` (Silero on onnxruntime-web) over the
 * microphone, mapped onto the `VoiceActivityDetector` seam.
 *
 * LAZY: the factory only runs from `VadController.start()`, and `MicVAD.new`
 * is what loads the model and the WASM, so with voice off nothing loads.
 * `startOnLoad: false` keeps construction from opening the mic; the returned
 * detector's `start()` does, and a mic refusal rejects there, into the
 * caller's catch in `main.ts` (U2 owns the user-visible status).
 *
 * Every asset is fetched from the page's own origin (`voice-page-vad/` beside
 * the html) because the page CSP allows nothing else.
 */
export const createMicVadFactory =
	(env: MicVadEnvironment): VadFactory =>
	async (callbacks) => {
		let stream: MediaStream | null = null;
		const assetBase = env.assetBase;
		const vad = await env.MicVAD.new({
			model: VAD_MODEL,
			baseAssetPath: assetBase,
			onnxWASMBasePath: assetBase,
			startOnLoad: false,
			getStream: async () => {
				stream = await env.mediaDevices.getUserMedia({
					audio: {
						echoCancellation: true,
						noiseSuppression: true,
						autoGainControl: true,
					},
				});
				// An unplugged or revoked microphone ends its track silently; vad-web
				// reports nothing, so main would go on saying "Listening" to a deaf page.
				for (const track of stream.getAudioTracks()) {
					track.addEventListener("ended", () => callbacks.onMicrophoneLost());
				}
				return stream;
			},
			// One thread: the page is not cross-origin isolated, so ORT would fall
			// back to one anyway, and this stops it trying to spawn a helper worker.
			ortConfig: (ort) => {
				ort.env.wasm.numThreads = 1;
			},
			// The REAL start, not `onSpeechStart` (the first positive frame): a cough
			// or key click is a misfire a moment later and must not cut a reply.
			onSpeechRealStart: () => callbacks.onSpeechStart(),
			onSpeechEnd: (audio) => callbacks.onSpeechEnd(audio),
			onVADMisfire: () => callbacks.onMisfire?.(),
		});
		// A device change that took the microphone's track with it.
		env.mediaDevices.addEventListener("devicechange", onDeviceChange);
		function onDeviceChange(): void {
			const live = stream
				?.getAudioTracks()
				.some((track) => track.readyState === "live");
			if (stream && !live) callbacks.onMicrophoneLost();
		}
		return {
			// Started AND holding a live microphone track, or it did not start.
			start: async () => {
				await vad.start();
				const live = stream
					?.getAudioTracks()
					.some((track) => track.readyState === "live");
				if (!live) throw new Error("the microphone is not live");
			},
			pause: () => vad.pause(),
			destroy: () => {
				env.mediaDevices.removeEventListener("devicechange", onDeviceChange);
				return vad.destroy();
			},
		};
	};
