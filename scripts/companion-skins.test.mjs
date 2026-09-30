import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs, {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import zlib, { crc32, deflateSync } from "node:zlib";
import { build } from "esbuild";

const bundle = await build({
	entryPoints: ["src/main/companion-skins.ts"],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { CompanionSkinLibrary } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const ID = /^custom-[a-f0-9]{32}$/;
const JSON_ERROR = /not valid JSON/;
const PATH_ERROR = /relative PNG filenames/;
const ESCAPE_ERROR = /outside the pack folder/;
const MANIFEST_ESCAPE_ERROR = /manifest must be inside/;
const SIZE_ERROR = /too large/;
const DIMENSION_ERROR = /2048 pixels/;
const PNG_ERROR = /valid PNG/;
const ANIMATED_ERROR = /animated PNG/;
const SAVE_ERROR = /Could not save/;
const REGULAR_FILE_ERROR = /not a regular file/;
const REMOVE_ERROR = /Could not remove/;
const REPLACE_ERROR = /custom companion to replace/;
const FULL_ERROR = /library is full/;

const MISSING_POSE_ERROR = /"working" pose \("workking\.png"\).*Could not read/;
const BAD_POSE_ERROR = /"sleeping" pose \("broken\.png"\).*valid PNG/;
const ESCAPING_POSE_ERROR =
	/"complete" pose \("\.\.\/outside\.png"\).*relative PNG/;
const UNKNOWN_POSE_ERROR =
	/Unknown companion pose "happy"\. Supported poses: idle, working, attention, complete, error, offline, sleeping/;
const UNKNOWN_FIELD_ERROR =
	/Unsupported companion field "author"\. Supported fields: version, name, frames, pixelated/;
const MISTYPED_POSE_ERROR = /"working" pose must name a PNG file/;

function chunk(type, payload) {
	const buffer = Buffer.alloc(payload.length + 12);
	buffer.writeUInt32BE(payload.length);
	buffer.write(type, 4);
	payload.copy(buffer, 8);
	buffer.writeUInt32BE(crc32(buffer.subarray(4, -4)), buffer.length - 4);
	return buffer;
}

function png({ width = 2, height = 2, pixels, extra = [], header = {} } = {}) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = header.depth ?? 8;
	ihdr[9] = header.color ?? 6;
	ihdr[12] = header.interlace ?? 0;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", ihdr),
		...extra,
		chunk("IDAT", deflateSync(pixels ?? Buffer.alloc((2 * 4 + 1) * 2))),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "companion-skin-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const source = join(root, "source");
	const libraryPath = join(root, "library");
	mkdirSync(source);
	const manifest = join(source, "companion.json");
	const idle = png();
	writeFileSync(join(source, "idle.png"), idle);
	const write = (changes = {}) => {
		writeFileSync(
			manifest,
			JSON.stringify({
				version: 1,
				name: "Fern",
				frames: { idle: "idle.png" },
				...changes,
			}),
		);
		return manifest;
	};
	write();
	return {
		root,
		source,
		libraryPath,
		manifest,
		idle,
		write,
		library: new CompanionSkinLibrary(libraryPath),
	};
}

function dataUrl(bytes) {
	return `data:image/png;base64,${bytes.toString("base64")}`;
}

function savedId(pack) {
	return `custom-${createHash("sha256").update(JSON.stringify(pack)).digest("hex").slice(0, 32)}`;
}

test("import copies poses, preserves optional poses and survives removal of source files", (t) => {
	const f = fixture(t);
	const working = png({ pixels: Buffer.alloc(18, 1) });
	const sleeping = png({ pixels: Buffer.alloc(18, 2) });
	writeFileSync(join(f.source, "working.png"), working);
	writeFileSync(join(f.source, "sleeping.png"), sleeping);
	f.write({
		name: " Fern ",
		pixelated: true,
		frames: {
			idle: "idle.png",
			working: "working.png",
			sleeping: "sleeping.png",
		},
	});
	const result = f.library.import(f.manifest);
	assert.match(result.id, ID);
	assert.deepEqual(result, {
		id: result.id,
		name: "Fern",
		pixelated: true,
		frames: {
			idle: dataUrl(f.idle),
			working: dataUrl(working),
			sleeping: dataUrl(sleeping),
		},
	});
	assert.equal(f.library.import(f.manifest).id, result.id);
	assert.equal(f.library.list().length, 5);
	rmSync(f.source, { recursive: true });
	assert.deepEqual(
		new CompanionSkinLibrary(f.libraryPath).get(result.id),
		result,
	);

	assert.deepEqual(readdirSync(f.libraryPath), [
		".index.json",
		`${result.id}.json`,
	]);
	if (process.platform !== "win32")
		assert.equal(
			statSync(join(f.libraryPath, `${result.id}.json`)).mode & 0o777,
			0o600,
		);
});

test("all seven poses near the image size limit survive a library restart", (t) => {
	const f = fixture(t);
	const text = Buffer.alloc(2 * 1024 * 1024 - 100, 97);
	text.write("Comment\0");
	writeFileSync(
		join(f.source, "large.png"),
		png({ extra: [chunk("tEXt", text)] }),
	);
	f.write({
		frames: Object.fromEntries(
			[
				"idle",
				"working",
				"attention",
				"complete",
				"error",
				"offline",
				"sleeping",
			].map((pose) => [pose, "large.png"]),
		),
	});
	const result = f.library.import(f.manifest);
	assert.ok(
		statSync(join(f.libraryPath, `${result.id}.json`)).size > 17 * 1024 * 1024,
	);
	assert.deepEqual(
		new CompanionSkinLibrary(f.libraryPath).get(result.id),
		result,
	);
});

test("single PNG import names the companion and persists an idle-only pose", (t) => {
	const f = fixture(t);
	for (const [filename, name] of [
		["My_little-friend.PNG", "My little friend"],
		["---__ .png", "My companion"],
		[`${"a".repeat(90)}.png`, "a".repeat(64)],
	]) {
		const image = join(f.source, filename);
		writeFileSync(image, f.idle);
		const result = f.library.import(image);
		assert.deepEqual(result, {
			id: result.id,
			name,
			pixelated: false,
			frames: { idle: dataUrl(f.idle) },
		});
		assert.deepEqual(
			new CompanionSkinLibrary(f.libraryPath).get(result.id),
			result,
		);
	}
});

test("schema requires an idle pose and rejects unsupported or mistyped fields", (t) => {
	const f = fixture(t);
	for (const bad of [
		{ version: 2 },
		{ name: " " },
		{ name: "a".repeat(65) },
		{ name: "bad\nname" },
		{ frames: {} },
		{ frames: { idle: 1 } },
		{ frames: { idle: "idle.png", sleeping: 1 } },
		{ frames: { idle: "idle.png", thinking: "idle.png" } },
		{ pixelated: "true" },
		{ script: "run.js" },
		{ frames: [] },
	]) {
		f.write(bad);
		assert.throws(() => f.library.import(f.manifest));
	}
	writeFileSync(f.manifest, "{ broken");
	assert.throws(() => f.library.import(f.manifest), JSON_ERROR);
	assert.equal(f.library.list().length, 4);
});

test("manifest errors identify the pose, relative file and unsupported key without replacing healthy artwork", (t) => {
	const f = fixture(t);
	const original = f.library.import(f.manifest);
	writeFileSync(join(f.source, "broken.png"), Buffer.from("broken"));
	for (const [changes, message] of [
		[
			{ frames: { idle: "idle.png", working: "workking.png" } },
			MISSING_POSE_ERROR,
		],
		[{ frames: { idle: "idle.png", sleeping: "broken.png" } }, BAD_POSE_ERROR],
		[
			{ frames: { idle: "idle.png", complete: "../outside.png" } },
			ESCAPING_POSE_ERROR,
		],
		[{ frames: { idle: "idle.png", happy: "idle.png" } }, UNKNOWN_POSE_ERROR],
		[{ author: "Artist" }, UNKNOWN_FIELD_ERROR],
		[{ frames: { idle: "idle.png", working: 1 } }, MISTYPED_POSE_ERROR],
	]) {
		assert.throws(
			() => f.library.import(f.write(changes), original.id),
			message,
		);
		assert.deepEqual(f.library.get(original.id), original);
		assert.deepEqual(
			new CompanionSkinLibrary(f.libraryPath).get(original.id),
			original,
		);
	}
	assert.throws(
		() => f.library.import(join(f.source, "broken.png")),
		(error) => {
			assert.equal(error.message, "Each pose must be a valid PNG image.");
			return true;
		},
	);
});

test("poses cannot escape the selected folder or fetch a URL", (t) => {
	const f = fixture(t);
	for (const path of [
		"../idle.png",
		"sub/../idle.png",
		"/tmp/idle.png",
		"C:\\idle.png",
		"sub\\idle.png",
		"https://example.com/idle.png",
		"file:///tmp/idle.png",
		"data:image/png;base64,anything",
		"idle.svg",
	]) {
		for (const pose of ["idle", "sleeping"]) {
			f.write({ frames: { idle: "idle.png", [pose]: path } });
			assert.throws(() => f.library.import(f.manifest), PATH_ERROR);
		}
	}
	writeFileSync(join(f.root, "outside.png"), f.idle);
	symlinkSync(join(f.root, "outside.png"), join(f.source, "escape.png"));
	for (const pose of ["idle", "sleeping"]) {
		f.write({ frames: { idle: "idle.png", [pose]: "escape.png" } });
		assert.throws(() => f.library.import(f.manifest), ESCAPE_ERROR);
	}
	mkdirSync(join(f.source, "nested"));
	symlinkSync(
		join(f.source, "idle.png"),
		join(f.source, "nested", "inside.png"),
	);
	f.write({ frames: { idle: "nested/inside.png" } });
	assert.equal(f.library.import(f.manifest).frames.idle, dataUrl(f.idle));
});

test("the selected manifest cannot itself be a symlink outside its folder", (t) => {
	const f = fixture(t);
	writeFileSync(join(f.root, "outside.json"), readFileSync(f.manifest));
	rmSync(f.manifest);
	symlinkSync(join(f.root, "outside.json"), f.manifest);
	assert.throws(() => f.library.import(f.manifest), MANIFEST_ESCAPE_ERROR);
});

test("files and image dimensions have bounded sizes", (t) => {
	const f = fixture(t);
	const image = join(f.source, "idle.png");
	for (const [bytes, error] of [
		[Buffer.alloc(2 * 1024 * 1024 + 1), SIZE_ERROR],
		[png({ width: 2049 }), DIMENSION_ERROR],
		[png({ height: 0 }), DIMENSION_ERROR],
	]) {
		writeFileSync(image, bytes);
		assert.throws(() => f.library.import(image), error);
		assert.throws(() => f.library.import(f.manifest), error);
	}
	writeFileSync(f.manifest, " ".repeat(64 * 1024 + 1));
	assert.throws(() => f.library.import(f.manifest), SIZE_ERROR);
});

test(
	"named pipes are rejected without blocking the app",
	{ skip: process.platform === "win32" },
	(t) => {
		const f = fixture(t);
		const path = join(f.source, "idle.png");
		rmSync(path);
		execFileSync("mkfifo", [path]);
		assert.throws(() => f.library.import(f.manifest), REGULAR_FILE_ERROR);
	},
);

test("PNG validation rejects wrong signatures, corrupt chunks and invalid scanlines", (t) => {
	const f = fixture(t);
	const crcBroken = Buffer.from(f.idle);
	crcBroken[crcBroken.length - 1] ^= 1;
	const badFilter = Buffer.alloc(18);
	badFilter[0] = 5;
	for (const bytes of [
		Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>", "utf8"),
		f.idle.subarray(0, 33),
		crcBroken,
		Buffer.concat([f.idle, Buffer.from("trailing")]),
		png({ pixels: Buffer.alloc(17) }),
		png({ pixels: badFilter }),
		png({ header: { color: 1 } }),
		png({ header: { depth: 7 } }),
	]) {
		writeFileSync(join(f.source, "idle.png"), bytes);
		assert.throws(() => f.library.import(f.manifest), PNG_ERROR);
	}
	writeFileSync(
		join(f.source, "idle.png"),
		png({ extra: [chunk("acTL", Buffer.alloc(8))] }),
	);
	assert.throws(() => f.library.import(f.manifest), ANIMATED_ERROR);
});

test("valid grayscale, 16-bit and interlaced PNG scanlines are accepted", (t) => {
	const f = fixture(t);
	for (const bytes of [
		png({
			header: { color: 3 },
			pixels: Buffer.alloc(6),
			extra: [
				chunk("PLTE", Buffer.alloc(6)),
				chunk("tRNS", Buffer.from([0, 255])),
			],
		}),
		png({ header: { color: 0, depth: 1 }, pixels: Buffer.alloc(4) }),
		png({ header: { color: 6, depth: 16 }, pixels: Buffer.alloc(34) }),
		png({ header: { interlace: 1 }, pixels: Buffer.alloc(19) }),
	]) {
		writeFileSync(join(f.source, "idle.png"), bytes);
		assert.ok(f.library.import(f.manifest));
	}
});

test("CRC-correct invalid palettes and unknown critical chunks are rejected", (t) => {
	const f = fixture(t);
	const indexed = (extra) =>
		png({ header: { color: 3 }, pixels: Buffer.alloc(6), extra });
	for (const bytes of [
		indexed([chunk("PLTE", Buffer.alloc(1))]),
		indexed([chunk("PLTE", Buffer.alloc(257 * 3))]),
		indexed([]),
		indexed([chunk("PLTE", Buffer.alloc(3)), chunk("PLTE", Buffer.alloc(3))]),
		png({ extra: [chunk("CRIT", Buffer.alloc(0))] }),
		png({ extra: [chunk("tRNS", Buffer.alloc(1))] }),
	]) {
		writeFileSync(join(f.source, "idle.png"), bytes);
		assert.throws(() => f.library.import(f.manifest), PNG_ERROR);
	}
	assert.equal(f.library.list().length, 4);
});

test("inactive packs are not inflated and selected artwork is cached", (t) => {
	const f = fixture(t);
	const first = f.library.import(f.manifest);
	const second = f.library.import(f.write({ name: "Moss" }));
	const inflate = t.mock.method(zlib, "inflateSync");
	syncBuiltinESMExports();
	t.after(() => {
		inflate.mock.restore();
		syncBuiltinESMExports();
	});
	const loaded = new CompanionSkinLibrary(f.libraryPath);
	assert.equal(loaded.list().length, 6);
	assert.equal(inflate.mock.callCount(), 0);
	assert.deepEqual(loaded.get(first.id), first);
	assert.equal(inflate.mock.callCount(), 1);
	assert.deepEqual(loaded.get(first.id), first);
	assert.equal(inflate.mock.callCount(), 1);
	assert.deepEqual(loaded.get(second.id), second);
	assert.equal(inflate.mock.callCount(), 2);
});

test("invalid saved pixel data falls back when selected without hiding healthy packs", (t) => {
	const f = fixture(t);
	const good = f.library.import(f.manifest);
	const corrupt = {
		version: 1,
		name: "Damaged",
		frames: { idle: dataUrl(png({ pixels: Buffer.alloc(17) })) },
		pixelated: false,
	};
	const id = savedId(corrupt);
	writeFileSync(join(f.libraryPath, `${id}.json`), JSON.stringify(corrupt));
	const loaded = new CompanionSkinLibrary(f.libraryPath);
	assert.ok(loaded.list().some((entry) => entry.id === id));
	assert.equal(loaded.get(id), null);
	assert.ok(!loaded.list().some((entry) => entry.id === id));
	assert.deepEqual(loaded.get(good.id), good);
});

test("stored packs are validated individually and a corrupt pack cannot hide a healthy one", (t) => {
	const f = fixture(t);
	const good = f.library.import(f.manifest);
	const valid = JSON.parse(
		readFileSync(join(f.libraryPath, `${good.id}.json`), "utf8"),
	);
	for (const invalid of [
		"https://example.com/pet.png",
		"data:image/png;base64,bm90IHBuZw==",
		"data:image/png;base64,!bad",
	]) {
		for (const pose of ["idle", "sleeping"]) {
			const corrupt = {
				...valid,
				frames: { ...valid.frames, [pose]: invalid },
			};
			writeFileSync(
				join(f.libraryPath, `${savedId(corrupt)}.json`),
				JSON.stringify(corrupt),
			);
		}
	}
	writeFileSync(
		join(f.libraryPath, "custom-00000000000000000000000000000000.json"),
		"broken",
	);
	writeFileSync(
		join(f.libraryPath, "custom-11111111111111111111111111111111.json"),
		JSON.stringify({ ...valid, name: "Changed without matching its ID" }),
	);
	const loaded = new CompanionSkinLibrary(f.libraryPath);
	assert.equal(loaded.list().length, 5);
	assert.deepEqual(loaded.get(good.id), good);
});

test("stored symlinks are not followed even when they contain a valid pack", (t) => {
	const f = fixture(t);
	const good = f.library.import(f.manifest);
	const stored = join(f.libraryPath, `${good.id}.json`);
	const outside = join(f.root, "outside.json");
	writeFileSync(outside, readFileSync(stored));
	rmSync(stored);
	symlinkSync(outside, stored);
	assert.equal(new CompanionSkinLibrary(f.libraryPath).get(good.id), null);
});

test("failed persistence does not leave an imported entry in memory", (t) => {
	const f = fixture(t);
	writeFileSync(f.libraryPath, "not a directory");
	assert.throws(() => f.library.import(f.manifest), SAVE_ERROR);
	assert.equal(f.library.list().length, 4);
});

test("replacement updates artwork without duplicating the character and removal persists", (t) => {
	const f = fixture(t);
	const original = f.library.import(f.manifest);
	const edited = png({ pixels: Buffer.alloc(18, 1) });
	writeFileSync(join(f.source, "idle.png"), edited);
	const replaced = f.library.import(f.manifest, original.id);
	assert.notEqual(replaced.id, original.id);
	assert.equal(replaced.frames.idle, dataUrl(edited));
	assert.equal(f.library.get(original.id), null);
	assert.equal(f.library.list().length, 5);
	assert.deepEqual(readdirSync(f.libraryPath), [
		".index.json",
		`${replaced.id}.json`,
	]);
	const loaded = new CompanionSkinLibrary(f.libraryPath);
	assert.deepEqual(loaded.get(replaced.id), replaced);
	assert.equal(loaded.import(f.manifest, replaced.id).id, replaced.id);
	assert.equal(loaded.remove(replaced.id), true);
	assert.equal(loaded.get(replaced.id), null);
	assert.equal(loaded.remove(replaced.id), false);
	assert.equal(loaded.remove("sprout"), false);
	assert.equal(new CompanionSkinLibrary(f.libraryPath).list().length, 4);
	assert.throws(() => loaded.import(f.manifest, "sprout"), REPLACE_ERROR);
	assert.throws(() => loaded.import(f.manifest, replaced.id), REPLACE_ERROR);
});

test("a full library permits replacements and identical imports", (t) => {
	const f = fixture(t);
	let first;
	for (let i = 0; i < 64; i++) {
		const imported = f.library.import(f.write({ name: `Pet ${i}` }));
		first ??= imported;
	}
	assert.equal(f.library.list().length, 68);
	assert.equal(f.library.import(f.write({ name: "Pet 0" })).id, first.id);
	f.write({ name: "Updated pet" });
	assert.throws(() => f.library.import(f.manifest), FULL_ERROR);
	const replacement = f.library.import(f.manifest, first.id);
	assert.equal(f.library.list().length, 68);
	assert.equal(f.library.get(first.id), null);
	const loaded = new CompanionSkinLibrary(f.libraryPath);
	assert.deepEqual(loaded.get(replacement.id), replacement);
	assert.equal(loaded.list().length, 68);
	const existing = loaded.import(f.write({ name: "Pet 1" }), replacement.id);
	assert.equal(existing.name, "Pet 1");
	assert.equal(loaded.list().length, 67);
	assert.equal(new CompanionSkinLibrary(f.libraryPath).list().length, 67);
});

for (const failure of ["preference rollback", "candidate cleanup"]) {
	test(`startup retains the selected artwork after full-library replacement fails during ${failure}`, (t) => {
		const f = fixture(t);
		const originals = [];
		for (let i = 0; i < 64; i++)
			originals.push(f.library.import(f.write({ name: `Pet ${i}` })));
		const original = originals.sort((a, b) => a.id.localeCompare(b.id)).at(-1);
		let candidate;
		let candidateId;
		let n = 0;
		do {
			candidate = {
				version: 1,
				name: `Replacement ${n++}`,
				frames: { idle: dataUrl(f.idle) },
				pixelated: false,
			};
			candidateId = savedId(candidate);
		} while (
			failure === "preference rollback"
				? candidateId <= original.id
				: candidateId >= original.id
		);
		const blocked = join(
			f.libraryPath,
			`${failure === "preference rollback" ? original.id : candidateId}.json`,
		);
		const unlink = fs.unlinkSync;
		const mock = t.mock.method(fs, "unlinkSync", (path) => {
			if (path === blocked) throw new Error("Fixture cannot remove artwork");
			return unlink(path);
		});
		syncBuiltinESMExports();
		t.after(() => {
			mock.mock.restore();
			syncBuiltinESMExports();
		});
		let selected = original.id;
		assert.throws(
			() =>
				f.library.import(f.write({ name: candidate.name }), original.id, {
					commit: (imported) => {
						if (failure === "candidate cleanup")
							throw new Error("Could not save selection");
						selected = imported.id;
					},
					rollback: () => selected === original.id,
				}),
			SAVE_ERROR,
		);
		assert.equal(f.library.list().length, 69);
		const expected = f.library.get(selected);
		assert.ok(expected);
		const loaded = new CompanionSkinLibrary(f.libraryPath, selected);
		assert.equal(loaded.list().length, 68);
		assert.deepEqual(loaded.get(selected), expected);
	});
}

test("failed replacement or removal preserves the selected character", (t) => {
	const f = fixture(t);
	const original = f.library.import(f.manifest);
	writeFileSync(join(f.source, "idle.png"), Buffer.from("broken"));
	assert.throws(() => f.library.import(f.manifest, original.id), PNG_ERROR);
	assert.deepEqual(f.library.get(original.id), original);
	writeFileSync(
		join(f.source, "idle.png"),
		png({ pixels: Buffer.alloc(18, 1) }),
	);
	const saved = join(f.libraryPath, `${original.id}.json`);
	const backup = join(f.root, "backup.json");
	renameSync(saved, backup);
	mkdirSync(saved);
	assert.throws(() => f.library.remove(original.id), REMOVE_ERROR);
	assert.throws(() => f.library.import(f.manifest, original.id), SAVE_ERROR);
	assert.deepEqual(f.library.get(original.id), original);
	assert.deepEqual(readdirSync(f.libraryPath), [
		".index.json",
		`${original.id}.json`,
	]);
	rmSync(saved, { recursive: true });
	renameSync(backup, saved);
	assert.deepEqual(
		new CompanionSkinLibrary(f.libraryPath).get(original.id),
		original,
	);
});

test("indexed startup reads no artwork; selection still validates and caches the chosen file", (t) => {
	const f = fixture(t);
	const first = f.library.import(f.manifest);
	const second = f.library.import(f.write({ name: "Moss" }));
	const opened = t.mock.method(fs, "openSync");
	syncBuiltinESMExports();
	t.after(() => {
		opened.mock.restore();
		syncBuiltinESMExports();
	});
	const loaded = new CompanionSkinLibrary(f.libraryPath);
	assert.equal(loaded.list().length, 6);
	assert.deepEqual(
		opened.mock.calls.map(({ arguments: [path] }) => path),
		[join(f.libraryPath, ".index.json")],
	);
	assert.deepEqual(loaded.get(first.id), first);
	assert.deepEqual(loaded.get(first.id), first);
	assert.deepEqual(loaded.get(second.id), second);
	assert.deepEqual(
		opened.mock.calls.map(({ arguments: [path] }) => path),
		[
			join(f.libraryPath, ".index.json"),
			join(f.libraryPath, `${first.id}.json`),
			join(f.libraryPath, `${second.id}.json`),
		],
	);
	const replaced = loaded.import(f.write({ name: "New fern" }), first.id);
	opened.mock.resetCalls();
	const afterReplacement = new CompanionSkinLibrary(f.libraryPath);
	assert.ok(afterReplacement.list().some(({ id }) => id === replaced.id));
	assert.ok(!afterReplacement.list().some(({ id }) => id === first.id));
	assert.deepEqual(
		opened.mock.calls.map(({ arguments: [path] }) => path),
		[join(f.libraryPath, ".index.json")],
	);
	afterReplacement.remove(replaced.id);
	opened.mock.resetCalls();
	assert.equal(new CompanionSkinLibrary(f.libraryPath).list().length, 5);
	assert.deepEqual(
		opened.mock.calls.map(({ arguments: [path] }) => path),
		[join(f.libraryPath, ".index.json")],
	);
});

test("legacy, invalid and unsafe indexes rebuild from individually validated files", (t) => {
	const f = fixture(t);
	const original = f.library.import(f.manifest);
	const path = join(f.libraryPath, ".index.json");
	const index = JSON.parse(readFileSync(path, "utf8"));
	const entry = index.packs[0];
	for (const invalid of [
		"not JSON",
		" ".repeat(32 * 1024 + 1),
		JSON.stringify({ ...index, version: 2 }),
		JSON.stringify({ ...index, packs: {} }),
		JSON.stringify({ ...index, packs: [entry, entry] }),
		...[
			{ id: "../../outside" },
			{ name: "bad\nname" },
			{ name: "a".repeat(65) },
			{ size: -1 },
			{ mtimeMs: "now" },
			{ ctimeMs: null },
			{ path: "outside.json" },
		].map((changes) =>
			JSON.stringify({ ...index, packs: [{ ...entry, ...changes }] }),
		),
	]) {
		writeFileSync(path, invalid);
		const loaded = new CompanionSkinLibrary(f.libraryPath);
		assert.equal(loaded.list().length, 5);
		assert.deepEqual(loaded.get(original.id), original);
		assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), index);
	}
	rmSync(path);
	assert.deepEqual(
		new CompanionSkinLibrary(f.libraryPath).get(original.id),
		original,
	);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), index);
	const outside = join(f.root, "outside-index.json");
	writeFileSync(
		outside,
		JSON.stringify({ ...index, packs: [{ ...entry, name: "Forged" }] }),
	);
	rmSync(path);
	symlinkSync(outside, path);
	assert.equal(
		new CompanionSkinLibrary(f.libraryPath)
			.list()
			.find(({ id }) => id === original.id).name,
		original.name,
	);
	assert.equal(
		JSON.parse(readFileSync(outside, "utf8")).packs[0].name,
		"Forged",
	);
});

