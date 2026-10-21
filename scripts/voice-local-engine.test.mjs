import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * THE LOCAL VOICE ENGINE (local-voice plan S2), pure parts: tokenizers, device
 * choice, the Moonshine decode loop and Supertonic step loop against fake ORT
 * sessions, the model store over an injected fetch, the manifest, and the
 * "voice off loads nothing" guards. No network, microphone, window or model.
 */
const common = {
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	write: false,
};
const bundle = await build({
	...common,
	stdin: {
		contents: [
			'export * from "./src/voice-page/engine";',
			'export * from "./src/voice-page/device";',
			'export * from "./src/voice-page/moonshine";',
			'export * from "./src/voice-page/moonshine-tokens";',
			'export * from "./src/voice-page/supertonic";',
			'export * from "./src/voice-page/supertonic-tokens";',
			'export * from "./src/voice-page/local-engine";',
			'export * from "./src/voice-page/model-manifest";',
			'export * from "./src/voice-page/engine-assets";',
			'export * from "./src/voice-page/channels";',
			'export * from "./src/main/voice/voice-models";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "ts",
	},
});
const bundlePath = new URL(
	`./_voice-local-${process.pid}.mjs`,
	import.meta.url,
);
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const scratch = mkdtempSync(join(tmpdir(), "voice-local-"));
after(() => {
	rmSync(bundlePath, { force: true });
	rmSync(scratch, { recursive: true, force: true });
});
const m = await import(bundlePath.href);

/* ------------------------------- fake ORT -------------------------------- */

class FakeTensor {
	constructor(type, data, dims) {
		this.type = type;
		this.data = data;
		this.dims = dims;
	}
}
const fakeOrt = { Tensor: FakeTensor, InferenceSession: {}, env: { wasm: {} } };
const tensor = (data, dims, type = "float32") =>
	new FakeTensor(type, data, dims);

/* ------------------------------ tokenizers ------------------------------- */

const moonJson = JSON.stringify({
	model: {
		vocab: {
			"<unk>": 0,
			"<s>": 1,
			"</s>": 2,
			"<0xC3>": 3,
			"<0xA9>": 4,
			"<0xF0>": 5,
			"<0x9F>": 6,
			"<0x98>": 7,
			"<0x80>": 8,
			"▁hello": 9,
			"▁world": 10,
			caf: 11,
		},
	},
	added_tokens: [
		{ id: 1, content: "<s>", special: true },
		{ id: 2, content: "</s>", special: true },
	],
});

test("moonshine tokens: spaces, leading-space strip, specials dropped", () => {
	const v = m.parseMoonshineTokenizer(moonJson);
	assert.equal(m.decodeMoonshine(v, [1, 9, 10, 2]), "hello world");
	assert.equal(m.decodeMoonshine(v, [9]), "hello");
});

test("moonshine tokens: byte tokens join as UTF-8 (é and an emoji)", () => {
	const v = m.parseMoonshineTokenizer(moonJson);
	assert.equal(m.decodeMoonshine(v, [11, 3, 4]), "café");
	assert.equal(m.decodeMoonshine(v, [9, 5, 6, 7, 8]), "hello😀");
	assert.equal(m.decodeMoonshine(v, [999, 9]), "hello", "unknown id skipped");
});

const vocabEntries = Object.fromEntries(
	[..." abcdefghijklmnopqrstuvwxyz-.?\u0301£"].map((c, i) => [c, i]),
);
const stVocab = m.parseSupertonicTokenizer(
	JSON.stringify({ model: { vocab: vocabEntries } }),
);

test("supertonic tokens: NFKD, whitespace, dashes, dropped symbols", () => {
	const ids = (s) => m.encodeSupertonic(stVocab, s);
	const at = (c) => vocabEntries[c];
	assert.deepEqual(ids("a  \n\tb"), [at("a"), at(" "), at("b")]);
	assert.deepEqual(ids("a–b—c"), [at("a"), at("-"), at("b"), at("-"), at("c")]);
	// NFKD splits é into e + U+0301; the pinned tokenizer.json vocabulary
	// includes U+0301 (and £), so both survive.
	assert.deepEqual(ids("é"), [at("e"), at("\u0301")]);
	assert.deepEqual(ids("a😀#b"), [at("a"), at("b")]);
	assert.deepEqual(ids("😀"), []);
	assert.deepEqual(ids("ﬁ"), [at("f"), at("i")], "compatibility form");
});

/* -------------------------------- device --------------------------------- */

test("pickDevice: no gpu, adapter, null adapter, rejecting request", async () => {
	assert.equal(await m.pickDevice({}), "wasm");
	assert.equal(
		await m.pickDevice({ gpu: { requestAdapter: async () => ({}) } }),
		"webgpu",
	);
	assert.equal(
		await m.pickDevice({ gpu: { requestAdapter: async () => null } }),
		"wasm",
	);
	assert.equal(
		await m.pickDevice({
			gpu: { requestAdapter: async () => Promise.reject(new Error("no")) },
		}),
		"wasm",
	);
});

test("speedVerdict: boundary at 0.8 real-time factor", () => {
	assert.equal(m.speedVerdict(800, 1), "ok");
	assert.equal(m.speedVerdict(801, 1), "too_slow");
	assert.equal(m.speedVerdict(0, 1), "ok");
	assert.equal(m.speedVerdict(10, 0), "too_slow");
});

/* ------------------------------- moonshine ------------------------------- */

const LAYERS = 8;
function fakeMoonshine(script) {
	const calls = { encoder: [], decoder: [] };
	const encoder = {
		inputNames: ["input_values"],
		async run(feeds) {
			calls.encoder.push(feeds);
			return { last_hidden_state: tensor(new Float32Array(4), [1, 2, 2]) };
		},
	};
	const decoder = {
		inputNames: [],
		async run(feeds) {
			const step = calls.decoder.length;
			calls.decoder.push(feeds);
			const logits = new Float32Array(16);
			logits[script[Math.min(step, script.length - 1)]] = 1;
			const out = { logits: tensor(logits, [1, 1, 16]) };
			for (let l = 0; l < LAYERS; l++) {
				for (const kind of ["decoder", "encoder"]) {
					for (const part of ["key", "value"]) {
						// Tag each present with its step so feedback is traceable.
						out[`present.${l}.${kind}.${part}`] = tensor(
							new Float32Array([step]),
							[1, 8, 1, 52],
						);
					}
				}
			}
			return out;
		},
	};
	return { calls, sessions: { encoder, decoder } };
}
const clip = (seconds) => new Float32Array(Math.round(seconds * 16000));
const vocab = m.parseMoonshineTokenizer(moonJson);

test("moonshine: input names, shapes, cache feedback, stops at token 2", async () => {
	const { calls, sessions } = fakeMoonshine([9, 10, 2]);
	const text = await new m.Moonshine(fakeOrt, sessions, vocab).transcribe(
		clip(1),
	);
	assert.equal(text, "hello world");
	assert.deepEqual(Object.keys(calls.encoder[0]), ["input_values"]);
	assert.deepEqual(calls.encoder[0].input_values.dims, [1, 16000]);
	assert.equal(calls.decoder.length, 3);
	const first = calls.decoder[0];
	assert.deepEqual(first.input_ids.dims, [1, 1]);
	assert.equal(first.input_ids.data[0], 1n, "start token");
	assert.equal(first.use_cache_branch.data[0], 0, "cache branch off first");
	const names = Object.keys(first).filter((k) =>
		k.startsWith("past_key_values."),
	);
	assert.equal(names.length, LAYERS * 4);
	assert.ok(names.includes("past_key_values.7.encoder.value"));
	for (const n of names) {
		assert.equal(first[n].data.length, 0, "empty past on step 0");
		assert.deepEqual(first[n].dims, [1, 8, 0, 52]);
	}
	assert.deepEqual(first.encoder_hidden_states.dims, [1, 2, 2]);
	const second = calls.decoder[1];
	assert.equal(second.input_ids.data[0], 9n, "previous token fed back");
	assert.equal(second.use_cache_branch.data[0], 1);
	assert.equal(second.past_key_values_0 ?? 0, 0);
	assert.equal(
		second["past_key_values.0.decoder.key"].data[0],
		0,
		"step-0 present",
	);
	assert.equal(second["past_key_values.0.encoder.key"].data[0], 0);
	const third = calls.decoder[2];
	assert.equal(
		third["past_key_values.0.decoder.key"].data[0],
		1,
		"step-1 present",
	);
	assert.equal(
		third["past_key_values.0.encoder.key"].data[0],
		0,
		"encoder cache stays from the first step",
	);
});

test("moonshine: stops at the length limit scaled to the clip", async () => {
	const { calls, sessions } = fakeMoonshine([9]);
	await new m.Moonshine(fakeOrt, sessions, vocab).transcribe(clip(1));
	assert.equal(calls.decoder.length, m.maxTokensFor(1));
	assert.equal(m.maxTokensFor(1) < m.maxTokensFor(10), true);
	assert.equal(m.maxTokensFor(64), 192, "capped at 192");
});

test("moonshine: clips under 0.1 s or over 64 s are refused", async () => {
	const { calls, sessions } = fakeMoonshine([2]);
	const listener = new m.Moonshine(fakeOrt, sessions, vocab);
	await assert.rejects(listener.transcribe(clip(0.05)), {
		code: "audio_too_short",
	});
	await assert.rejects(listener.transcribe(clip(64.5)), {
		code: "audio_too_long",
	});
	await listener.transcribe(clip(0.1));
	await listener.transcribe(clip(64));
	assert.equal(calls.encoder.length, 2, "refusals never reach the encoder");
});

/* ------------------------------- supertonic ------------------------------ */

const stConfig = {
	sampling_rate: 44100,
	chunk_compress_factor: 6,
	base_chunk_size: 512,
	latent_dim: 24,
	style_dim: 128,
};
function fakeSupertonic(durations) {
	const calls = { enc: [], den: [], dec: [] };
	const textEncoder = {
		inputNames: [],
		async run(feeds) {
			calls.enc.push(feeds);
			return {
				last_hidden_state: tensor(new Float32Array(2), [1, 2, 1]),
				durations: tensor(Float32Array.from(durations), [1]),
			};
		},
	};
	const latentDenoiser = {
		inputNames: [],
		async run(feeds) {
			calls.den.push(feeds);
			return {
				denoised_latents: tensor(
					feeds.noisy_latents.data.map((x) => x + 1),
					feeds.noisy_latents.dims,
				),
			};
		},
	};
	const voiceDecoder = {
		inputNames: [],
		async run(feeds) {
			calls.dec.push(feeds);
			const n = 30000;
			return {
				waveform: tensor(
					Float32Array.from({ length: n }, (_, i) => i),
					[1, n],
				),
			};
		},
	};
	return { calls, sessions: { textEncoder, latentDenoiser, voiceDecoder } };
}
const style = new Float32Array(128 * 4);

test("supertonic: feeds, shapes, exactly 5 denoiser calls, trimming, 44.1 kHz", async () => {
	const { calls, sessions } = fakeSupertonic([0.5]);
	const speaker = new m.Supertonic(
		fakeOrt,
		sessions,
		stVocab,
		stConfig,
		style,
		m.seededNormal(1),
	);
	const out = await speaker.synthesize("ab");
	assert.equal(out.rate, 44100);
	// 0.5 s / 1.05 * 44100 samples, trimmed from a longer waveform.
	assert.equal(out.samples.length, Math.round((0.5 / 1.05) * 44100));
	assert.equal(out.samples[1], 1, "starts at the head of the waveform");

	assert.equal(calls.enc.length, 1);
	assert.deepEqual(Object.keys(calls.enc[0]), [
		"input_ids",
		"attention_mask",
		"style",
	]);
	assert.deepEqual(calls.enc[0].input_ids.dims, [1, 2]);
	assert.deepEqual(calls.enc[0].style.dims, [1, 4, 128]);

	assert.equal(calls.den.length, 5);
	const latentLen = Math.ceil(((0.5 / 1.05) * 44100) / (512 * 6));
	calls.den.forEach((f, step) => {
		assert.deepEqual(Object.keys(f).sort(), [
			"attention_mask",
			"encoder_outputs",
			"latent_mask",
			"noisy_latents",
			"num_inference_steps",
			"style",
			"timestep",
		]);
		assert.deepEqual(f.noisy_latents.dims, [1, 144, latentLen]);
		assert.deepEqual(f.latent_mask.dims, [1, latentLen]);
		assert.equal(f.timestep.type, "float32");
		assert.equal(f.timestep.data[0], step);
		assert.equal(f.num_inference_steps.type, "float32");
		assert.equal(f.num_inference_steps.data[0], 5);
	});
	// Each step's output feeds the next (+1 per fake step).
	assert.equal(
		calls.den[4].noisy_latents.data[0] - calls.den[0].noisy_latents.data[0],
		4,
	);
	assert.equal(calls.dec.length, 1);
	assert.deepEqual(Object.keys(calls.dec[0]), ["latents"]);
});

test("supertonic: seeded noise makes the run deterministic; empty text makes no calls", async () => {
	const run = async () => {
		const { calls, sessions } = fakeSupertonic([0.5]);
		await new m.Supertonic(
			fakeOrt,
			sessions,
			stVocab,
			stConfig,
			style,
			m.seededNormal(7),
		).synthesize("ab");
		return Array.from(calls.den[0].noisy_latents.data.slice(0, 8));
	};
	assert.deepEqual(await run(), await run());
	const { calls, sessions } = fakeSupertonic([0.5]);
	const out = await new m.Supertonic(
		fakeOrt,
		sessions,
		stVocab,
		stConfig,
		style,
	).synthesize("#@");
	assert.equal(out.samples.length, 0);
	assert.equal(calls.enc.length, 0);
});

/* ------------------------------ local engine ----------------------------- */

test("local engine: constructing loads nothing; synthesize before start refuses", async () => {
	let loads = 0;
	let orts = 0;
	const engine = new m.LocalEngine({
		loadModel: async () => {
			loads++;
			return new Uint8Array(0);
		},
		loadOrt: async () => {
			orts++;
			return fakeOrt;
		},
	});
	assert.equal(loads + orts, 0);
	assert.throws(() => engine.transcribe(new Float32Array(16000)), {
		code: "not_started",
	});
	await assert.rejects(engine.synthesize("hi"), { code: "not_started" });
});

test("local engine: start wires external data; a slow first sentence silences the next", async () => {
	const created = [];
	const ort = {
		...fakeOrt,
		InferenceSession: {
			async create(bytes, options) {
				created.push({ name: new TextDecoder().decode(bytes), options });
				const name = new TextDecoder().decode(bytes);
				if (name.includes("text_encoder"))
					return fakeSupertonic([1]).sessions.textEncoder;
				if (name.includes("latent_denoiser"))
					return fakeSupertonic([1]).sessions.latentDenoiser;
				if (name.includes("voice_decoder"))
					return fakeSupertonic([1]).sessions.voiceDecoder;
				return fakeMoonshine([2]).sessions.encoder;
			},
		},
	};
	const files = {
		"supertonic/config.json": JSON.stringify(stConfig),
		"supertonic/tokenizer.json": JSON.stringify({
			model: { vocab: vocabEntries },
		}),
		"supertonic/F1.bin": new Uint8Array(new Float32Array(128).buffer),
		"moonshine/tokenizer.json": moonJson,
	};
	let t = 0;
	const engine = new m.LocalEngine({
		loadModel: async (n) => {
			const v = files[n];
			return typeof v === "string"
				? new TextEncoder().encode(v)
				: (v ?? new TextEncoder().encode(n));
		},
		loadOrt: async () => ort,
		nav: {},
		// Synthesis "takes" 5 s for well under 1 s of audio: too slow.
		now: () => {
			t += 5000;
			return t;
		},
	});
	assert.equal(await engine.start(), "wasm");
	const te = created.find((c) => c.name.includes("text_encoder"));
	assert.deepEqual(te.options.executionProviders, ["wasm"]);
	assert.equal(te.options.externalData[0].path, "text_encoder.onnx_data");
	assert.equal(
		new TextDecoder().decode(te.options.externalData[0].data),
		"supertonic/text_encoder.onnx_data",
	);
	const first = await engine.synthesize("ab");
	assert.ok(first.samples.length > 0, "the timed sentence still plays");
	await assert.rejects(engine.synthesize("ab"), { code: "speech_too_slow" });
});

/* ----------------------------- model manifest ---------------------------- */

test("manifest matches the plan's pinned table", () => {
	const rows = Object.fromEntries(m.MODEL_MANIFEST.map((f) => [f.name, f]));
	assert.equal(m.MODEL_MANIFEST.length, 14);
	assert.equal(m.MODEL_NAMES.size, 14);
	const expect = {
		"moonshine/encoder_model_quantized.onnx": [
			20513063,
			"1dd9ab0a7f987113d30affcba5a068d11c8f90fa0223caa3e491ade431ad9751",
		],
		"moonshine/decoder_model_merged_quantized.onnx": [
			42498870,
			"cc9f3cd6698a369c6008b41aa60aa3fb3322e7f03c9bdf19d8e6b7200afca4f3",
		],
		"moonshine/tokenizer.json": [
			3761754,
			"7b913404bdd039af4756783218af4440bc07fb7d6d8258d677e34f95b3ec416f",
		],
		"moonshine/config.json": [
			922,
			"fab7241d1e9fc6c2370c4c6dfb5da79bb54d67ed9ab6b507ac51d29d2abe01d1",
		],
		"supertonic/text_encoder.onnx": [
			433169,
			"50a03d29d5dc95918eeff578f542b814f3cf5a741f927116f5a8462a76ff6898",
		],
		"supertonic/text_encoder.onnx_data": [
			28426752,
			"6415854f135a318909dc716e90f83a391d9a91bd9da09bdb6d6763d6b0a6c102",
		],
		"supertonic/latent_denoiser.onnx": [
			398102,
			"9a639a8c05c9be111848562c5cf10ea2697a589c6341830aac479d0ce7b75aa9",
		],
		"supertonic/latent_denoiser.onnx_data": [
			132098880,
			"cde4abf1136defce235bc446eaab4954a57721ae8d5a4754cdd337bf191b612f",
		],
		"supertonic/voice_decoder.onnx": [
			59921,
			"83c104006dabcd6b568c0d5acb6fec18f65609d2391dd2c459e4440e85027669",
		],
		"supertonic/voice_decoder.onnx_data": [
			101353472,
			"ea52402c9ba5131ee2b3901a86db2f0b435b322169cd75157e053493d967d17f",
		],
		"supertonic/tokenizer.json": [
			2038,
			"da6954f045585fc12c8ea9831b3c3eb1c5bffc8ef7ff6b6db7de781cd472ee01",
		],
		"supertonic/config.json": [
			247,
			"37cdafab327b4360e0d6911956bfb3ca3d7254b53749e06ca41ab422d7686259",
		],
		"supertonic/F1.bin": [
			51712,
			"5ef84e3421e4f80994a5a40a18ba39ba9fc48175c41ae6cf3e56418820872dbf",
		],
		"supertonic/M1.bin": [
			51712,
			"7d53fbaaccf39a358010dcc5f289fc1d5cb350fe5f518be35f62cc518d794892",
		],
	};
	for (const [name, [bytes, sha]] of Object.entries(expect)) {
		assert.equal(rows[name].bytes, bytes, name);
		assert.equal(rows[name].sha256, sha, name);
	}
	assert.equal(
		rows["moonshine/config.json"].revision,
		"b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad",
	);
	assert.equal(
		rows["supertonic/F1.bin"].revision,
		"cff123c84b0655d9d647641f1b532c3cbb8f7faa",
	);
	assert.equal(
		m.huggingFaceUrl(rows["supertonic/F1.bin"]),
		"https://huggingface.co/onnx-community/Supertonic-TTS-ONNX/resolve/cff123c84b0655d9d647641f1b532c3cbb8f7faa/voices/F1.bin",
	);
	const total = m.MODEL_MANIFEST.reduce((s, f) => s + f.bytes, 0);
	assert.ok(total > 325e6 && total < 335e6, "about 330 MB");
});

/* ----------------------------- model store ------------------------------- */

const sha = (b) => createHash("sha256").update(b).digest("hex");
function fixture(contents) {
	const manifest = Object.entries(contents).map(([name, text]) => {
		const bytes = Buffer.from(text);
		return {
			name,
			repo: "r/x",
			revision: "rev",
			path: `p/${name.split("/")[1]}`,
			bytes: bytes.length,
			sha256: sha(bytes),
		};
	});
	return manifest;
}
function fakeFetch(contents, log) {
	return async (url, init) => {
		log.push(url);
		const key = Object.keys(contents).find((k) =>
			url.endsWith(`p/${k.split("/")[1]}`),
		);
		const body = Buffer.from(contents[key]);
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(body.subarray(0, 3));
				if (init?.signal?.aborted)
					return controller.error(new Error("aborted"));
				init?.signal?.addEventListener("abort", () =>
					controller.error(new Error("aborted")),
				);
				controller.enqueue(body.subarray(3));
				if (!contents.__hang) controller.close();
			},
		});
		return { ok: true, status: 200, body: stream };
	};
}
const dirOf = (label) => join(scratch, label);
const partsIn = (dir) =>
	existsSync(dir)
		? readdirSync(dir, { recursive: true }).filter((f) =>
				String(f).endsWith(".part"),
			)
		: [];

