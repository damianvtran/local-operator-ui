/**
 * Where the voice page's detector assets live, shared by the page (to point
 * the library at them) and the build (to emit them). One directory beside
 * `voice-page.html` (the build output), so every load is same-origin under the page CSP.
 */
export const VAD_ASSET_DIR = "voice-page-vad";

/** The Silero model. v5 is the one the plan names; vad-web ships it as-is. */
export const VAD_MODEL_FILE = "silero_vad_v5.onnx";
export const VAD_MODEL = "v5" as const;

/** vad-web's AudioWorklet, which `baseAssetPath` + this name resolves to. */
export const VAD_WORKLET_FILE = "vad.worklet.bundle.min.js";

/**
 * EXACTLY ONE onnxruntime-web WASM variant: the plain (non-JSEP, non-JSPI)
 * one that `onnxruntime-web/wasm` - the entry vad-web imports - asks for. The
 * other three variants are 17-28 MB each and unused.
 */
export const ORT_WASM_FILE = "ort-wasm-simd-threaded.wasm";
export const ORT_MODULE_FILE = "ort-wasm-simd-threaded.mjs";

/** package -> dist file, relative to `node_modules`. Build + test read this. */
export const VAD_ASSETS: ReadonlyArray<{ from: string; file: string }> = [
	{
		from: `@ricky0123/vad-web/dist/${VAD_MODEL_FILE}`,
		file: VAD_MODEL_FILE,
	},
	{
		from: `@ricky0123/vad-web/dist/${VAD_WORKLET_FILE}`,
		file: VAD_WORKLET_FILE,
	},
	{ from: `onnxruntime-web/dist/${ORT_WASM_FILE}`, file: ORT_WASM_FILE },
	{ from: `onnxruntime-web/dist/${ORT_MODULE_FILE}`, file: ORT_MODULE_FILE },
];