test("external damage is checked despite an index and names never override selected artwork", (t) => {
	const f = fixture(t);
	const first = f.library.import(f.manifest);
	const second = f.library.import(f.write({ name: "Moss" }));
	const path = join(f.libraryPath, ".index.json");
	const index = JSON.parse(readFileSync(path, "utf8"));
	index.packs.find(({ id }) => id === first.id).name = "Edited label";
	writeFileSync(path, JSON.stringify(index));
	const loaded = new CompanionSkinLibrary(f.libraryPath);
	assert.deepEqual(loaded.get(first.id), first);
	assert.equal(
		loaded.list().find(({ id }) => id === first.id).name,
		first.name,
	);
	writeFileSync(join(f.libraryPath, `${second.id}.json`), "damaged externally");
	// Saving another pet must not bless the changed file with a fresh timestamp.
	loaded.import(f.write({ name: "New pet" }));
	const restarted = new CompanionSkinLibrary(f.libraryPath);
	assert.equal(restarted.get(second.id), null);
	assert.ok(!restarted.list().some(({ id }) => id === second.id));
	assert.deepEqual(restarted.get(first.id), first);
	const corrupt = {
		version: 1,
		name: "Damaged pixels",
		frames: { idle: dataUrl(png({ pixels: Buffer.alloc(17) })) },
		pixelated: false,
	};
	const id = savedId(corrupt);
	const stored = join(f.libraryPath, `${id}.json`);
	writeFileSync(stored, JSON.stringify(corrupt));
	const stat = statSync(stored);
	const forged = JSON.parse(readFileSync(path, "utf8"));
	forged.packs.push({
		id,
		name: corrupt.name,
		size: stat.size,
		mtimeMs: stat.mtimeMs,
		ctimeMs: stat.ctimeMs,
	});
	writeFileSync(path, JSON.stringify(forged));
	assert.equal(new CompanionSkinLibrary(f.libraryPath).get(id), null);
});

test("index write failures preserve successful imports, replacements and removals", (t) => {
	const f = fixture(t);
	const first = f.library.import(f.manifest);
	const path = join(f.libraryPath, ".index.json");
	rmSync(path);
	mkdirSync(path);
	const replacement = f.library.import(f.write({ name: "Updated" }), first.id);
	assert.equal(new CompanionSkinLibrary(f.libraryPath).get(first.id), null);
	assert.deepEqual(
		new CompanionSkinLibrary(f.libraryPath).get(replacement.id),
		replacement,
	);
	assert.equal(f.library.remove(replacement.id), true);
	assert.equal(new CompanionSkinLibrary(f.libraryPath).list().length, 4);
	assert.deepEqual(readdirSync(f.libraryPath), [".index.json"]);
});
