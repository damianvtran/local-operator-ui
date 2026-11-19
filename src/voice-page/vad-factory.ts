import { MicVAD } from "@ricky0123/vad-web";
import type { VadFactory } from "./vad";
import { VAD_ASSET_DIR, VAD_MODEL } from "./vad-assets";

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
export const createVad: VadFactory = async (callbacks) => {
	let stream: MediaStream | null = null;
	const assetBase = new URL(`./${VAD_ASSET_DIR}/`, window.location.href).href;
	const vad = await MicVAD.new({
		model: VAD_MODEL,
		baseAssetPath: assetBase,
		onnxWASMBasePath: assetBase,
		startOnLoad: false,
		getStream: async () => {
			stream = await navigator.mediaDevices.getUserMedia({
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
	navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
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
			navigator.mediaDevices.removeEventListener(
				"devicechange",
				onDeviceChange,
			);
			return vad.destroy();
		},
	};
};