test("ensureModels: a good file is hashed while streaming and renamed into place", async () => {
	m.resetVerifiedModels();
	const contents = { "g/a.bin": "hello world", "g/b.bin": "second file" };
	const manifest = fixture(contents);
	const dir = dirOf("good");
	const log = [];
	const progress = [];
	await m.ensureModels({
		dir,
		fetch: fakeFetch(contents, log),
		manifest,
		onProgress: (p) => progress.push(p),
	});
	assert.equal(log.length, 2);
	assert.equal(log[0], "https://huggingface.co/r/x/resolve/rev/p/a.bin");
	assert.equal(readFileSync(join(dir, "g", "a.bin"), "utf8"), "hello world");
	assert.deepEqual(partsIn(dir), []);
	const last = progress.at(-1);
	assert.equal(last.received, last.total);
	assert.equal(
		new TextDecoder().decode(await m.readModel(dir, "g/a.bin", manifest)),
		"hello world",
	);
});

test("ensureModels: a present, verified file causes no fetch", async () => {
	const contents = { "g/a.bin": "hello world" };
	const manifest = fixture(contents);
	const dir = dirOf("present");
	await m.ensureModels({ dir, fetch: fakeFetch(contents, []), manifest });
	const log = [];
	await m.ensureModels({ dir, fetch: fakeFetch(contents, log), manifest });
	assert.deepEqual(log, []);
});

