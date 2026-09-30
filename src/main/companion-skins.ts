import { createHash, randomUUID } from "node:crypto";
import {
	constants,
	closeSync,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readSync,
	readdirSync,
	realpathSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { crc32, inflateSync } from "node:zlib";
import {
	BUILTIN_COMPANIONS,
	type CompanionAppearance,
	type CompanionPose,
} from "../shared/companion-skin";

const POSES: readonly CompanionPose[] = [
	"idle",
	"working",
	"attention",
	"complete",
	"error",
	"offline",
	"sleeping",
];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_EDGE = 2048;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_SAVED_BYTES = 19 * 1024 * 1024;
const MAX_PACKS = 64;
const INDEX_NAME = ".index.json";
const MAX_INDEX_BYTES = 32 * 1024;
const PNG_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SAVED_NAME = /^custom-[a-f0-9]{32}\.json$/;
const PNG_EXTENSION = /\.png$/i;
const CONTROL_CHARACTERS = /\p{Cc}/u;
const NAME_SEPARATORS = /[\p{Cc}\s_-]+/gu;
const PNG_CHUNK_TYPE = /^[A-Za-z]{2}[A-Z][A-Za-z]$/;

interface StoredPack {
	version: 1;
	name: string;
	frames: Partial<Record<CompanionPose, string>>;
	pixelated: boolean;
}

interface IndexedPack {
	id: string;
	name: string;
	size: number;
	mtimeMs: number;
	ctimeMs: number;
}

function validName(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.trim().length > 0 &&
		value.trim().length <= 64 &&
		!CONTROL_CHARACTERS.test(value)
	);
}

function quoted(value: string): string {
	return JSON.stringify(
		value.length > 160 ? `${value.slice(0, 157)}...` : value,
	);
}

function packMetadata(
	directory: string,
	id: string,
	name: string,
): IndexedPack {
	const stat = lstatSync(join(directory, `${id}.json`));
	if (!stat.isFile() || stat.size > MAX_SAVED_BYTES)
		throw new Error("Invalid saved companion file.");
	return {
		id,
		name,
		size: stat.size,
		mtimeMs: stat.mtimeMs,
		ctimeMs: stat.ctimeMs,
	};
}

function readIndex(directory: string): Map<string, IndexedPack> {
	try {
		const index = object(
			JSON.parse(
				readBounded(join(directory, INDEX_NAME), MAX_INDEX_BYTES).toString(
					"utf8",
				),
			),
		);
		if (
			index.version !== 1 ||
			Object.keys(index).some((key) => !["version", "packs"].includes(key)) ||
			!Array.isArray(index.packs) ||
			index.packs.length > MAX_PACKS
		)
			throw new Error("Invalid companion index.");
		const entries = new Map<string, IndexedPack>();
		for (const value of index.packs) {
			const entry = object(value);
			if (
				typeof entry.id !== "string" ||
				!SAVED_NAME.test(`${entry.id}.json`) ||
				entries.has(entry.id) ||
				!validName(entry.name) ||
				entry.name !== entry.name.trim() ||
				Object.keys(entry).some(
					(key) => !["id", "name", "size", "mtimeMs", "ctimeMs"].includes(key),
				) ||
				typeof entry.size !== "number" ||
				!Number.isSafeInteger(entry.size) ||
				entry.size <= 0 ||
				entry.size > MAX_SAVED_BYTES ||
				typeof entry.mtimeMs !== "number" ||
				!Number.isFinite(entry.mtimeMs) ||
				typeof entry.ctimeMs !== "number" ||
				!Number.isFinite(entry.ctimeMs)
			)
				throw new Error("Invalid companion index entry.");
			entries.set(entry.id, {
				id: entry.id,
				name: entry.name,
				size: entry.size,
				mtimeMs: entry.mtimeMs,
				ctimeMs: entry.ctimeMs,
			});
		}
		return entries;
	} catch {
		return new Map();
	}
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("A companion pack must contain a JSON object.");
	}
	return value as Record<string, unknown>;
}

function inside(directory: string, path: string): boolean {
	const child = relative(directory, path);
	return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function readBounded(path: string, limit: number): Buffer {
	const fd = openSync(
		path,
		constants.O_RDONLY |
			(constants.O_NOFOLLOW ?? 0) |
			(constants.O_NONBLOCK ?? 0),
	);
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.size > limit) {
			throw new Error(
				"A companion file is too large or is not a regular file.",
			);
		}
		const buffer = Buffer.alloc(stat.size + 1);
		let length = 0;
		while (length < buffer.length) {
			const count = readSync(fd, buffer, length, buffer.length - length, null);
			if (!count) break;
			length += count;
		}
		if (length > stat.size) {
			throw new Error(
				"A companion file changed while being imported. Try again.",
			);
		}
		return buffer.subarray(0, length);
	} finally {
		closeSync(fd);
	}
}

