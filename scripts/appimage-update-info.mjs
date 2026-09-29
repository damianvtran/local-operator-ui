#!/usr/bin/env node
/**
 * Give every Linux AppImage this repository releases the two things
 * AppImageUpdate (and AppImageLauncher, and anything else that understands the
 * AppImage update specification) needs: update information embedded in the
 * AppImage itself, and the `.zsync` published next to it.
 *
 * WHY THIS EXISTS. The AppImage catalog bot tested the v0.31.5 AppImage on
 * AppImage/appimage.github.io#4905 and reported: "The AppImage contains no
 * update information, so users cannot update it with AppImageUpdate or similar
 * tools. Please consider embedding it when building the AppImage (e.g.,
 * appimagetool -u) and publishing the .zsync file next to the AppImage."
 * Electron-builder does neither for its legacy FUSE2 AppImages, so this script
 * does both, in the two halves of the build.
 *
 * WHY THE TOOLSET IS PATCHED AND NOT THE BUILT APPIMAGE. Electron-builder
 * appends an embedded blockmap to every AppImage and writes `latest-linux.yml`
 * (sha512, size, blockMapSize) from the bytes as they exist after that append -
 * `buildBlockMap`'s returned sha512 is "the SHA-512 of the full file as it
 * exists after the call" - and electron-updater consumes both. Any edit of the
 * finished AppImage (an in-place section write, an appimagetool repack) either
 * invalidates the embedded blockmap or the yml, so the metadata would describe
 * bytes nobody downloads. This script instead rewrites the update information
 * into the AppImage RUNTIME BINARY inside the toolset electron-builder builds
 * from, BEFORE the build: `buildLegacyFuse2AppImage` reads that file and
 * prepends it verbatim (a `readFile` plus a write at offset 0), so everything
 * electron-builder computes afterwards describes the final file and every
 * artifact stays self-consistent by construction.
 *
 * WHERE THE TOOLSET COMES FROM, AND WHY THE PIN IS THIS ONE. Electron-builder
 * 26.16.1 resolves its AppImage toolset through
 * `builder-util`'s `resolveEnvToolsetPath("APPIMAGE_TOOLS_PATH", "directory")`;
 * with `toolsets` unset it uses the legacy FUSE2 layout, existence-checking
 * every path it returns - `linux-x64/mksquashfs`, `linux-x64/desktop-file-validate`,
 * `runtime-x64` and `lib/x64` (verified in
 * `app-builder-lib@26.16.1/out/toolsets/linux.js`, `getFuse2Paths`). The archive
 * pinned below is the exact artifact app-builder-lib 26.16.1 fetches for itself
 * (`appimageChecksums["0.0.0"]` names `appimage-12.0.1.7z` with this sha256), so
 * the download this script verifies is the toolset the build would have used
 * anyway. Verifying the sha256 matters because the URL is a release asset:
 * without it, whatever the URL answers with would be embedded into every
 * AppImage the release ships.
 *
 * WHY THE .upd_info BYTES ARE THIS STRING. `gh-releases-zsync|<owner>|<repo>|
 * <tag>|<file pattern>` is the format appimagetool writes for `-u` (byte-for-byte
 * reference in the review probes: the official reference AppImage's section read
 * back `gh-releases-zsync|damianvtran|local-operator-ui|latest|...`), and it is
 * what AppImageUpdate parses out of the section to assemble the release asset
 * URL. The pattern has to match the `.zsync` this script's `finalize` writes, or
 * AppImageUpdate answers "None of the artifacts matched the pattern".
 *
 * WHY `zsyncmake -u` IS PASSED EXPLICITLY. zsyncmake copies the argument it was
 * given into the zsync's `URL:` header, so an absolute path leaks the builder's
 * filesystem into the published file (`URL: /work/sim.AppImage`, measured). The
 * convention the go-appimage toolset's own published zsyncs follow is the bare
 * filename, so `-u <basename>` makes the headers deterministic from any working
 * directory.
 *
 * WHAT WAS REJECTED, so a future reader does not have to re-derive it.
 * appimagetool's in-place edit: both the Rust and Go builds refuse an existing
 * image - "To be implemented", or a usage error - verified against
 * `appimagetool-rs` (continuous, 2025-12-04) and `appimagetool-go`; extract and
 * repack: loses the embedded blockmap, needs `latest-linux.yml` rewritten by
 * hand and reflows the squashfs, so it is heavier AND a second source of truth;
 * a post-build byte edit: the invalidation described above; upstreaming the
 * feature: out of this repository's scope.
 *
 * The offset facts measured on the pinned runtime-x64, for readers comparing
 * against a hexdump: `.upd_info` sits at file offset 0x02ae68 (175720) with a
 * size of 0x400 (1024) bytes, right after `.digest_md5`, and the squashfs magic
 * (`hsqs`) begins at byte 188392, the runtime's own length. The code below
 * finds the section by NAME through the ELF section header table rather than
 * trusting those constants, so a toolset bump that moved the section would be
 * handled, not silently mis-written.
 *
 * WHAT THIS SCRIPT DOES NOT DO. It does not touch the built AppImage's bytes;
 * it does not check signatures; it does not verify the release on GitHub - the
 * closing check for a published release is `appimageupdatetool -d <file>`
 * assembling the download URL, which can only be done once the `.zsync` is
 * attached to a release.
 *
 * Usage:
 *   node scripts/appimage-update-info.mjs prepare-toolset --dir <path> [--archive <path>]
 *   node scripts/appimage-update-info.mjs finalize --dist <dir>
 *   node scripts/appimage-update-info.mjs read --file <path>
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	closeSync,
	createReadStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	readSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { isEntryPoint } from "./entry-point.mjs";

/**
 * The update information embedded in every Linux AppImage.
 *
 * One exported constant because three consumers have to agree on the exact
 * bytes: the toolset patch a build embeds, the assertion `finalize` runs over
 * the built AppImage, and `read` - which prints what a file says and refuses
 * when it is not this. A second spelling of the string anywhere is a release
 * where AppImageUpdate resolves a name no asset carries.
 */