test("ensureModels: a present file is re-hashed once per run; a corrupted one is fetched again", async () => {
	const contents = { "g/a.bin": "hello world" };
	const manifest = fixture(contents);
	const dir = dirOf("rehash");
	await m.ensureModels({ dir, fetch: fakeFetch(contents, []), manifest });
	// A new app run forgets what was verified; same length, wrong bytes.
	m.resetVerifiedModels();
	writeFileSync(join(dir, "g", "a.bin"), "HELLO WORLD");
	const log = [];
	await m.ensureModels({ dir, fetch: fakeFetch(contents, log), manifest });
	assert.equal(log.length, 1, "corruption detected by the re-hash");
	assert.equal(readFileSync(join(dir, "g", "a.bin"), "utf8"), "hello world");
});

test("ensureModels: a hash mismatch deletes the part and fails model_integrity", async () => {
	m.resetVerifiedModels();
	const manifest = fixture({ "g/a.bin": "hello world" });
	const dir = dirOf("bad");
	await assert.rejects(
		m.ensureModels({
			dir,
			fetch: fakeFetch({ "g/a.bin": "HELLO WORLD" }, []),
			manifest,
		}),
		{ code: "model_integrity" },
	);
	assert.deepEqual(partsIn(dir), []);
	assert.equal(existsSync(join(dir, "g", "a.bin")), false);
});

