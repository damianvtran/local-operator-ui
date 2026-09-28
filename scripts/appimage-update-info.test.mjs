#!/usr/bin/env node
/**
 * Hermetic tests for `scripts/appimage-update-info.mjs`: the ELF64 section
 * patch and readback, the refusals around it, the `.zsync` header checks and
 * the `latest-linux.yml` entry check, over synthetic fixtures.
 *
 * WHAT IS NOT TESTED HERE, and why that is deliberate rather than a gap: the
 * download of the pinned toolset and the real `zsyncmake`/`7z` children. Those
 * need the network and the release runner's packages, so nothing in this suite
 * may reach them - the runner is injected instead (`finalize`'s `runZsyncmake`)
 * exactly as `upload-release.mjs` injects its transport. The real download,
 * unpack and zsyncmake are exercised by the linux build job itself, whose
 * `prepare-toolset` + `finalize` steps are the production path.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	APPIMAGE_UPDATE_INFO,
	assertZsyncHeaders,
	embedUpdateInfo,
	finalize,
	latestYmlEntry,
	parseZsyncHeaders,
	prepareToolset,
	readUpdateInfo,
} from "./appimage-update-info.mjs";

const SCRIPT = fileURLToPath(
	new URL("./appimage-update-info.mjs", import.meta.url),
);

/** Run a case in a throwaway directory, cleaned up whatever it does. Async so
 * an async case's files still exist while it runs: a `finally` that fires when
 * the callback merely RETURNED a promise would delete them under it. */
