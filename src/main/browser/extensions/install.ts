import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { type Entry, type ZipFile, fromBuffer } from "yauzl";
import { isExtensionId } from "../../../shared/browser-extensions";
import { verifyStoreCrx } from "./crx";

/** Fixed store endpoint built from a regex-checked id: neither the store page
 * nor renderer IPC ever supplies a download URL, and an update response's
 * `codebase` is ignored (design §1 row 3a). `prodversion` is this runtime's real
 * Chromium version so the store serves a package compatible with it. CRX3 only. */
export function storeCrxUrl(id: string): string {
	if (!isExtensionId(id)) throw new Error("Invalid extension id");
	return `https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx3&prodversion=${encodeURIComponent(process.versions.chrome ?? "0")}&x=id%3D${id}%26uc`;
}

export function safeExtensionEntry(
	root: string,
	entry: Pick<Entry, "fileName" | "externalFileAttributes">,
): string {
	const name = entry.fileName;
	const mode = entry.externalFileAttributes >>> 16;
	// Windows separators/drive prefixes are rejected on EVERY platform. ZIP Unix
	// symlinks must never create a later write-through outside the staging root.
	if (
		!name ||
		name.includes("\\") ||
		name.includes("\0") ||
		isAbsolute(name) ||
		name.includes(":") ||
		name.split("/").includes("..") ||
		(mode & 0o170000) === 0o120000
	)
		throw new Error("Unsafe extension archive entry");
	const path = resolve(root, name);
	if (relative(root, path).startsWith("..") || path === resolve(root))
		throw new Error("Unsafe extension archive entry");
	return path;
}

/** Extract only an already signature-verified archive. Streaming/lazy entries
 * keep decompression sequential; exclusive creates reject duplicate ZIP paths.
 * The destination is a NEW private directory, never a browser/user directory. */