function writeJson(path: string, value: unknown): void {
	const temp = join(dirname(path), `.${randomUUID()}.tmp`);
	try {
		writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
		renameSync(temp, path);
	} finally {
		try {
			unlinkSync(temp);
		} catch {
			// Successful rename has already removed the temporary file.
		}
	}
}

function validatePng(bytes: Buffer, decode: boolean): void {
	const invalid = () => new Error("Each pose must be a valid PNG image.");
	if (
		bytes.length > MAX_IMAGE_BYTES ||
		bytes.length < 45 ||
		!bytes.subarray(0, 8).equals(PNG_SIGNATURE)
	) {
		throw invalid();
	}
	if (
		bytes.readUInt32BE(8) !== 13 ||
		bytes.toString("ascii", 12, 16) !== "IHDR"
	)
		throw invalid();
	const width = bytes.readUInt32BE(16);
	const height = bytes.readUInt32BE(20);
	const depth = bytes[24];
	const color = bytes[25];
	const formats: Record<number, { depths: number[]; channels: number }> = {
		0: { depths: [1, 2, 4, 8, 16], channels: 1 },
		2: { depths: [8, 16], channels: 3 },
		3: { depths: [1, 2, 4, 8], channels: 1 },
		4: { depths: [8, 16], channels: 2 },
		6: { depths: [8, 16], channels: 4 },
	};
	if (
		!formats[color]?.depths.includes(depth) ||
		bytes[26] ||
		bytes[27] ||
		bytes[28] > 1
	)
		throw invalid();
	if (!width || !height || width > MAX_EDGE || height > MAX_EDGE)
		throw new Error(
			"PNG poses must be between 1 and 2048 pixels on each side.",
		);
	const { channels } = formats[color];
	const interlaced = bytes[28] === 1;
	let ended = false;
	let palette = 0;
	let transparency = false;
	let dataEnded = false;
	const compressed: Buffer[] = [];
	for (let offset = 8; offset < bytes.length; ) {
		if (offset + 12 > bytes.length) throw invalid();
		const length = bytes.readUInt32BE(offset);
		const end = offset + 12 + length;
		if (end > bytes.length) throw invalid();
		const type = bytes.toString("latin1", offset + 4, offset + 8);
		const payload = bytes.subarray(offset + 8, end - 4);
		if (
			!PNG_CHUNK_TYPE.test(type) ||
			crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)
		) {
			throw invalid();
		}
		if (type === "IHDR" && offset !== 8) throw invalid();
		if (type === "IDAT") {
			if (dataEnded || (color === 3 && !palette)) throw invalid();
			compressed.push(payload);
		} else if (compressed.length) {
			dataEnded = true;
		}
		if (type === "PLTE") {
			if (
				palette ||
				transparency ||
				compressed.length ||
				color === 0 ||
				color === 4 ||
				!length ||
				length % 3 ||
				length > 768 ||
				(color === 3 && length / 3 > 2 ** depth)
			)
				throw invalid();
			palette = length / 3;
		} else if (type === "tRNS") {
			if (
				transparency ||
				compressed.length ||
				(color === 0
					? length !== 2
					: color === 2
						? length !== 6
						: color !== 3 || !length || length > palette)
			)
				throw invalid();
			transparency = true;
		} else if (type === "IEND") {
			if (length || end !== bytes.length || !compressed.length) throw invalid();
			ended = true;
		} else if (type === "acTL") {
			throw new Error(
				"Use still PNG poses; animated PNG files are not supported.",
			);
		} else if (
			type !== "IHDR" &&
			type !== "IDAT" &&
			!(bytes[offset + 4] & 32)
		) {
			throw invalid();
		}
		offset = end;
	}
	if (!ended) throw invalid();
	if (!decode) return;
	let pixels: Buffer;
	try {
		pixels = inflateSync(Buffer.concat(compressed), {
			maxOutputLength: MAX_EDGE * MAX_EDGE * 8 + MAX_EDGE * 7,
		});
	} catch {
		throw invalid();
	}
	const passes = interlaced
		? [
				[0, 0, 8, 8],
				[4, 0, 8, 8],
				[0, 4, 4, 8],
				[2, 0, 4, 4],
				[0, 2, 2, 4],
				[1, 0, 2, 2],
				[0, 1, 1, 2],
			]
		: [[0, 0, 1, 1]];
	let cursor = 0;
	for (const [x, y, dx, dy] of passes) {
		const columns = Math.max(0, Math.ceil((width - x) / dx));
		const rows = Math.max(0, Math.ceil((height - y) / dy));
		if (!columns) continue;
		const stride = 1 + Math.ceil((columns * channels * depth) / 8);
		for (let row = 0; row < rows; row++) {
			if (cursor >= pixels.length || pixels[cursor] > 4) throw invalid();
			cursor += stride;
		}
	}
	if (cursor !== pixels.length) throw invalid();
}

