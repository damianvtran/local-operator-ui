import type { Speaker } from "./engine";
import type { Ort, OrtSession, OrtTensor } from "./ort-runtime";
import { type SupertonicVocab, encodeSupertonic } from "./supertonic-tokens";

/*
 * Supertonic text-to-speech: a port of transformers.js 4.3.1's
 * `SupertonicForConditionalGeneration.generate_speech` (Apache-2.0;
 * https://github.com/huggingface/transformers.js). Graph inputs were read from
 * the pinned files: text_encoder (`input_ids`, `attention_mask`, `style`),
 * latent_denoiser (`style`, `noisy_latents`, `latent_mask`, `encoder_outputs`,
 * `attention_mask`, `timestep`, `num_inference_steps`), voice_decoder
 * (`latents`).
 */
export const STEPS = 5;
export const SPEED = 1.05;

export type SupertonicConfig = {
	sampling_rate: number;
	chunk_compress_factor: number;
	base_chunk_size: number;
	latent_dim: number;
	style_dim: number;
};

export type SupertonicSessions = {
	textEncoder: OrtSession;
	latentDenoiser: OrtSession;
	voiceDecoder: OrtSession;
};

/** Standard-normal source; injectable so a test gets a fixed result. */
export type NormalSource = () => number;

/** mulberry32 -> Box-Muller: a seeded Gaussian, for deterministic tests. */
export function seededNormal(seed: number): NormalSource {
	let a = seed >>> 0;
	const uniform = () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return () =>
		Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
}

export class Supertonic implements Speaker {
	constructor(
		private readonly ort: Ort,
		private readonly sessions: SupertonicSessions,
		private readonly vocab: SupertonicVocab,
		private readonly config: SupertonicConfig,
		/** The 51,712-byte voice file read as float32 `[1, ?, style_dim]`. */
		private readonly style: Float32Array,
		private readonly normal: NormalSource = seededNormal(0x5eed),
	) {}

	async synthesize(
		text: string,
	): Promise<{ samples: Float32Array; rate: number }> {
		const { ort, config } = this;
		const ids = encodeSupertonic(this.vocab, text);
		const rate = config.sampling_rate;
		if (ids.length === 0) return { samples: new Float32Array(0), rate };

		const inputIds = new ort.Tensor(
			"int64",
			BigInt64Array.from(ids, (id) => BigInt(id)),
			[1, ids.length],
		);
		const attention = new ort.Tensor(
			"int64",
			new BigInt64Array(ids.length).fill(1n),
			[1, ids.length],
		);
		const style = new ort.Tensor("float32", this.style, [
			1,
			this.style.length / config.style_dim,
			config.style_dim,
		]);

		const encoded = await this.sessions.textEncoder.run({
			input_ids: inputIds,
			attention_mask: attention,
			style,
		});
		const hidden = encoded.last_hidden_state;
		const durations = Array.from(encoded.durations.data as ArrayLike<number>);

		// Durations are seconds; scale to samples at the output rate.
		const sampleCounts = durations.map((d) => (d / SPEED) * rate);
		const latentSize = config.base_chunk_size * config.chunk_compress_factor;
		const latentLength = Math.max(
			1,
			...sampleCounts.map((n) => Math.ceil(n / latentSize)),
		);
		const channels = config.latent_dim * config.chunk_compress_factor;

		const mask = new ort.Tensor(
			"int64",
			new BigInt64Array(latentLength).fill(1n),
			[1, latentLength],
		);
		const noise = new Float32Array(channels * latentLength);
		for (let i = 0; i < noise.length; i++) noise[i] = this.normal();
		let latents: OrtTensor = new ort.Tensor("float32", noise, [
			1,
			channels,
			latentLength,
		]);

		const stepCount = new ort.Tensor(
			"int64",
			BigInt64Array.of(BigInt(STEPS)),
			[1],
		);
		for (let step = 0; step < STEPS; step++) {
			const out = await this.sessions.latentDenoiser.run({
				style,
				noisy_latents: latents,
				latent_mask: mask,
				encoder_outputs: hidden,
				attention_mask: attention,
				timestep: new ort.Tensor("int64", BigInt64Array.of(BigInt(step)), [1]),
				num_inference_steps: stepCount,
			});
			latents = out.denoised_latents;
		}

		const decoded = await this.sessions.voiceDecoder.run({ latents });
		const wave = decoded.waveform.data as Float32Array;
		// Trim the padding the latent grid added: keep what the durations name.
		const keep = Math.min(wave.length, Math.round(sampleCounts[0]));
		return { samples: Float32Array.from(wave.subarray(0, keep)), rate };
	}
}
