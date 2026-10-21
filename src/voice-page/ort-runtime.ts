import type { VoiceDevice } from "./device";
import { VAD_ASSET_DIR } from "./vad-assets";

/**
 * The slice of onnxruntime-web the runners use. Structural on purpose: the
 * runners are tested against a fake of exactly this, and nothing here pulls the
 * runtime in through a type.
 */
export type OrtTensor = {
	readonly data: ArrayLike<number | bigint | boolean>;
	readonly dims: readonly number[];
};
export type OrtSession = {
	readonly inputNames: readonly string[];
	run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
};
export type OrtSessionOptions = {
	executionProviders?: string[];
	externalData?: ReadonlyArray<{ path: string; data: Uint8Array }>;
};
export type Ort = {
	Tensor: new (
		type: "float32" | "int64" | "bool",
		data: Float32Array | BigInt64Array | Uint8Array,
		dims: readonly number[],
	) => OrtTensor;
	InferenceSession: {
		create(model: Uint8Array, options?: OrtSessionOptions): Promise<OrtSession>;
	};
	env: { wasm: { numThreads: number; wasmPaths: string } };
};

/**
 * Loads ORT for a device, and only when asked: the dynamic import keeps the
 * runtime out of every startup path (voice off loads nothing). `wasm` uses the
 * entry the VAD already loads; `webgpu` the same 1.30.0 package's webgpu entry,
 * which asks for the asyncify wasm variant (see engine-assets.ts).
 */
export async function loadOrt(device: VoiceDevice): Promise<Ort> {
	const ort = (device === "webgpu"
		? await import("onnxruntime-web/webgpu")
		: await import("onnxruntime-web/wasm")) as unknown as Ort;
	// One thread: the page is not cross-origin isolated, so ORT would fall back
	// to one anyway, and this stops it trying to spawn a helper worker.
	ort.env.wasm.numThreads = 1;
	ort.env.wasm.wasmPaths = new URL(
		`./${VAD_ASSET_DIR}/`,
		window.location.href,
	).href;
	return ort;
}