test("ensureModels: abort leaves no part and no final file", async () => {
	m.resetVerifiedModels();
	const contents = { "g/a.bin": "hello world", __hang: true };
	const manifest = fixture({ "g/a.bin": "hello world" });
	const dir = dirOf("abort");
	const controller = new AbortController();
	const run = m.ensureModels({
		dir,
		fetch: fakeFetch(contents, []),
		manifest,
		signal: controller.signal,
		onProgress: () => controller.abort(),
	});
	await assert.rejects(run, { code: "aborted" });
	assert.deepEqual(partsIn(dir), []);
	assert.equal(existsSync(join(dir, "g", "a.bin")), false);
});

test("ensureModels: an oversized stream aborts model_integrity before it ends", async () => {
	m.resetVerifiedModels();
	const manifest = fixture({ "g/a.bin": "hello world" });
	const dir = dirOf("oversize");
	let pulledAll = false;
	const big = async () => ({
		ok: true,
		status: 200,
		body: new ReadableStream({
			pull(c) {
				c.enqueue(Buffer.alloc(8));
				if (++big.n > 100) {
					pulledAll = true;
					c.close();
				}
			},
		}),
	});
	big.n = 0;
	await assert.rejects(m.ensureModels({ dir, fetch: big, manifest }), {
		code: "model_integrity",
	});
	assert.equal(pulledAll, false);
	assert.deepEqual(partsIn(dir), []);
});

