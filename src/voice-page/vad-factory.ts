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
	const assetBase = new URL(`./${VAD_ASSET_DIR}/`, window.location.href).href;
	const vad = await MicVAD.new({
		model: VAD_MODEL,
		baseAssetPath: assetBase,
		onnxWASMBasePath: assetBase,
		startOnLoad: false,
		getStream: () =>
			navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				},
			}),
		// One thread: the page is not cross-origin isolated, so ORT would fall
		// back to one anyway, and this stops it trying to spawn a helper worker.
		ortConfig: (ort) => {
			ort.env.wasm.numThreads = 1;
		},
		onSpeechStart: () => callbacks.onSpeechStart(),
		onSpeechEnd: (audio) => callbacks.onSpeechEnd(audio),
		onVADMisfire: () => callbacks.onMisfire?.(),
	});
	return {
		start: () => vad.start(),
		pause: () => vad.pause(),
		destroy: () => vad.destroy(),
	};
};