export const APPIMAGE_UPDATE_INFO =
	"gh-releases-zsync|damianvtran|local-operator-ui|latest|local-operator-ui-*-x86_64.AppImage.zsync";

/**
 * The pinned toolset archive, verified before it is unpacked.
 *
 * The sha256 is app-builder-lib 26.16.1's own pin for `appimage@0.0.0`
 * (`out/toolsets/linux.js`, `appimageChecksums["0.0.0"]`), copied here rather
 * than read from the installed package so this script also works from a
 * checkout without `node_modules`, and so a future electron-builder bump that
 * changes the toolset shows up as a diff here instead of silently riding along.
 * The drift is not left to hope: `appimage-update-info.test.mjs` reads the
 * INSTALLED package's own `appimageChecksums["0.0.0"]` and fails when it
 * disagrees with this copy, so the diff is forced at bump time.
 */
export const TOOLSET_ARCHIVE = {
	filename: "appimage-12.0.1.7z",
	url: "https://github.com/electron-userland/electron-builder-binaries/releases/download/appimage-12.0.1/appimage-12.0.1.7z",
	sha256: "d12ff7eb8f1d1ec4652ca5237a7fbdca33acc0c758045636feca62dc6ecb8ec4",
};

/**
 * The toolset paths electron-builder's FUSE2 resolver existence-checks
 * (`getFuse2Paths`, pinned version above).
 *
 * Mirrored here so a toolset that would fail the build fails THIS step instead,
 * with the missing names, rather than minutes later inside electron-builder
 * with a bare "not found at path".
 */
const TOOLSET_ENTRIES = [
	"linux-x64/mksquashfs",
	"linux-x64/desktop-file-validate",
	"runtime-x64",
	"lib/x64",
];

/** How much of a `.zsync` is read for its header block. The header is a few
 * hundred bytes of ASCII; 8 KiB is a comfortable single read that never needs
 * a second pass into the binary payload. */
const ZSYNC_HEADER_READ = 8192;

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]); // "\x7fELF"

/**
 * `readSync` over an exact window, with the failure modes named.
 *
 * A short read is refused rather than zero-filled: on an AppImage built from
 * the wrong tree it would otherwise look like a section of holes, and "the
 * file is shorter than its own headers claim" is the sentence an operator
 * needs. `openSync` failures are wrapped so a missing path does not surface as
 * a bare errno.
 */
