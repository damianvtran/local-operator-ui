/**
 * The pinned local-voice models (local-voice plan S2). The ONLY place these
 * revisions, sizes and hashes live: changing one means a re-download for every
 * user. SHA-256 comes from the Hugging Face LFS ids, or was computed for the
 * small non-LFS files. Pure data - safe to import from main and the page.
 */
export type ManifestFile = {
	/** The closed name the page asks for: `<group>/<file>`. */
	name: string;
	repo: string;
	revision: string;
	/** Path inside the repository. */
	path: string;
	bytes: number;
	sha256: string;
};

const MOONSHINE = {
	repo: "onnx-community/moonshine-base-ONNX",
	revision: "b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad",
} as const;
const SUPERTONIC = {
	repo: "onnx-community/Supertonic-TTS-ONNX",
	revision: "cff123c84b0655d9d647641f1b532c3cbb8f7faa",
} as const;

function file(
	group: string,
	source: { repo: string; revision: string },
	path: string,
	bytes: number,
	sha256: string,
): ManifestFile {
	const base = path.split("/").pop() as string;
	return { name: `${group}/${base}`, ...source, path, bytes, sha256 };
}

export const MOONSHINE_FILES: readonly ManifestFile[] = [
	file(
		"moonshine",
		MOONSHINE,
		"onnx/encoder_model_quantized.onnx",
		20_513_063,
		"1dd9ab0a7f987113d30affcba5a068d11c8f90fa0223caa3e491ade431ad9751",
	),
	file(
		"moonshine",
		MOONSHINE,
		"onnx/decoder_model_merged_quantized.onnx",
		42_498_870,
		"cc9f3cd6698a369c6008b41aa60aa3fb3322e7f03c9bdf19d8e6b7200afca4f3",
	),
	file(
		"moonshine",
		MOONSHINE,
		"tokenizer.json",
		3_761_754,
		"7b913404bdd039af4756783218af4440bc07fb7d6d8258d677e34f95b3ec416f",
	),
	file(
		"moonshine",
		MOONSHINE,
		"config.json",
		922,
		"fab7241d1e9fc6c2370c4c6dfb5da79bb54d67ed9ab6b507ac51d29d2abe01d1",
	),
];

export const SUPERTONIC_FILES: readonly ManifestFile[] = [
	file(
		"supertonic",
		SUPERTONIC,
		"onnx/text_encoder.onnx",
		433_169,
		"50a03d29d5dc95918eeff578f542b814f3cf5a741f927116f5a8462a76ff6898",
	),
	file(
		"supertonic",
		SUPERTONIC,
		"onnx/text_encoder.onnx_data",
		28_426_752,
		"6415854f135a318909dc716e90f83a391d9a91bd9da09bdb6d6763d6b0a6c102",
	),
	file(
		"supertonic",
		SUPERTONIC,
		"onnx/latent_denoiser.onnx",
		398_102,
		"9a639a8c05c9be111848562c5cf10ea2697a589c6341830aac479d0ce7b75aa9",
	),
	file(
		"supertonic",
		SUPERTONIC,
		"onnx/latent_denoiser.onnx_data",
		132_098_880,
		"cde4abf1136defce235bc446eaab4954a57721ae8d5a4754cdd337bf191b612f",
	),
	file(
		"supertonic",
		SUPERTONIC,
		"onnx/voice_decoder.onnx",
		59_921,
		"83c104006dabcd6b568c0d5acb6fec18f65609d2391dd2c459e4440e85027669",
	),
	file(
		"supertonic",
		SUPERTONIC,
		"onnx/voice_decoder.onnx_data",
		101_353_472,
		"ea52402c9ba5131ee2b3901a86db2f0b435b322169cd75157e053493d967d17f",
	),
	file(
		"supertonic",
		SUPERTONIC,
		"tokenizer.json",
		2_038,
		"da6954f045585fc12c8ea9831b3c3eb1c5bffc8ef7ff6b6db7de781cd472ee01",
	),
	file(
		"supertonic",
		SUPERTONIC,
		"config.json",
		247,
		"37cdafab327b4360e0d6911956bfb3ca3d7254b53749e06ca41ab422d7686259",
	),
	file(
		"supertonic",
		SUPERTONIC,
		"voices/F1.bin",
		51_712,
		"5ef84e3421e4f80994a5a40a18ba39ba9fc48175c41ae6cf3e56418820872dbf",
	),
	file(
		"supertonic",
		SUPERTONIC,
		"voices/M1.bin",
		51_712,
		"7d53fbaaccf39a358010dcc5f289fc1d5cb350fe5f518be35f62cc518d794892",
	),
];

export const MODEL_MANIFEST: readonly ManifestFile[] = [
	...MOONSHINE_FILES,
	...SUPERTONIC_FILES,
];

/** The closed set `voice-page:model` accepts. */
export const MODEL_NAMES: ReadonlySet<string> = new Set(
	MODEL_MANIFEST.map((f) => f.name),
);

export function huggingFaceUrl(f: ManifestFile): string {
	return `https://huggingface.co/${f.repo}/resolve/${f.revision}/${f.path}`;
}