async function withRoot(fn) {
	const root = mkdtempSync(join(tmpdir(), "appimage-update-info-test-"));
	try {
		return await fn(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

/**
 * A minimal but VALID ELF64 little-endian file with one named PROGBITS section
 * and a section-header string table, laid out the way the reader under test
 * walks it: e_shoff, then 64-byte section headers, then the section contents.
 *
 * The fixture is built rather than taken from the toolset so the suite stays
 * hermetic; its SHAPE is what the reader has to survive, and the real runtime
 * it was modelled on is covered by the build job's own evidence.
 *
 * `name` defaults to `.upd_info`; pass another name to build a file that has no
 * `.upd_info` section at all. `elfClass`/`data` allow the negative shapes.
 */
function buildElf({
	name = ".upd_info",
	size = 0x400,
	sectionCount = 3,
	namesIndex = 2,
	elfClass = 2,
	data = 1,
} = {}) {
	const names = Buffer.from(`\0${name}\0.shstrtab\0`, "latin1");
	const updOffset = 0x1000;
	const namesOffset = updOffset + size;
	const shoff = Math.ceil((namesOffset + names.length) / 8) * 8;
	const buffer = Buffer.alloc(shoff + 3 * 64);
	buffer.write("\x7fELF", 0, "latin1");
	buffer[4] = elfClass;
	buffer[5] = data;
	buffer[6] = 1;
	buffer.writeUInt16LE(2, 0x10);
	buffer.writeUInt16LE(0x3e, 0x12);
	buffer.writeUInt32LE(1, 0x14);
	buffer.writeBigUInt64LE(BigInt(shoff), 0x28);
	buffer.writeUInt16LE(64, 0x34);
	buffer.writeUInt16LE(56, 0x36);
	buffer.writeUInt16LE(0, 0x38);
	buffer.writeUInt16LE(64, 0x3a);
	buffer.writeUInt16LE(sectionCount, 0x3c);
	buffer.writeUInt16LE(namesIndex, 0x3e);
	let header = shoff + 64;
	buffer.writeUInt32LE(1, header);
	buffer.writeUInt32LE(1, header + 4);
	buffer.writeBigUInt64LE(BigInt(updOffset), header + 24);
	buffer.writeBigUInt64LE(BigInt(size), header + 32);
	header = shoff + 128;
	buffer.writeUInt32LE(1 + name.length + 1, header);
	buffer.writeUInt32LE(3, header + 4);
	buffer.writeBigUInt64LE(BigInt(namesOffset), header + 24);
	buffer.writeBigUInt64LE(BigInt(names.length), header + 32);
	names.copy(buffer, namesOffset, 0, names.length);
	return buffer;
}

/** An unpacked toolset tree of the shape electron-builder existence-checks,
 * with `runtime` as its runtime-x64. */
function buildToolset(root, runtime) {
	for (const relative of ["linux-x64", "lib/x64"])
		mkdirSync(join(root, relative), { recursive: true });
	writeFileSync(join(root, "linux-x64", "mksquashfs"), "#!/bin/sh\n");
	writeFileSync(
		join(root, "linux-x64", "desktop-file-validate"),
		"#!/bin/sh\n",
	);
	writeFileSync(join(root, "lib", "x64", "libXss.so.1"), "");
	writeFileSync(join(root, "runtime-x64"), runtime);
	return join(root, "runtime-x64");
}

function shaHex(buffer, algorithm) {
	return createHash(algorithm).update(buffer).digest("hex");
}

/** A zsync in zsyncmake's own shape: ASCII headers, then binary payload. */
function writeZsync(path, { filename, length, sha1, url, body = "zSYNCDATA" }) {
	const headers = [
		"zsync: 0.6.2",
		`Filename: ${filename}`,
		"MTime: Thu, 01 Jan 2026 00:00:00 +0000",
		"Blocksize: 2048",
		`Length: ${length}`,
		"Hash-Lengths: 2,2,4",
		`URL: ${url}`,
		`SHA-1: ${sha1}`,
		"",
	].join("\n");
	writeFileSync(
		path,
		Buffer.concat([
			Buffer.from(headers, "latin1"),
			Buffer.from(body, "latin1"),
		]),
	);
}

/** `zsyncmake` as the build would have written it, for the injected runner. */
function stubZsyncmake(appImage, zsyncPath) {
	const bytes = readFileSync(appImage);
	writeZsync(zsyncPath, {
		filename: basename(appImage),
		length: bytes.length,
		sha1: shaHex(bytes, "sha1"),
		url: basename(appImage),
	});
}

/** A `latest-linux.yml` shaped like electron-builder's, for `appImage`. */
function latestLinuxYml(appImagePath) {
	const bytes = readFileSync(appImagePath);
	const sha512 = createHash("sha512").update(bytes).digest("base64");
	return [
		"version: 0.31.5",
		"files:",
		`  - url: ${basename(appImagePath)}`,
		`    sha512: ${sha512}`,
		`    size: ${bytes.length}`,
		"    blockMapSize: 167111",
		`path: ${basename(appImagePath)}`,
		`sha512: ${sha512}`,
		'releaseDate: "2026-09-27T19:44:54.095Z"',
		"",
	].join("\n");
}

/** A dist holding one AppImage plus its feed, ready for `finalize`. */
function stageDist(
	root,
	{
		name = "local-operator-ui-0.31.5-x86_64.AppImage",
		patched = true,
		yml = null,
	} = {},
) {
	const dist = join(root, "dist");
	mkdirSync(dist, { recursive: true });
	const appImage = join(dist, name);
	// Unpatched means the section is there and empty: the state of an AppImage
	// built without the prepare step, which `finalize` must refuse.
	writeFileSync(appImage, buildElf());
	if (patched) embedUpdateInfo(appImage);
	writeFileSync(
		join(dist, "latest-linux.yml"),
		yml === null ? latestLinuxYml(appImage) : yml(appImage),
	);
	return { dist, appImage };
}

/* ---- the ELF64 section patch -------------------------------------------- */

test("readUpdateInfo reads .upd_info out of an ELF64 fixture", () =>
	withRoot((root) => {
		const file = join(root, "runtime-x64");
		writeFileSync(file, buildElf({ size: 0x400 }));
		const { section, value } = readUpdateInfo(file);
		assert.deepEqual(section, { offset: 0x1000, size: 0x400 });
		assert.equal(value, "");
	}));

test("embedUpdateInfo writes the string and its NUL, and is idempotent", () =>
	withRoot((root) => {
		const file = join(root, "runtime-x64");
		writeFileSync(file, buildElf());
		const first = embedUpdateInfo(file);
		assert.equal(first.previous, "");
		assert.equal(first.value, APPIMAGE_UPDATE_INFO);
		assert.equal(readUpdateInfo(file).value, APPIMAGE_UPDATE_INFO);
		// The byte after the string is the NUL the tools stop at.
		const bytes = readFileSync(file);
		assert.equal(bytes[first.section.offset + APPIMAGE_UPDATE_INFO.length], 0);
		// A second run normalises rather than appending: same bytes, same readback.
		const second = embedUpdateInfo(file);
		assert.equal(second.value, APPIMAGE_UPDATE_INFO);
		assert.equal(readUpdateInfo(file).value, APPIMAGE_UPDATE_INFO);
	}));

test("embedUpdateInfo refuses a section too small for the string", () =>
	withRoot((root) => {
		const file = join(root, "runtime-x64");
		writeFileSync(file, buildElf({ size: 8 }));
		assert.throws(
			() => embedUpdateInfo(file),
			/.upd_info is 8 bytes, too small for the update information \(96 bytes \+ NUL\)/,
		);
	}));

test("readUpdateInfo refuses the shapes it cannot read instead of guessing", () =>
	withRoot((root) => {
		const notElf = join(root, "not-elf");
		writeFileSync(
			notElf,
			Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200)]),
		);
		assert.throws(() => readUpdateInfo(notElf), /is not an ELF file \(magic/);

		const elf32 = join(root, "elf32");
		writeFileSync(elf32, buildElf({ elfClass: 1 }));
		assert.throws(
			() => readUpdateInfo(elf32),
			/is not a 64-bit little-endian ELF/,
		);

		const bigEndian = join(root, "big-endian");
		writeFileSync(bigEndian, buildElf({ data: 2 }));
		assert.throws(
			() => readUpdateInfo(bigEndian),
			/is not a 64-bit little-endian ELF/,
		);

		const extended = join(root, "extended");
		writeFileSync(extended, buildElf({ sectionCount: 0 }));
		assert.throws(
			() => readUpdateInfo(extended),
			/uses extended ELF section numbering, which this reader refuses rather than guessing at/,
		);
	}));

test("readUpdateInfo reports an absent .upd_info section without inventing one", () =>
	withRoot((root) => {
		const file = join(root, "runtime-x64");
		writeFileSync(file, buildElf({ name: ".text" }));
		assert.deepEqual(readUpdateInfo(file), { section: null, value: null });
	}));

/* ---- the toolset step ---------------------------------------------------- */

test("prepareToolset patches an injected toolset tree, twice", async () =>
	withRoot(async (root) => {
		const toolset = join(root, "appimage-tools");
		mkdirSync(toolset);
		const runtime = buildToolset(toolset, buildElf());
		const log = [];
		const first = await prepareToolset({
			dir: toolset,
			log: (line) => log.push(line),
		});
		assert.equal(first.runtimePath, runtime);
		assert.equal(readUpdateInfo(runtime).value, APPIMAGE_UPDATE_INFO);
		assert.match(
			log.join("\n"),
			/readback OK: gh-releases-zsync\|damianvtran\|local-operator-ui\|latest\|local-operator-ui-\*-x86_64\.AppImage\.zsync/,
		);
		await prepareToolset({ dir: toolset, log: () => {} });
		assert.equal(readUpdateInfo(runtime).value, APPIMAGE_UPDATE_INFO);
	}));

test("prepareToolset refuses a non-empty directory that is not a toolset", async () =>
	withRoot(async (root) => {
		const dir = join(root, "someones-tree");
		mkdirSync(dir);
		writeFileSync(join(dir, "notes.txt"), "not a toolset\n");
		await assert.rejects(
			() => prepareToolset({ dir, log: () => {} }),
			/is not an unpacked AppImage toolset \(missing linux-x64\/mksquashfs, linux-x64\/desktop-file-validate, runtime-x64, lib\/x64\)/,
		);
	}));

test("prepareToolset refuses an injected archive whose sha256 is not the pin", async () =>
	withRoot(async (root) => {
		const archive = join(root, "appimage-12.0.1.7z");
		writeFileSync(archive, "not the pinned archive");
		await assert.rejects(
			() =>
				prepareToolset({ dir: join(root, "tools"), archive, log: () => {} }),
			/Refusing the toolset archive at .*appimage-12\.0\.1\.7z: sha256 [0-9a-f]{64}, expected d12ff7eb8f1d1ec4652ca5237a7fbdca33acc0c758045636feca62dc6ecb8ec4 \(the pin app-builder-lib 26\.16\.1 declares for appimage-12\.0\.1\.7z\)/,
		);
	}));

/* ---- the zsync ----------------------------------------------------------- */

test("parseZsyncHeaders reads the header lines and stops at the payload", () =>
	withRoot((root) => {
		const zsync = join(root, "app.AppImage.zsync");
		writeZsync(zsync, {
			filename: "app.AppImage",
			length: 1234,
			sha1: "a".repeat(40),
			url: "app.AppImage",
		});
		const headers = parseZsyncHeaders(zsync);
		assert.equal(headers.Filename, "app.AppImage");
		assert.equal(headers.Length, "1234");
		assert.equal(headers.URL, "app.AppImage");
		assert.equal(headers["SHA-1"], "a".repeat(40));
		assert.equal(headers.zsync, "0.6.2");
	}));

test("assertZsyncHeaders verifies Filename, Length, SHA-1 and URL", () =>
	withRoot((root) => {
		const file = join(root, "app.AppImage");
		writeFileSync(file, "the built bytes\n");
		const size = statSync(file).size;
		const sha1 = shaHex(readFileSync(file), "sha1");
		const good = join(root, "good.zsync");
		writeZsync(good, {
			filename: "app.AppImage",
			length: size,
			sha1,
			url: "app.AppImage",
		});
		assert.equal(
			assertZsyncHeaders({
				zsyncPath: good,
				name: "app.AppImage",
				size,
				sha1,
			}).Length,
			String(size),
		);
		for (const [label, mutate, pattern] of [
			[
				"a leaked path in the URL header",
				{ url: "/work/app.AppImage" },
				/URL is "\/work\/app\.AppImage", expected "app\.AppImage"/,
			],
			[
				"a stale length",
				{ length: size + 1 },
				new RegExp(`Length is "${size + 1}", expected "${size}"`),
			],
			[
				"a stale sha1",
				{ sha1: "b".repeat(40) },
				/SHA-1 is "[0-9a-f]{40}", expected "[0-9a-f]{40}"/,
			],
			[
				"a stale Filename",
				{ filename: "other.AppImage" },
				/Filename is "other\.AppImage", expected "app\.AppImage"/,
			],
		]) {
			const path = join(root, "mutated.zsync");
			writeZsync(path, {
				filename: "app.AppImage",
				length: size,
				sha1,
				url: "app.AppImage",
				...mutate,
			});
			assert.throws(
				() =>
					assertZsyncHeaders({
						zsyncPath: path,
						name: "app.AppImage",
						size,
						sha1,
					}),
				pattern,
				label,
			);
		}
	}));

test("assertZsyncHeaders refuses a zsync that lost a header", () =>
	withRoot((root) => {
		const file = join(root, "app.AppImage");
		writeFileSync(file, "bytes\n");
		const size = statSync(file).size;
		const sha1 = shaHex(readFileSync(file), "sha1");
		const path = join(root, "no-url.zsync");
		writeFileSync(
			path,
			`zsync: 0.6.2\nFilename: app.AppImage\nLength: ${size}\nSHA-1: ${sha1}\n\npayload`,
		);
		assert.throws(
			() =>
				assertZsyncHeaders({
					zsyncPath: path,
					name: "app.AppImage",
					size,
					sha1,
				}),
			/carries no URL header; expected URL: app\.AppImage/,
		);
	}));

/* ---- the update feed ----------------------------------------------------- */

test("latestYmlEntry reads the AppImage's entry out of a real-shaped feed", () =>
	withRoot((root) => {
		const appImage = join(root, "app.AppImage");
		writeFileSync(appImage, "bytes\n");
		const text = latestLinuxYml(appImage);
		const entry = latestYmlEntry(text, "app.AppImage");
		assert.equal(entry.matched, true);
		assert.equal(entry.size, statSync(appImage).size);
		assert.equal(
			entry.sha512,
			createHash("sha512").update(readFileSync(appImage)).digest("base64"),
		);
		// The entry ends where the next file starts: the deb below must not be
		// read into the AppImage's sha512/size.
		const withNeighbour = text.replace(
			"path: app.AppImage",
			"  - url: app.deb\n    sha512: debhash\n    size: 7\npath: app.AppImage",
		);
		assert.deepEqual(latestYmlEntry(withNeighbour, "app.AppImage"), entry);
		// Quoted scalars are accepted; a missing entry is reported as unmatched,
		// never as an entry with invented values.
		assert.equal(
			latestYmlEntry(
				text
					.replace("    size: ", '    size: "')
					.replace("\npath:", '"\npath:'),
				"app.AppImage",
			).size,
			entry.size,
		);
		assert.deepEqual(latestYmlEntry(text, "other.AppImage"), {
			matched: false,
			sha512: null,
			size: null,
		});
	}));

test("latestYmlEntry reports an entry whose keys are missing", () =>
	withRoot((root) => {
		const appImage = join(root, "app.AppImage");
		writeFileSync(appImage, "bytes\n");
		const text = latestLinuxYml(appImage).replace(/ {4}sha512:.*\n/, "");
		const entry = latestYmlEntry(text, "app.AppImage");
		assert.equal(entry.matched, true);
		assert.equal(entry.sha512, null);
		assert.equal(entry.size, statSync(appImage).size);
	}));

/* ---- finalize ------------------------------------------------------------ */

test("finalize asserts the whole chain over a staged dist", async () =>
	withRoot(async (root) => {
		const { dist, appImage } = stageDist(root);
		const log = [];
		const result = await finalize({
			dist,
			log: (line) => log.push(line),
			runZsyncmake: stubZsyncmake,
		});
		assert.equal(result.appImage, appImage);
		assert.equal(result.zsyncPath, `${appImage}.zsync`);
		assert.match(
			log.join("\n"),
			/OK: local-operator-ui-0\.31\.5-x86_64\.AppImage carries the update information and ships with its \.zsync\./,
		);
	}));

test("finalize refuses an AppImage without the update information, and writes no zsync", async () =>
	withRoot(async (root) => {
		const { dist, appImage } = stageDist(root, { patched: false });
		let ranZsyncmake = false;
		await assert.rejects(
			() =>
				finalize({
					dist,
					log: () => {},
					runZsyncmake: () => {
						ranZsyncmake = true;
					},
				}),
			/\.upd_info is <empty>, expected "gh-releases-zsync\|damianvtran\|local-operator-ui\|latest\|local-operator-ui-\*-x86_64\.AppImage\.zsync"\. The AppImage would not be updatable\./,
		);
		assert.equal(ranZsyncmake, false);
		assert.equal(
			statSync(`${appImage}.zsync`, { throwIfNoEntry: false }),
			undefined,
		);
	}));

test("finalize refuses a dist that does not hold exactly one AppImage", async () =>
	withRoot(async (root) => {
		const empty = join(root, "empty");
		mkdirSync(empty);
		await assert.rejects(
			() => finalize({ dist: empty, log: () => {} }),
			/Expected exactly one \*\.AppImage under .*found 0/,
		);
		const { dist } = stageDist(root);
		writeFileSync(join(dist, "second.AppImage"), "another");
		await assert.rejects(
			() => finalize({ dist, log: () => {} }),
			/Expected exactly one \*\.AppImage under .*found 2: local-operator-ui-0\.31\.5-x86_64\.AppImage, second\.AppImage\./,
		);
	}));

test("finalize refuses a feed whose entry describes different bytes", async () =>
	withRoot(async (root) => {
		const { dist } = stageDist(root, {
			yml: (appImage) =>
				latestLinuxYml(appImage).replace(
					/ {4}sha512: .*/,
					`    sha512: ${"A".repeat(88)}`,
				),
		});
		await assert.rejects(
			() => finalize({ dist, log: () => {}, runZsyncmake: stubZsyncmake }),
			/describes different bytes than the artifact \(yml sha512 A+/,
		);
	}));

/* ---- the read-only mode through the real CLI ----------------------------- */

test("read mode prints .upd_info and its verdict through the real CLI", () =>
	withRoot((root) => {
		const file = join(root, "runtime-x64");
		writeFileSync(file, buildElf());
		embedUpdateInfo(file);
		const ok = spawnSync(process.execPath, [SCRIPT, "read", "--file", file], {
			encoding: "utf8",
		});
		assert.equal(ok.status, 0, ok.stderr);
		assert.match(ok.stdout, /^\.upd_info: gh-releases-zsync\|/m);
		assert.match(
			ok.stdout,
			/^OK: carries the expected update information \(section offset 0x1000, 1024 bytes\)\./m,
		);

		const empty = join(root, "unpatched-runtime");
		writeFileSync(empty, buildElf());
		const refused = spawnSync(
			process.execPath,
			[SCRIPT, "read", "--file", empty],
			{
				encoding: "utf8",
			},
		);
		assert.equal(refused.status, 1);
		assert.match(refused.stdout, /^\.upd_info: <empty>$/m);
		assert.match(refused.stderr, /expected "gh-releases-zsync\|/);
	}));