function readBytes(filePath, position, length) {
	let fd;
	try {
		fd = openSync(filePath, "r");
	} catch (error) {
		throw new Error(`Cannot read ${filePath}: ${error.code ?? error.message}`);
	}
	try {
		const buffer = Buffer.alloc(length);
		const read = readSync(fd, buffer, 0, length, position);
		if (read !== length)
			throw new Error(
				`${filePath} is shorter than its ELF headers claim: wanted ${length} bytes at offset ${position}, read ${read}`,
			);
		return buffer;
	} finally {
		closeSync(fd);
	}
}

/** The NUL-terminated string at `start` in a string table. */
function readCString(buffer, start) {
	if (start >= buffer.length)
		throw new Error(
			`Malformed ELF section name table: a name offset (${start}) is past the table (${buffer.length} bytes)`,
		);
	const end = buffer.indexOf(0, start);
	if (end === -1)
		throw new Error("Malformed ELF section name table: unterminated name");
	return buffer.subarray(start, end).toString("utf8");
}

/**
 * What `filePath` says in its `.upd_info` section.
 *
 * Returns `{ section, value }`: `section` is `{ offset, size }` or null when
 * the file carries no `.upd_info`, and `value` is the section's content up to
 * its first NUL ("" when the section exists but is empty - the shape the
 * v0.31.5 release shipped, and the one `finalize` must refuse).
 *
 * Only 64-bit little-endian ELF is parsed, and extended section numbering
 * (e_shnum == 0, e_shstrndx == SHN_XINDEX) is refused with its own message:
 * both are cases where a lenient parser would silently read the wrong offsets,
 * and the only files this script ever reads for real are the pinned x86-64
 * runtime and AppImages built from it. `e_shstrndx == SHN_UNDEF` is refused by
 * name too (review round 1, R2): falling through would use section 0 - the
 * reserved null entry - as the name table and report a malformed table, which
 * names the wrong cause. Anything outside that gets a loud refusal rather than
 * a guess.
 */
export function readUpdateInfo(filePath) {
	const header = readBytes(filePath, 0, 64);
	if (!header.subarray(0, 4).equals(ELF_MAGIC))
		throw new Error(
			`${filePath} is not an ELF file (magic ${header.subarray(0, 4).toString("hex")}); expected an AppImage or an AppImage runtime`,
		);
	if (header[4] !== 2 || header[5] !== 1)
		throw new Error(
			`${filePath} is not a 64-bit little-endian ELF (EI_CLASS=${header[4]}, EI_DATA=${header[5]}); this reader supports exactly the x86-64 AppImage runtime`,
		);
	const sectionHeaderOffset = Number(header.readBigUInt64LE(0x28));
	const sectionHeaderSize = header.readUInt16LE(0x3a);
	const sectionCount = header.readUInt16LE(0x3c);
	const namesIndex = header.readUInt16LE(0x3e);
	if (sectionCount === 0 || namesIndex === 0xffff)
		throw new Error(
			`${filePath} uses extended ELF section numbering, which this reader refuses rather than guessing at`,
		);
	if (namesIndex === 0)
		throw new Error(
			`${filePath} carries no section name string table (e_shstrndx = SHN_UNDEF), so its section names cannot be read; this reader refuses rather than reading the reserved null entry as a table`,
		);
	if (sectionHeaderSize !== 64)
		throw new Error(
			`${filePath} has an unexpected ELF section header size (${sectionHeaderSize}); expected 64 for ELF64`,
		);
	const table = readBytes(
		filePath,
		sectionHeaderOffset,
		sectionHeaderSize * sectionCount,
	);
	const sections = [];
	for (let index = 0; index < sectionCount; index++) {
		const at = index * sectionHeaderSize;
		sections.push({
			nameOffset: table.readUInt32LE(at),
			offset: Number(table.readBigUInt64LE(at + 0x18)),
			size: Number(table.readBigUInt64LE(at + 0x20)),
		});
	}
	const names = sections[namesIndex];
	if (!names)
		throw new Error(
			`${filePath} names a section header string table at index ${namesIndex}, which does not exist`,
		);
	const namesTable = readBytes(filePath, names.offset, names.size);
	for (const section of sections) {
		if (readCString(namesTable, section.nameOffset) !== ".upd_info") continue;
		const bytes = readBytes(filePath, section.offset, section.size);
		const end = bytes.indexOf(0);
		return {
			section: { offset: section.offset, size: section.size },
			value: bytes
				.subarray(0, end === -1 ? bytes.length : end)
				.toString("utf8"),
		};
	}
	return { section: null, value: null };
}