test("ensureModels: concurrent calls share one in-flight run", async () => {
	m.resetVerifiedModels();
	const contents = { "g/a.bin": "hello world", "g/b.bin": "second file" };
	const manifest = fixture(contents);
	const dir = dirOf("shared");
	const log = [];
	const f = fakeFetch(contents, log);
	const a = m.ensureModels({ dir, fetch: f, manifest });
	const b = m.ensureModels({ dir, fetch: f, manifest });
	await Promise.all([a, b]);
	assert.equal(log.length, 2, "each file fetched once");
});

test("readModel refuses a name outside the manifest, and a missing file", async () => {
	const dir = dirOf("read");
	await assert.rejects(m.readModel(dir, "../../etc/passwd"), {
		code: "model_integrity",
	});
	await assert.rejects(m.readModel(dir, "supertonic/F1.bin"), {
		code: "model_integrity",
	});
});

/* ------------------------------- channels -------------------------------- */

test("channels: model and transcript are named", () => {
	assert.equal(m.VOICE_PAGE_CHANNELS.model, "voice-page:model");
	assert.equal(m.VOICE_PAGE_CHANNELS.transcript, "voice-page:transcript");
});

/* ----------------------- voice off means nothing loads ------------------- */

const VITE_QUERY = /\?(raw|asset|url)$/;
const STATIC_ORT_IMPORT = /^import .*onnxruntime-web/m;
const DYNAMIC_ORT_IMPORT = /await import\("onnxruntime-web\/(webgpu|wasm)"\)/;