function normalizePack(
	value: unknown,
	readFrame: (path: string) => Buffer,
	{ decode = true, sourceFiles = false } = {},
): StoredPack {
	const pack = object(value);
	const unsupported = Object.keys(pack).find(
		(key) => !["version", "name", "frames", "pixelated"].includes(key),
	);
	if (unsupported !== undefined) {
		throw new Error(
			`Unsupported companion field ${quoted(unsupported)}. Supported fields: version, name, frames, pixelated.`,
		);
	}
	if (pack.version !== 1)
		throw new Error("This companion pack version is not supported.");
	if (!validName(pack.name)) {
		throw new Error(
			"Give the companion a name of 1 to 64 characters without control characters.",
		);
	}
	if (pack.pixelated !== undefined && typeof pack.pixelated !== "boolean") {
		throw new Error("The pixelated setting must be true or false.");
	}
	const sources = object(pack.frames);
	const unknownPose = Object.keys(sources).find(
		(key) => !POSES.includes(key as CompanionPose),
	);
	if (unknownPose !== undefined) {
		throw new Error(
			`Unknown companion pose ${quoted(unknownPose)}. Supported poses: ${POSES.join(", ")}.`,
		);
	}
	if (typeof sources.idle !== "string") {
		throw new Error("A companion pack needs an idle PNG pose.");
	}
	const frames: StoredPack["frames"] = {};
	for (const pose of POSES) {
		if (sources[pose] === undefined) continue;
		const source = sources[pose];
		if (typeof source !== "string")
			throw new Error(`The ${quoted(pose)} pose must name a PNG file.`);
		try {
			const bytes = readFrame(source);
			validatePng(bytes, decode);
			frames[pose] = PNG_PREFIX + bytes.toString("base64");
		} catch (error) {
			if (!sourceFiles || !(error instanceof Error)) throw error;
			const message =
				"code" in error
					? "Could not read this PNG file. Check that it exists and is readable."
					: error.message;
			throw new Error(
				`The ${quoted(pose)} pose (${quoted(source)}): ${message}`,
			);
		}
	}
	return {
		version: 1,
		name: pack.name.trim(),
		frames,
		pixelated: pack.pixelated === true,
	};
}

function identifier(pack: StoredPack): string {
	return `custom-${createHash("sha256").update(JSON.stringify(pack)).digest("hex").slice(0, 32)}`;
}

function appearance(id: string, pack: StoredPack): CompanionAppearance {
	return {
		id,
		name: pack.name,
		frames: { ...pack.frames },
		pixelated: pack.pixelated,
	};
}

function readPack(path: string, decode: boolean): StoredPack {
	return normalizePack(
		JSON.parse(readBounded(path, MAX_SAVED_BYTES).toString("utf8")),
		(source) => {
			if (
				source.length >
				PNG_PREFIX.length + 4 * Math.ceil(MAX_IMAGE_BYTES / 3)
			)
				throw new Error("Invalid saved PNG pose.");
			const bytes = Buffer.from(source.slice(PNG_PREFIX.length), "base64");
			if (source !== PNG_PREFIX + bytes.toString("base64"))
				throw new Error("Invalid saved PNG pose.");
			return bytes;
		},
		{ decode },
	);
}

export class CompanionSkinLibrary {
	private readonly packs = new Map<string, IndexedPack>();
	private cached: { id: string; pack: StoredPack } | null = null;

	constructor(private readonly directory: string) {
		let names: string[];
		try {
			names = readdirSync(directory)
				.filter((name) => SAVED_NAME.test(name))
				.sort();
		} catch {
			return;
		}
		const index = readIndex(directory);
		const entries = names.slice(0, MAX_PACKS);
		let changed = entries.length !== index.size;
		for (const filename of entries) {
			const id = filename.slice(0, -5);
			try {
				const saved = index.get(id);
				const metadata = packMetadata(directory, id, saved?.name ?? "");
				if (
					saved &&
					metadata.size === saved.size &&
					metadata.mtimeMs === saved.mtimeMs &&
					metadata.ctimeMs === saved.ctimeMs
				) {
					this.packs.set(id, saved);
					continue;
				}
				changed = true;
				// A legacy or changed file is checked once; normal startup reads only metadata.
				const pack = readPack(join(directory, filename), false);
				if (identifier(pack) !== id) continue;
				this.packs.set(id, { ...metadata, name: pack.name });
			} catch {
				changed = true;
				// A damaged custom pack must not prevent built-in companions from loading.
			}
		}
		if (changed) this.writeIndex();
	}