/**
 * Write `value` + NUL at the start of `runtimePath`'s `.upd_info` section and
 * read it back.
 *
 * A rewrite rather than a skip-when-equal, deliberately: running this twice is
 * required to be idempotent (the workflow step may be re-run on a cached
 * `$RUNNER_TEMP`), and write-then-verify is also what upgrades a tree that
 * carries an older string - the same call normalises either direction. The
 * readback is not ceremony: a truncated write or an offset that resolved into
 * the wrong section is exactly the failure this half exists to catch before a
 * 25-minute build starts.
 */
export function embedUpdateInfo(runtimePath, value = APPIMAGE_UPDATE_INFO) {
	const found = readUpdateInfo(runtimePath);
	if (!found.section)
		throw new Error(
			`${runtimePath} carries no .upd_info section: the toolset is not the pinned one, or it was repacked without one`,
		);
	const payload = Buffer.from(value, "utf8");
	if (payload.length + 1 > found.section.size)
		throw new Error(
			`${runtimePath}: .upd_info is ${found.section.size} bytes, too small for the update information (${payload.length} bytes + NUL)`,
		);
	const fd = openSync(runtimePath, "r+");
	try {
		const buffer = Buffer.concat([payload, Buffer.from([0])]);
		writeSync(fd, buffer, 0, buffer.length, found.section.offset);
	} finally {
		closeSync(fd);
	}
	const readback = readUpdateInfo(runtimePath);
	if (readback.value !== value)
		throw new Error(
			`${runtimePath}: readback after writing .upd_info did not match. Wrote ${JSON.stringify(value)}, read back ${JSON.stringify(readback.value)}`,
		);
	return { section: found.section, previous: found.value, value };
}

/** The toolset entries electron-builder will existence-check but that the tree
 * at `dir` does not carry. */
function missingToolsetEntries(dir) {
	return TOOLSET_ENTRIES.filter((entry) => !existsSync(join(dir, entry)));
}

