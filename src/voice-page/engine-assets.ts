/**
 * The extra ORT files the WebGPU entry needs (local-voice plan S2). They land
 * in the same folder as the VAD's assets (`VAD_ASSET_DIR`), which is also where
 * `wasmPaths` points. `onnxruntime-web/webgpu`'s bundle names only the
 * asyncify variant. No model weights are ever listed here: models are
 * downloaded to the user's data folder, never bundled.
 */
export const ORT_ASYNCIFY_WASM_FILE = "ort-wasm-simd-threaded.asyncify.wasm";
export const ORT_ASYNCIFY_MODULE_FILE = "ort-wasm-simd-threaded.asyncify.mjs";

export const ENGINE_ASSETS: ReadonlyArray<{ from: string; file: string }> = [
	{
		from: `onnxruntime-web/dist/${ORT_ASYNCIFY_WASM_FILE}`,
		file: ORT_ASYNCIFY_WASM_FILE,
	},
	{
		from: `onnxruntime-web/dist/${ORT_ASYNCIFY_MODULE_FILE}`,
		file: ORT_ASYNCIFY_MODULE_FILE,
	},
];