export async function extractVerifiedArchive(
	archive: Buffer,
	directory: string,
): Promise<void> {
	const zip = await new Promise<ZipFile>((yes, no) =>
		fromBuffer(
			archive,
			{ lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
			(error, value) => (error || !value ? no(error) : yes(value)),
		),
	);
	await new Promise<void>((yes, no) => {
		let failed = false;
		const fail = (error: unknown) => {
			if (!failed) {
				failed = true;
				zip.close();
				no(error);
			}
		};
		zip.on("error", fail);
		zip.on("end", () => {
			if (!failed) yes();
		});
		zip.on("entry", (entry: Entry) => {
			void (async () => {
				const path = safeExtensionEntry(directory, entry);
				if (entry.fileName.endsWith("/"))
					await mkdir(path, { recursive: true, mode: 0o700 });
				else {
					await mkdir(dirname(path), { recursive: true, mode: 0o700 });
					const input = await new Promise<NodeJS.ReadableStream>(
						(resolve, reject) =>
							zip.openReadStream(entry, (error, stream) =>
								error || !stream ? reject(error) : resolve(stream),
							),
					);
					await pipeline(
						input,
						createWriteStream(path, { flags: "wx", mode: 0o600 }),
					);
				}
				if (!failed) zip.readEntry();
			})().catch(fail);
		});
		zip.readEntry();
	});
}

/** Measured signed package (1Password 8.12.44.33): n=1, 18,374,695 bytes
 * (stage0 official download). 64 MiB is >3x that observed maximum while bounding
 * a hostile redirect/response BEFORE buffering. Oversize is a retryable download
 * error, never a reason to skip signature checks or load a partial package. */
export const MAX_EXTENSION_DOWNLOAD_BYTES = 64 * 1024 * 1024;
export async function downloadStoreCrx(
	id: string,
	signal: AbortSignal,
	fetcher: typeof fetch = fetch,
): Promise<Buffer> {
	// credentials:"omit": the store download needs no cookies, and the browser
	// profile's Google session must never ride along with a main-process fetch.
	const response = await fetcher(storeCrxUrl(id), {
		credentials: "omit",
		signal,
	});
	if (!response.ok || !response.body)
		throw new Error("Extension download failed");
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_EXTENSION_DOWNLOAD_BYTES)
		throw new Error("Extension package exceeds download bound");
	const reader = response.body.getReader();
	const chunks: Buffer[] = [];
	let size = 0;
	try {
		while (true) {
			const part = await reader.read();
			if (part.done) break;
			size += part.value.byteLength;
			if (size > MAX_EXTENSION_DOWNLOAD_BYTES)
				throw new Error("Extension package exceeds download bound");
			chunks.push(Buffer.from(part.value));
		}
		return Buffer.concat(chunks, size);
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

/** The subset of manifest.json the manager reads. Every field is optional and
 * re-checked at use: the manifest is signed, but still vendor-authored data. */
export interface ExtensionManifest {
	manifest_version?: unknown;
	name?: unknown;
	version?: unknown;
	default_locale?: unknown;
	permissions?: unknown;
	host_permissions?: unknown;
	content_scripts?: unknown;
	background?: { service_worker?: unknown };
	action?: { default_popup?: unknown };
	options_page?: unknown;
	options_ui?: { page?: unknown };
	icons?: unknown;
}

export interface PreparedExtension {
	id: string;
	directory: string;
	crx: Buffer;
	manifest: ExtensionManifest;
	/** Display name with `__MSG_*__` resolved from the package's own locale. */
	name: string;
	/** A private staging directory created by THIS operation only. */
	dispose: () => Promise<void>;
}

/** Resolve a `__MSG_key__` manifest string from the package's default locale.
 * Chrome looks message keys up case-insensitively. Unresolvable names fall back
 * to the id so a dialog never shows a raw placeholder as if it were a name. */
async function localizedName(
	directory: string,
	manifest: ExtensionManifest,
	id: string,
): Promise<string> {
	const raw = typeof manifest.name === "string" ? manifest.name : "";
	const match = /^__MSG_([A-Za-z0-9_@]+)__$/.exec(raw);
	if (!match) return raw.trim().slice(0, 120) || id;
	const locale =
		typeof manifest.default_locale === "string" &&
		/^[A-Za-z0-9_-]{1,20}$/.test(manifest.default_locale)
			? manifest.default_locale
			: null;
	if (!locale) return id;
	try {
		const messages = JSON.parse(
			await readFile(
				join(directory, "_locales", locale, "messages.json"),
				"utf8",
			),
		) as Record<string, { message?: unknown }>;
		const wanted = match[1].toLowerCase();
		for (const [key, value] of Object.entries(messages))
			if (key.toLowerCase() === wanted && typeof value?.message === "string")
				return value.message.trim().slice(0, 120) || id;
	} catch {
		/* Missing/invalid locale file: fall through to the id. */
	}
	return id;
}

/** The signed CRX is the durable source of truth, NOT an unpacked directory
 * which a local tool could have changed. Re-verify and freshly extract on every
 * load (install, enable, startup restore). manifest.key only binds Electron's ID
 * to the VERIFIED developer public key; no vendor code is modified.
 * MV3 only: MV2 is deprecated by Chrome and out of scope here. A background
 * service worker is optional (many extensions have none). */
export async function prepareExtension(
	root: string,
	id: string,
	crx: Buffer,
): Promise<PreparedExtension> {
	const verified = verifyStoreCrx(crx, id);
	const home = await ensurePrivateDirectory(root, id);
	const directory = await mkdtemp(join(home, "verified-"));
	try {
		await extractVerifiedArchive(verified.archive, directory);
		const manifestPath = join(directory, "manifest.json");
		const manifest = JSON.parse(
			await readFile(manifestPath, "utf8"),
		) as ExtensionManifest;
		if (!manifest || typeof manifest !== "object")
			throw new Error("Invalid extension manifest");
		if (manifest.manifest_version !== 3) throw new UnsupportedManifestError();
		const name = await localizedName(directory, manifest, id);
		await writeFile(
			manifestPath,
			JSON.stringify({ ...manifest, key: verified.publicKey }),
			{ mode: 0o600 },
		);
		return {
			id,
			directory,
			crx,
			manifest,
			name,
			dispose: () => rm(directory, { recursive: true, force: true }),
		};
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
}

/** A verified package whose manifest is not MV3. Distinct so the store page
 * receives Chrome's own "deprecated manifest version" answer. */
export class UnsupportedManifestError extends Error {
	constructor() {
		super("Only Manifest V3 extensions are supported");
	}
}

/** `<root>` and `<root>/<id>` are private (0700) real directories. A symlink at
 * either level could redirect writes/deletes outside the app's data, so it is
 * refused rather than followed. `id` is regex-checked before it becomes a path. */
export async function ensurePrivateDirectory(
	root: string,
	id?: string,
): Promise<string> {
	await mkdir(root, { recursive: true, mode: 0o700 });
	if ((await lstat(root)).isSymbolicLink())
		throw new Error("Extension storage must not be a symlink");
	if (id === undefined) return root;
	if (!isExtensionId(id)) throw new Error("Invalid extension id");
	const home = join(root, id);
	await mkdir(home, { recursive: true, mode: 0o700 });
	if ((await lstat(home)).isSymbolicLink())
		throw new Error("Extension storage must not be a symlink");
	return home;
}

/** Remove stale `verified-*` extractions left by a crash. Only called before
 * any load for that id in this process, so it never deletes a loaded tree. */
export async function removeStaleExtractions(
	root: string,
	id: string,
): Promise<void> {
	const home = await ensurePrivateDirectory(root, id);
	for (const entry of await readdir(home))
		if (entry.startsWith("verified-") || entry.startsWith("commit-"))
			await rm(join(home, entry), { recursive: true, force: true });
}

export function crxPath(
	root: string,
	id: string,
	which: "official" | "pending" = "official",
): string {
	if (!isExtensionId(id)) throw new Error("Invalid extension id");
	return join(root, id, `${which}.crx`);
}

export async function persistStoreCrx(
	root: string,
	id: string,
	crx: Buffer,
	which: "official" | "pending" = "official",
): Promise<void> {
	const home = await ensurePrivateDirectory(root, id);
	// Content-addressed temporary filename plus atomic rename: interrupted writes
	// never replace a working signed package with a partial download.
	const commitDirectory = await mkdtemp(join(home, "commit-"));
	const temporary = join(
		commitDirectory,
		`${createHash("sha256").update(crx).digest("hex")}.pending`,
	);
	await writeFile(temporary, crx, { mode: 0o600, flag: "wx" });
	try {
		await rename(temporary, crxPath(root, id, which));
	} finally {
		await rm(commitDirectory, { recursive: true, force: true });
	}
}