/** `sha256` of a small buffer, as hex. */
function sha256Hex(buffer) {
	return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Verify a toolset archive's sha256 against the pin, refusing with both values
 * named.
 *
 * The check is the same for a download and for `--archive`: the bytes decide
 * what gets embedded into every AppImage, so "this copy came from somewhere
 * else" is not a reason to trust it any further than the URL is. A copy that
 * fails here has been corrupted or replaced, and the refusal says which bytes
 * it saw.
 */
function verifyPinnedArchive(bytes, source) {
	const digest = sha256Hex(bytes);
	if (digest !== TOOLSET_ARCHIVE.sha256)
		throw new Error(
			`Refusing the toolset archive at ${source}: sha256 ${digest}, expected ${TOOLSET_ARCHIVE.sha256} (the pin app-builder-lib 26.16.1 declares for ${TOOLSET_ARCHIVE.filename}). The embedded update information would otherwise be baked into every AppImage from unverified bytes.`,
		);
	return digest;
}

/**
 * Download the pinned archive into `destination` and verify its sha256.
 *
 * `fetch` is a Node builtin (the workflows run Node 22.13.1), so this stays
 * dependency-free; the archive is small (1.5 MB) and buffered. The timeout
 * exists for the same reason every bounded child in this repository has one: a
 * connection that never answers must become a failed step, not a job that hangs
 * until the runner gives up on it.
 */
async function downloadPinnedArchive(destination) {
	let response;
	try {
		response = await fetch(TOOLSET_ARCHIVE.url, {
			signal: AbortSignal.timeout(120_000),
		});
	} catch (error) {
		throw new Error(
			`Cannot download the AppImage toolset: ${TOOLSET_ARCHIVE.url} (${error.cause?.message ?? error.message})`,
		);
	}
	if (!response.ok)
		throw new Error(
			`Cannot download the AppImage toolset: ${TOOLSET_ARCHIVE.url} answered HTTP ${response.status} ${response.statusText}`,
		);
	const bytes = Buffer.from(await response.arrayBuffer());
	writeFileSync(destination, bytes);
	return verifyPinnedArchive(bytes, TOOLSET_ARCHIVE.url);
}

/** Unpack a toolset archive with the system `7z`, or refuse with the install
 * hint rather than an ENOENT. */
function unpackArchive(archivePath, directory) {
	const result = spawnSync("7z", ["x", "-y", `-o${directory}`, archivePath], {
		encoding: "utf8",
	});
	if (result.error?.code === "ENOENT")
		throw new Error(
			"7z is not on PATH: install it (Ubuntu: apt-get install p7zip-full) to unpack the AppImage toolset",
		);
	if (result.status !== 0)
		throw new Error(
			`7z failed (exit ${result.status}) unpacking ${archivePath}: ${tail(result.stderr || result.stdout)}`,
		);
}

/** The last few lines of a child's output, for error messages that name what
 * actually went wrong instead of swallowing a wall of progress lines. */
function tail(text, lines = 3) {
	const trimmed = String(text ?? "").trim();
	if (trimmed === "") return "(no output)";
	return trimmed.split("\n").slice(-lines).join(" | ");
}

/**
 * Prepare the toolset a Linux build packages from, so that the runtime it
 * prepends already carries the update information.
 *
 * Two shapes, one outcome:
 *  - `dir` is missing or empty: obtain the toolset - the pinned download, or a
 *    local archive via `--archive` (offline re-runs and tests) - verify the
 *    download against the pin, unpack with `7z`, then patch.
 *  - `dir` already holds an unpacked toolset: patch it in place. This is what
 *    makes the step idempotent, and it is the injection point tests use.
 *
 * A non-empty directory that is NOT a toolset is refused rather than
 * overwritten or downloaded into: it is somebody's tree, and deleting it is not
 * this script's decision.
 */
export async function prepareToolset({
	dir,
	archive = null,
	log = console.log,
}) {
	const target = resolve(dir);
	const runtimePath = join(target, "runtime-x64");
	let staging = null;
	let source;
	try {
		const existing = existsSync(target) ? readdirSync(target) : [];
		if (existing.length > 0) {
			const missing = missingToolsetEntries(target);
			if (missing.length > 0)
				throw new Error(
					`${target} is not an unpacked AppImage toolset (missing ${missing.join(", ")}). Remove it to re-download, or point --dir at a fresh path.`,
				);
			source = `${target} (already unpacked)`;
		} else {
			mkdirSync(target, { recursive: true });
			let archivePath;
			if (archive != null) {
				archivePath = resolve(archive);
				if (!existsSync(archivePath))
					throw new Error(`--archive ${archivePath} does not exist`);
				source = archivePath;
				const digest = verifyPinnedArchive(
					readFileSync(archivePath),
					archivePath,
				);
				log(
					`appimage-update-info: local archive ${archivePath} (sha256 ${digest} matches the app-builder-lib pin)`,
				);
			} else {
				staging = mkdtempSync(join(tmpdir(), "appimage-toolset-"));
				archivePath = join(staging, TOOLSET_ARCHIVE.filename);
				source = TOOLSET_ARCHIVE.url;
				const digest = await downloadPinnedArchive(archivePath);
				log(
					`appimage-update-info: downloaded ${TOOLSET_ARCHIVE.url} (sha256 ${digest} matches the app-builder-lib pin)`,
				);
			}
			unpackArchive(archivePath, target);
			const missing = missingToolsetEntries(target);
			if (missing.length > 0)
				throw new Error(
					`The toolset archive unpacked a tree electron-builder would refuse: missing ${missing.join(", ")} under ${target}`,
				);
		}
		const patched = embedUpdateInfo(runtimePath);
		log(`appimage-update-info: toolset source: ${source}`);
		log(
			`appimage-update-info: ${runtimePath} .upd_info written at offset 0x${patched.section.offset.toString(16)} (section ${patched.section.size} bytes, previously ${patched.previous === "" ? "<empty>" : JSON.stringify(patched.previous)})`,
		);
		log(`appimage-update-info: readback OK: ${patched.value}`);
		log(
			"OK: the AppImage toolset is prepared; electron-builder prepends this runtime verbatim, so every AppImage built from it carries the update information.",
		);
		return { dir: target, runtimePath, section: patched.section };
	} finally {
		if (staging) rmSync(staging, { recursive: true, force: true });
	}
}

/** Parse the leading `key: value` header block of a `.zsync`.
 *
 * The file is ASCII headers followed by a binary payload; this reads the first
 * few KiB once and stops at the first line that is not a header. */
export function parseZsyncHeaders(zsyncPath) {
	const head = readBytes(
		zsyncPath,
		0,
		Math.min(statSync(zsyncPath).size, ZSYNC_HEADER_READ),
	);
	const headers = {};
	for (const line of head.toString("latin1").split("\n")) {
		const match = /^([A-Za-z0-9-]+): (.*)$/.exec(line.replace(/\r$/, ""));
		if (!match) break;
		headers[match[1]] = match[2];
	}
	return headers;
}

/**
 * Assert a `.zsync`'s headers describe the artifact it is published beside.
 *
 * All four checks catch a different published-release failure: `Filename`
 * wrong means AppImageUpdate resolves an asset name nobody attached; `Length`
 * or `SHA-1` wrong means a client refusing bytes zsync verified green against
 * the wrong file; `URL` naming anything but the basename is the absolute-path
 * leak from zsyncmake's argument (see the header), which resolves against
 * whatever directory the client happens to be in.
 */
export function assertZsyncHeaders({ zsyncPath, name, size, sha1 }) {
	if (!existsSync(zsyncPath))
		throw new Error(
			`zsyncmake did not produce ${zsyncPath}; nothing to publish beside ${name}`,
		);
	const headers = parseZsyncHeaders(zsyncPath);
	const expectations = [
		["Filename", name, false],
		["Length", String(size), false],
		["SHA-1", sha1, true],
		["URL", name, false],
	];
	for (const [key, expected, caseInsensitive] of expectations) {
		const actual = headers[key];
		if (actual === undefined)
			throw new Error(
				`${zsyncPath} carries no ${key} header; expected ${key}: ${expected}`,
			);
		const matches = caseInsensitive
			? actual.toLowerCase() === expected.toLowerCase()
			: actual === expected;
		if (!matches)
			throw new Error(
				`${zsyncPath}: ${key} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
			);
	}
	return headers;
}

/**
 * The `files:` entry for `name` in an electron-builder update feed.
 *
 * A targeted line scan, the same shape `scripts/notarize-artifacts.mjs` uses
 * for its rewrite: the file is YAML that electron-builder wrote and
 * electron-updater reads, and a parse-and-re-dump here would be a second
 * opinion about a file whose bytes this script does not own. Returns
 * `{ matched, sha512, size }` - `matched` without both keys says the entry is
 * there but the keys drifted, which is a different failure from "not listed".
 */
export function latestYmlEntry(ymlText, name) {
	const lines = ymlText.split("\n");
	const entryIndex = lines.findIndex((line) => {
		const match = /^\s*- url:\s*(.+?)\s*$/.exec(line);
		return match != null && unquote(match[1]) === name;
	});
	if (entryIndex === -1) return { matched: false, sha512: null, size: null };
	let sha512 = null;
	let size = null;
	for (let index = entryIndex + 1; index < lines.length; index++) {
		const line = lines[index];
		// The entry ends at the next file or at the first unindented key.
		if (/^\s*- url:/.test(line) || /^[^ \t-]/.test(line)) break;
		const shasum = /^\s*sha512:\s*(.+?)\s*$/.exec(line);
		if (shasum) {
			sha512 = unquote(shasum[1]);
			continue;
		}
		const bytes = /^\s*size:\s*["']?(\d+)["']?\s*$/.exec(line);
		if (bytes) size = Number(bytes[1]);
	}
	return { matched: true, sha512, size };
}

/** A scalar with optional surrounding YAML quotes removed. */
function unquote(value) {
	const match = /^(["'])(.*)\1$/.exec(value);
	return match ? match[2] : value;
}

/** One hash of a file, as a Buffer, streamed so the 158 MB AppImage is never
 * held in memory. */
function hashFile(filePath, algorithm) {
	return new Promise((resolvePromise, reject) => {
		const hash = createHash(algorithm);
		const stream = createReadStream(filePath);
		stream.on("error", reject);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("end", () => resolvePromise(hash.digest()));
	});
}

/** `zsyncmake` as the build runs it: bare-filename `URL`, output beside the
 * AppImage. See the header for why `-u` is explicit. */
function zsyncmake(appImage, zsyncPath) {
	const result = spawnSync(
		"zsyncmake",
		["-u", basename(appImage), "-o", zsyncPath, appImage],
		{ encoding: "utf8" },
	);
	if (result.error?.code === "ENOENT")
		throw new Error(
			"zsyncmake is not on PATH: install it (Ubuntu: apt-get install zsync) to publish the AppImage's .zsync",
		);
	if (result.status !== 0)
		throw new Error(
			`zsyncmake failed (exit ${result.status}) for ${appImage}: ${tail(result.stderr || result.stdout)}`,
		);
}

/**
 * Write the `.zsync` for a built AppImage and assert the whole chain.
 *
 * Runs after electron-builder, after the packaged-closure check, and before
 * the artifacts are uploaded - so a release either carries an updatable
 * AppImage or fails the build:
 *  a. the AppImage's `.upd_info` is the expected string (it was built from the
 *     prepared toolset);
 *  b. `zsyncmake` writes `<file>.AppImage.zsync` next to it;
 *  c. the zsync's `Filename`, `Length`, `SHA-1` and `URL` describe the file
 *     that will be attached;
 *  d. `latest-linux.yml`'s entry for the AppImage carries the sha512 and size
 *     of those same bytes - the hash electron-updater verifies downloads
 *     against.
 *
 * `runZsyncmake` is injectable for tests; the build uses the real binary.
 */
export async function finalize({
	dist,
	log = console.log,
	runZsyncmake = zsyncmake,
}) {
	const distDir = resolve(dist);
	if (!existsSync(distDir)) throw new Error(`--dist ${distDir} does not exist`);
	const images = readdirSync(distDir)
		.filter((name) => name.endsWith(".AppImage"))
		.sort();
	if (images.length !== 1)
		throw new Error(
			`Expected exactly one *.AppImage under ${distDir}, found ${images.length}${images.length > 0 ? `: ${images.join(", ")}` : ""}. This step asserts the artifact the build produced; it cannot pass on a set it did not check.`,
		);
	const name = images[0];
	const appImage = join(distDir, name);

	// (a) The update information, out of the built bytes.
	const { section, value } = readUpdateInfo(appImage);
	if (!section)
		throw new Error(
			`${appImage} carries no .upd_info section: it was not built from the prepared toolset. Check the prepare-toolset step and APPIMAGE_TOOLS_PATH in .github/workflows/publish.yml.`,
		);
	if (value !== APPIMAGE_UPDATE_INFO)
		throw new Error(
			`${appImage}: .upd_info is ${value === "" ? "<empty>" : JSON.stringify(value)}, expected ${JSON.stringify(APPIMAGE_UPDATE_INFO)}. The AppImage would not be updatable.`,
		);
	log(
		`appimage-update-info: .upd_info OK (offset 0x${section.offset.toString(16)}, ${section.size} bytes)`,
	);

	// (b) The zsync, from the exact file that ships.
	const zsyncPath = `${appImage}.zsync`;
	runZsyncmake(appImage, zsyncPath);
	const zsyncSize = statSync(zsyncPath).size;
	if (zsyncSize === 0) throw new Error(`zsyncmake wrote an empty ${zsyncPath}`);
	log(`appimage-update-info: wrote ${zsyncPath} (${zsyncSize} bytes)`);

	// (c) The zsync's headers, against the real file.
	const size = statSync(appImage).size;
	const sha1 = (await hashFile(appImage, "sha1")).toString("hex");
	assertZsyncHeaders({ zsyncPath, name, size, sha1 });
	log(
		`appimage-update-info: zsync headers match the artifact (Filename ${name}, Length ${size}, SHA-1, URL)`,
	);

	// (d) The update feed's entry, against the same bytes.
	const sha512 = (await hashFile(appImage, "sha512")).toString("base64");
	const ymlPath = join(distDir, "latest-linux.yml");
	let ymlText;
	try {
		ymlText = readFileSync(ymlPath, "utf8");
	} catch {
		throw new Error(
			`${ymlPath} was not found: electron-builder writes it beside the AppImage, and electron-updater fetches it before it can offer anything`,
		);
	}
	const entry = latestYmlEntry(ymlText, name);
	if (!entry.matched)
		throw new Error(
			`${ymlPath} lists no entry for ${name}; the feed would offer Linux users nothing to download`,
		);
	if (entry.sha512 === null || entry.size === null)
		throw new Error(
			`${ymlPath}: the entry for ${name} is missing its sha512/size lines, so the feed describes no bytes`,
		);
	if (entry.sha512 !== sha512 || entry.size !== size)
		throw new Error(
			`${ymlPath}: the entry for ${name} describes different bytes than the artifact (yml sha512 ${entry.sha512}, actual ${sha512}; yml size ${entry.size}, actual ${size})`,
		);
	log(
		`appimage-update-info: latest-linux.yml entry matches the built bytes (sha512, size ${size})`,
	);
	log(`OK: ${name} carries the update information and ships with its .zsync.`);
	return { appImage, zsyncPath };
}

/** Print what a file's `.upd_info` says, and refuse when it is not the
 * expected string - the read-only mode tests and QA drive. */
function readMode({ file, log = console.log }) {
	const target = resolve(file);
	const { section, value } = readUpdateInfo(target);
	if (!section)
		throw new Error(
			`${target} carries no .upd_info section; it has no update information to read`,
		);
	log(`appimage-update-info: ${target}`);
	log(`.upd_info: ${value === "" ? "<empty>" : value}`);
	if (value !== APPIMAGE_UPDATE_INFO)
		throw new Error(
			`${target}: .upd_info is ${value === "" ? "<empty>" : JSON.stringify(value)}, expected ${JSON.stringify(APPIMAGE_UPDATE_INFO)}`,
		);
	log(
		`OK: carries the expected update information (section offset 0x${section.offset.toString(16)}, ${section.size} bytes).`,
	);
	return 0;
}

const USAGE = [
	"usage: node scripts/appimage-update-info.mjs prepare-toolset --dir <path> [--archive <path>]",
	"       node scripts/appimage-update-info.mjs finalize --dist <dir>",
	"       node scripts/appimage-update-info.mjs read --file <path>",
].join("\n");

function parseFlags(argv) {
	const known = new Set(["--dir", "--archive", "--dist", "--file"]);
	const flags = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (!known.has(flag) || value === undefined)
			throw new Error(
				`appimage-update-info: unknown or incomplete argument ${JSON.stringify(flag ?? "")}.\n${USAGE}`,
			);
		flags.set(flag, value);
	}
	return flags;
}

async function main(argv) {
	const [command, ...rest] = argv;
	const flags = parseFlags(rest);
	switch (command) {
		case "prepare-toolset": {
			const dir = flags.get("--dir");
			if (dir === undefined)
				throw new Error(
					`appimage-update-info: --dir <path> is required.\n${USAGE}`,
				);
			await prepareToolset({ dir, archive: flags.get("--archive") ?? null });
			return 0;
		}
		case "finalize": {
			const dist = flags.get("--dist");
			if (dist === undefined)
				throw new Error(
					`appimage-update-info: --dist <dir> is required.\n${USAGE}`,
				);
			await finalize({ dist });
			return 0;
		}
		case "read": {
			const file = flags.get("--file");
			if (file === undefined)
				throw new Error(
					`appimage-update-info: --file <path> is required.\n${USAGE}`,
				);
			return readMode({ file });
		}
		default:
			throw new Error(
				`appimage-update-info: unknown command ${JSON.stringify(command ?? "")}.\n${USAGE}`,
			);
	}
}

if (isEntryPoint(import.meta.url)) {
	main(process.argv.slice(2))
		.then((code) => {
			process.exitCode = code;
		})
		.catch((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}
