import { EngineError, type Listener } from "./engine";
import { type MoonshineVocab, decodeMoonshine } from "./moonshine-tokens";
import type { Ort, OrtSession, OrtTensor } from "./ort-runtime";

/*
 * Moonshine Base speech-to-text: greedy decoding, a port of the official
 * reference loop (MIT, useful-moonshine-onnx `model.py`). Input names were read
 * from the pinned graphs: encoder `input_values`; decoder `input_ids`,
 * `encoder_hidden_states`, `use_cache_branch` and
 * `past_key_values.{layer}.{decoder|encoder}.{key|value}`, answering with
 * `logits` and `present.*` of the same names.
 */
export const SAMPLE_RATE = 16_000;
export const MIN_SECONDS = 0.1;
export const MAX_SECONDS = 64;
export const START_TOKEN = 1;
export const END_TOKEN = 2;
export const MAX_TOKENS = 192;
/** Tokens per second of audio the reference allows before cutting off. */
const TOKENS_PER_SECOND = 6.5;

const LAYERS = 8;
const HEADS = 8;
const HEAD_SIZE = 52;

const PAST_KINDS = ["decoder", "encoder"] as const;
const PAST_PARTS = ["key", "value"] as const;

export type MoonshineSessions = {
	encoder: OrtSession;
	decoder: OrtSession;
};

export function maxTokensFor(seconds: number): number {
	return Math.min(
		MAX_TOKENS,
		Math.max(1, Math.ceil(seconds * TOKENS_PER_SECOND)),
	);
}

export class Moonshine implements Listener {
	constructor(
		private readonly ort: Ort,
		private readonly sessions: MoonshineSessions,
		private readonly vocab: MoonshineVocab,
	) {}

	async transcribe(samples: Float32Array): Promise<string> {
		const seconds = samples.length / SAMPLE_RATE;
		if (seconds < MIN_SECONDS) throw new EngineError("audio_too_short");
		if (seconds > MAX_SECONDS) throw new EngineError("audio_too_long");
		const { ort } = this;
		const encoded = await this.sessions.encoder.run({
			input_values: new ort.Tensor("float32", samples, [1, samples.length]),
		});
		const hidden = Object.values(encoded)[0];

		let past: Record<string, OrtTensor> = {};
		for (let layer = 0; layer < LAYERS; layer++) {
			for (const kind of PAST_KINDS) {
				for (const part of PAST_PARTS) {
					past[`past_key_values.${layer}.${kind}.${part}`] = new ort.Tensor(
						"float32",
						new Float32Array(0),
						[1, HEADS, 0, HEAD_SIZE],
					);
				}
			}
		}

		const out: number[] = [];
		let token = START_TOKEN;
		const limit = maxTokensFor(seconds);
		for (let step = 0; step < limit; step++) {
			const result = await this.sessions.decoder.run({
				input_ids: new ort.Tensor(
					"int64",
					BigInt64Array.of(BigInt(token)),
					[1, 1],
				),
				encoder_hidden_states: hidden,
				use_cache_branch: new ort.Tensor(
					"bool",
					Uint8Array.of(step === 0 ? 0 : 1),
					[1],
				),
				...past,
			});
			token = argmaxLast(result.logits);
			if (token === END_TOKEN) break;
			out.push(token);
			// Only the decoder's cache moves on: with the cache branch on, the
			// graph does not recompute the encoder's, so the first step's stay.
			const next = { ...past };
			for (let layer = 0; layer < LAYERS; layer++) {
				for (const part of PAST_PARTS) {
					const name = `${layer}.decoder.${part}`;
					next[`past_key_values.${name}`] = result[`present.${name}`];
				}
				if (step === 0) {
					for (const part of PAST_PARTS) {
						const name = `${layer}.encoder.${part}`;
						next[`past_key_values.${name}`] = result[`present.${name}`];
					}
				}
			}
			past = next;
		}
		return decodeMoonshine(this.vocab, out).trim();
	}
}

/** Argmax over the vocabulary of the last position of `[1, seq, vocab]`. */
function argmaxLast(logits: OrtTensor): number {
	const vocab = logits.dims[logits.dims.length - 1];
	const data = logits.data as ArrayLike<number>;
	const offset = data.length - vocab;
	let best = 0;
	let bestValue = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < vocab; i++) {
		const value = data[offset + i];
		if (value > bestValue) {
			bestValue = value;
			best = i;
		}
	}
	return best;
}
