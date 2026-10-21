import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import {
	MODEL_MANIFEST,
	type ManifestFile,
	huggingFaceUrl,
} from "../../voice-page/model-manifest";

/*
 * The local-voice model store (plan S2, L1/L7). Electron-free so it is tested
 * as plain code; `dir` is `userData/voice-models`. Called only after the person
 * enabled voice and accepted the download notice - nothing at startup imports
 * this file (a test pins that). Every byte is checked against the manifest's
 * SHA-256 before it is used.
 */
export type ModelErrorCode = "model_integrity" | "model_download" | "aborted";

export class ModelError extends Error {
	constructor(
		readonly code: ModelErrorCode,
		detail?: string,
	) {
		super(detail ? `${code}: ${detail}` : code);
		this.name = "ModelError";
	}
}

export type ModelProgress = {
	file: string;
	/** Bytes of all files done so far, including this file's partial bytes. */
	received: number;
	total: number;
};

export type EnsureModelsOptions = {
	dir: string;
	fetch: typeof fetch;
	onProgress?: (progress: ModelProgress) => void;
	signal?: AbortSignal;
	/** Defaults to the pinned manifest; tests pass small fixtures. */
	manifest?: readonly ManifestFile[];
};

const localPath = (dir: string, name: string) => join(dir, ...name.split("/"));

async function sha256OfFile(path: string): Promise<string> {
	const hash = createHash("sha256");
	await pipeline(createReadStream(path), async (source) => {
		for await (const chunk of source) hash.update(chunk as Buffer);
	});
	return hash.digest("hex");
}

/** Files re-hashed this app run: "once per app run before use". */
const verifiedThisRun = new Set<string>();

/** Test hook: forget what this run verified. */
export function resetVerifiedModels(): void {
	verifiedThisRun.clear();
}

async function isPresentAndGood(
	dir: string,
	f: ManifestFile,
): Promise<boolean> {
	const path = localPath(dir, f.name);
	const key = `${path}:${f.sha256}`;
	try {
		if ((await stat(path)).size !== f.bytes) return false;
		if (verifiedThisRun.has(key)) return true;
		if ((await sha256OfFile(path)) !== f.sha256) {
			await rm(path, { force: true });
			return false;
		}
		verifiedThisRun.add(key);
		return true;
	} catch {
		return false;
	}
}

async function download(
	f: ManifestFile,
	opts: EnsureModelsOptions,
	doneBefore: number,
	total: number,
): Promise<void> {
	const final = localPath(opts.dir, f.name);
	const part = `${final}.part`;
	await mkdir(dirname(final), { recursive: true });
	const discard = () => rm(part, { force: true });
	try {
		const response = await opts.fetch(huggingFaceUrl(f), {
			signal: opts.signal,
		});
		if (!response.ok || !response.body) {
			throw new ModelError("model_download", `${f.name} ${response.status}`);
		}
		const hash = createHash("sha256");
		let received = 0;
		const out = createWriteStream(part);
		// Hash while streaming: the file is never read back to be checked.
		await pipeline(
			response.body as unknown as AsyncIterable<Uint8Array>,
			async function* (source: AsyncIterable<Uint8Array>) {
				for await (const chunk of source) {
					hash.update(chunk);
					received += chunk.length;
					opts.onProgress?.({
						file: f.name,
						received: doneBefore + received,
						total,
					});
					yield chunk;
				}
			},
			out,
			{ signal: opts.signal },
		);
		if (hash.digest("hex") !== f.sha256 || received !== f.bytes) {
			throw new ModelError("model_integrity", f.name);
		}
		await rename(part, final);
		verifiedThisRun.add(`${final}:${f.sha256}`);
	} catch (error) {
		await discard();
		if (error instanceof ModelError) throw error;
		if (opts.signal?.aborted) throw new ModelError("aborted");
		throw new ModelError(
			"model_download",
			error instanceof Error ? error.message : String(error),
		);
	}
}

/** Makes every manifest file present and verified; fetches only what is not. */
export async function ensureModels(opts: EnsureModelsOptions): Promise<void> {
	const manifest = opts.manifest ?? MODEL_MANIFEST;
	const total = manifest.reduce((sum, f) => sum + f.bytes, 0);
	let done = 0;
	for (const f of manifest) {
		if (opts.signal?.aborted) throw new ModelError("aborted");
		if (await isPresentAndGood(opts.dir, f)) {
			done += f.bytes;
			opts.onProgress?.({ file: f.name, received: done, total });
			continue;
		}
		await download(f, opts, done, total);
		done += f.bytes;
	}
}

/**
 * The verified bytes of one manifest file for the page. A name outside the
 * manifest is refused (the page must not read arbitrary paths), and a file
 * whose hash no longer matches is refused rather than served.
 */
export async function readModel(
	dir: string,
	name: string,
	manifest: readonly ManifestFile[] = MODEL_MANIFEST,
): Promise<Uint8Array> {
	const f = manifest.find((m) => m.name === name);
	if (!f) throw new ModelError("model_integrity", `unknown model ${name}`);
	if (!(await isPresentAndGood(dir, f))) {
		throw new ModelError("model_integrity", name);
	}
	return new Uint8Array(await readFile(localPath(dir, f.name)));
}