async function inputsOf(entry) {
	const r = await build({
		...common,
		entryPoints: [entry],
		metafile: true,
		outdir: "unused",
		// Vite-only `?raw` / `?asset` imports are leaves for this graph walk.
		plugins: [
			{
				name: "vite-queries",
				setup(b) {
					b.onResolve({ filter: VITE_QUERY }, (a) => ({
						path: a.path,
						external: true,
					}));
					// A dynamic import is a load that happens later, on demand: it is
					// the shape "off means nothing" allows, so the walk stops there.
					b.onResolve({ filter: /.*/ }, (a) =>
						a.kind === "dynamic-import"
							? { path: a.path, external: true }
							: undefined,
					);
				},
			},
		],
		// Follow only our own sources: a package import is a leaf, recorded as external.
	});
	return Object.keys(r.metafile.inputs);
}

test("off means nothing: app startup never reaches voice-models or the ORT runtime", async () => {
	const main = await inputsOf("src/main/index.ts");
	assert.ok(main.length > 50, "the walk really followed the main graph");
	for (const banned of [
		"voice-models",
		"model-manifest",
		"ort-runtime",
		"local-engine",
	]) {
		assert.deepEqual(
			main.filter((f) => f.includes(banned)),
			[],
			`main imports ${banned}`,
		);
	}
	const page = await inputsOf("src/voice-page/main.ts");
	for (const banned of [
		"voice-models",
		"ort-runtime",
		"local-engine",
		"moonshine",
		"supertonic",
	]) {
		assert.deepEqual(
			page.filter((f) => f.includes(banned)),
			[],
			`page entry imports ${banned}`,
		);
	}
	// The runtime itself is a dynamic import, never a top-level one.
	const ort = readFileSync("src/voice-page/ort-runtime.ts", "utf8");
	assert.doesNotMatch(ort, STATIC_ORT_IMPORT);
	assert.match(ort, DYNAMIC_ORT_IMPORT);
});