	private writeIndex(): void {
		try {
			writeJson(join(this.directory, INDEX_NAME), {
				version: 1,
				packs: Array.from(this.packs.values()),
			});
		} catch {
			// Pack files remain authoritative if this optional startup cache cannot be saved.
		}
	}

	list(): Array<{ id: string; name: string }> {
		return [
			...BUILTIN_COMPANIONS.map(({ id, name }) => ({ id, name })),
			...Array.from(this.packs, ([id, { name }]) => ({ id, name })).sort(
				(a, b) => a.name.localeCompare(b.name),
			),
		];
	}

	get(id: string): CompanionAppearance | null {
		const builtin = BUILTIN_COMPANIONS.find((item) => item.id === id);
		if (builtin) return { ...builtin };
		if (!this.packs.has(id)) return null;
		if (this.cached?.id === id) return appearance(id, this.cached.pack);
		try {
			const pack = readPack(join(this.directory, `${id}.json`), true);
			if (identifier(pack) !== id)
				throw new Error("Companion artwork changed.");
			this.cached = { id, pack };
			if (this.packs.get(id)?.name !== pack.name) {
				this.packs.set(id, packMetadata(this.directory, id, pack.name));
				this.writeIndex();
			}
			return appearance(id, pack);
		} catch {
			this.packs.delete(id);
			this.writeIndex();
			return null;
		}
	}

	remove(id: string): boolean {
		if (!this.packs.has(id)) return false;
		try {
			unlinkSync(join(this.directory, `${id}.json`));
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			) {
				throw new Error(
					"Could not remove this companion from the app's library.",
				);
			}
		}
		this.packs.delete(id);
		if (this.cached?.id === id) this.cached = null;
		this.writeIndex();
		return true;
	}

	import(manifestPath: string, replaceId?: string): CompanionAppearance {
		if (replaceId !== undefined && !this.packs.has(replaceId)) {
			throw new Error("Choose a custom companion to replace.");
		}
		let pack: StoredPack;
		try {
			const root = realpathSync(dirname(resolve(manifestPath)));
			const manifest = realpathSync(manifestPath);
			if (!inside(root, manifest))
				throw new Error("The manifest must be inside its chosen folder.");
			const singleImage = PNG_EXTENSION.test(manifestPath);
			const input = singleImage
				? {
						version: 1,
						name:
							basename(manifestPath)
								.slice(0, -4)
								.replace(NAME_SEPARATORS, " ")
								.trim()
								.slice(0, 64)
								.trim() || "My companion",
						frames: { idle: "idle.png" },
					}
				: JSON.parse(
						readBounded(manifest, MAX_MANIFEST_BYTES).toString("utf8"),
					);
			pack = normalizePack(
				input,
				(source) => {
					if (singleImage) return readBounded(manifest, MAX_IMAGE_BYTES);
					if (
						!source ||
						isAbsolute(source) ||
						source.includes(":") ||
						source.includes("\\") ||
						source.split("/").includes("..") ||
						!PNG_EXTENSION.test(source)
					) {
						throw new Error(
							"Pose paths must be relative PNG filenames inside the pack folder.",
						);
					}
					const path = realpathSync(resolve(root, source));
					if (!inside(root, path))
						throw new Error("A pose points outside the pack folder.");
					return readBounded(path, MAX_IMAGE_BYTES);
				},
				{ sourceFiles: !singleImage },
			);
		} catch (error) {
			if (error instanceof SyntaxError)
				throw new Error("The companion manifest is not valid JSON.");
			if (error instanceof Error && "code" in error) {
				throw new Error(
					"Could not read the companion pack. Check that its JSON and PNG files are available.",
				);
			}
			throw error;
		}
		const id = identifier(pack);
		const exists = this.packs.has(id);
		if (!exists && !replaceId && this.packs.size >= MAX_PACKS) {
			throw new Error("The companion library is full (64 custom companions).");
		}
		try {
			mkdirSync(this.directory, { recursive: true, mode: 0o700 });
			writeJson(join(this.directory, `${id}.json`), pack);
			if (replaceId && replaceId !== id) {
				try {
					this.remove(replaceId);
				} catch (error) {
					if (!exists) unlinkSync(join(this.directory, `${id}.json`));
					throw error;
				}
			}
		} catch {
			throw new Error(
				"Could not save this companion to the app's companion library.",
			);
		}
		this.packs.set(id, packMetadata(this.directory, id, pack.name));
		this.cached = { id, pack };
		this.writeIndex();
		return appearance(id, pack);
	}
}
