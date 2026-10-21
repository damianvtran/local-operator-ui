import { type VoiceDevice, pickDevice, speedVerdict } from "./device";
import { EngineError, type Listener, type Speaker } from "./engine";
import { Moonshine } from "./moonshine";
import { parseMoonshineTokenizer } from "./moonshine-tokens";
import { type Ort, loadOrt } from "./ort-runtime";
import { Supertonic, type SupertonicConfig } from "./supertonic";
import { parseSupertonicTokenizer } from "./supertonic-tokens";

/** Reads one verified model file by its manifest name (the preload's `loadModel`). */
export type ModelLoader = (name: string) => Promise<Uint8Array>;

export type LocalEngineDeps = {
	loadModel: ModelLoader;
	nav?: { gpu?: { requestAdapter(): Promise<unknown> } };
	/** Injected in tests; the default loads the real runtime. */
	loadOrt?: (device: VoiceDevice) => Promise<Ort>;
	now?: () => number;
	voice?: "F1" | "M1";
};

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/**
 * The local provider: holds both model sessions, and is the `Listener` and the
 * `Speaker`. Constructing it loads nothing; `start()` is the first thing that
 * touches the runtime, so voice off costs nothing.
 */
export class LocalEngine implements Listener, Speaker {
	device: VoiceDevice | undefined;
	private moonshine: Moonshine | undefined;
	private supertonic: Supertonic | undefined;
	private slow = false;
	private timed = false;

	constructor(private readonly deps: LocalEngineDeps) {}

	async start(): Promise<VoiceDevice> {
		const { loadModel } = this.deps;
		const device = await pickDevice(
			this.deps.nav ?? (globalThis.navigator as never) ?? {},
		);
		const ort = await (this.deps.loadOrt ?? loadOrt)(device);
		const providers = [device === "webgpu" ? "webgpu" : "wasm"];
		const session = async (name: string, externalData?: string[]) =>
			ort.InferenceSession.create(await loadModel(name), {
				executionProviders: providers,
				externalData: externalData
					? await Promise.all(
							externalData.map(async (path) => ({
								// ORT matches the graph's own reference, a bare file name.
								path: path.split("/")[1],
								data: await loadModel(path),
							})),
						)
					: undefined,
			});

		const [encoder, decoder, moonTokens] = await Promise.all([
			session("moonshine/encoder_model_quantized.onnx"),
			session("moonshine/decoder_model_merged_quantized.onnx"),
			loadModel("moonshine/tokenizer.json"),
		]);
		this.moonshine = new Moonshine(
			ort,
			{ encoder, decoder },
			parseMoonshineTokenizer(text(moonTokens)),
		);

		const [textEncoder, latentDenoiser, voiceDecoder] = await Promise.all([
			session("supertonic/text_encoder.onnx", [
				"supertonic/text_encoder.onnx_data",
			]),
			session("supertonic/latent_denoiser.onnx", [
				"supertonic/latent_denoiser.onnx_data",
			]),
			session("supertonic/voice_decoder.onnx", [
				"supertonic/voice_decoder.onnx_data",
			]),
		]);
		const config = JSON.parse(
			text(await loadModel("supertonic/config.json")),
		) as SupertonicConfig;
		const style = await loadModel(`supertonic/${this.deps.voice ?? "F1"}.bin`);
		this.supertonic = new Supertonic(
			ort,
			{ textEncoder, latentDenoiser, voiceDecoder },
			parseSupertonicTokenizer(
				text(await loadModel("supertonic/tokenizer.json")),
			),
			config,
			new Float32Array(style.slice().buffer),
		);
		this.device = device;
		return device;
	}

	transcribe(samples: Float32Array): Promise<string> {
		if (!this.moonshine) throw new EngineError("not_started");
		return this.moonshine.transcribe(samples);
	}

	async synthesize(
		input: string,
	): Promise<{ samples: Float32Array; rate: number }> {
		if (!this.supertonic) throw new EngineError("not_started");
		if (this.slow) throw new EngineError("speech_too_slow");
		const now = this.deps.now ?? Date.now;
		const started = now();
		const result = await this.supertonic.synthesize(input);
		if (!this.timed && result.samples.length > 0) {
			// Only the first sentence is timed: it is the cheapest honest sample.
			this.timed = true;
			if (
				speedVerdict(now() - started, result.samples.length / result.rate) ===
				"too_slow"
			) {
				// This sentence still plays; the verdict bites from the next one.
				this.slow = true;
			}
		}
		return result;
	}
}