test("off means nothing: importing the engine modules calls no fetch and creates no session", async () => {
	const realFetch = globalThis.fetch;
	let fetches = 0;
	globalThis.fetch = (...a) => {
		fetches++;
		return realFetch(...a);
	};
	try {
		await import(`${bundlePath.href}?again`);
	} finally {
		globalThis.fetch = realFetch;
	}
	assert.equal(fetches, 0);
});

/* ---------------------------- build outputs ------------------------------ */

test("engine assets: sources exist, are listed, and nothing but Silero's model is bundled", () => {
	assert.deepEqual(
		m.ENGINE_ASSETS.map((a) => a.file),
		[
			"ort-wasm-simd-threaded.asyncify.wasm",
			"ort-wasm-simd-threaded.asyncify.mjs",
		],
	);
	for (const { from } of m.ENGINE_ASSETS) {
		assert.ok(existsSync(join("node_modules", from)), from);
	}
	assert.equal(
		m.ENGINE_ASSETS.find((a) => a.file.endsWith(".wasm")) && true,
		true,
	);
	const out = "out/renderer";
	if (!existsSync(join(out, "voice-page.html"))) return;
	const dir = join(out, "voice-page-vad");
	for (const { file } of m.ENGINE_ASSETS)
		assert.ok(existsSync(join(dir, file)), `built ${file}`);
	assert.ok(existsSync(join(dir, "ort-wasm-simd-threaded.wasm")));
	const all = readdirSync("out", { recursive: true }).map(String);
	assert.deepEqual(
		all.filter((f) => f.endsWith(".onnx_data")),
		[],
	);
	assert.deepEqual(
		all.filter((f) => f.endsWith(".onnx")).map((f) => f.split("/").pop()),
		["silero_vad_v5.onnx"],
	);
});
