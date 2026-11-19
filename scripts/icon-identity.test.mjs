import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	readPlistString,
	setPlistString,
	stampBundleIcons,
} from "./after-pack.mjs";

/*
 * The identity a macOS dialog sees when it resolves this app's icon.
 *
 * Why this file exists, and why it asserts chunk ORDER rather than "the icon is
 * HD". The bundle already carried every representation from 16 to 1024 px -
 * `iconutil` proved that - and the 1Password CLI-access dialog still drew the
 * mark as a blur. Measured on 1Password 8.12.40 (2026-10-23): its own ICNS
 * reader takes the FIRST chunk in the file and draws it in the dialog's 128 px
 * slot. The file was written ascending, so the first chunk was the 16x16
 * `icp4`, and the dialog showed a smooth 8x enlargement of it. The same bytes
 * reordered with `ic10` (1024) first rendered sharp. macOS reads ICNS by chunk
 * type, so the order is invisible to AppKit and `iconutil` - which is exactly
 * why a future regeneration would restore the old order without any local test
 * or screenshot noticing until a dialog on someone else's screen looked wrong.
 *
 * The helper cases are the other half of "every path that can be attributed":
 * Electron's helper bundles ship with no `CFBundleIconFile` and no icon, so a
 * dialog that resolves a helper has only the generic placeholder to draw.
 * `stampBundleIcons` is exercised against real directories here; the end-to-end
 * proof that electron-builder runs this hook before signing is a packed
 * `--dir` build on the PR, not a unit test.
 */

const REPO = process.cwd();
const ICON_PLIST_ENTRY =
	/<key>CFBundleIconFile<\/key>\s*<string>icon\.icns<\/string>/;
const BUILD_ICON_ERROR = /build\.mac\.icon/;

/** Every chunk in an ICNS, in the order the file carries them. */
function parseIcns(buffer) {
	assert.equal(buffer.subarray(0, 4).toString("latin1"), "icns");
	assert.equal(buffer.readUInt32BE(4), buffer.length);
	const chunks = [];
	let offset = 8;
	while (offset < buffer.length) {
		const type = buffer.subarray(offset, offset + 4).toString("latin1");
		const length = buffer.readUInt32BE(offset + 4);
		assert.ok(length >= 8, `chunk ${type} has length ${length}`);
		chunks.push({
			type,
			length,
			body: buffer.subarray(offset + 8, offset + length),
		});
		offset += length;
	}
	assert.equal(
		offset,
		buffer.length,
		"ICNS chunks do not tile the file exactly",
	);
	return chunks;
}

/** The pixel width of a PNG's IHDR, without a decoder dependency. */
function pngWidth(buffer) {
	assert.equal(buffer.subarray(1, 4).toString("latin1"), "PNG");
	return buffer.readUInt32BE(16);
}

const tempDirs = [];
function tempDir(prefix) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

after(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

test("the shipped icns leads with the largest representation and keeps every size", () => {
	const chunks = parseIcns(readFileSync(join(REPO, "build/icon.icns")));
	const sizes = chunks.map((chunk) => pngWidth(chunk.body));

	assert.deepEqual(
		sizes,
		[1024, 512, 256, 128, 64, 32, 16],
		"build/icon.icns must be written largest-first: 1Password's reader draws the first chunk in a 128 px slot, so a 16-first file is an 8x blur on its CLI-access dialog",
	);
	assert.equal(chunks[0].type, "ic10");
	assert.deepEqual(
		chunks.map((chunk) => chunk.type),
		["ic10", "ic09", "ic08", "ic07", "icp6", "icp5", "icp4"],
	);
});

test("the build names the icns explicitly instead of relying on the electron-builder default", () => {
	const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
	assert.equal(pkg.build.mac.icon, "build/icon.icns");
});

test("the development runtime's dock icon is the 1024 px master", () => {
	// `src/main/index.ts` sets the Dock tile from this asset in every
	// non-headless launch, which is the one identity an unpackaged run can
	// present: it has no bundle of ours for macOS or 1Password to resolve.
	const width = pngWidth(readFileSync(join(REPO, "resources/icon.png")));
	assert.equal(width, 1024);
});

test("every nested helper bundle is stamped with the app's icon", () => {
	const out = tempDir("lop-icon-afterpack-");
	const app = join(out, "Local Operator.app");
	const resources = join(app, "Contents", "Resources");
	const frameworks = join(app, "Contents", "Frameworks");
	mkdirSync(resources, { recursive: true });
	mkdirSync(frameworks, { recursive: true });
	const mainIcon = Buffer.from("main app icon bytes");
	writeFileSync(join(resources, "icon.icns"), mainIcon);
	writeFileSync(
		join(app, "Contents", "Info.plist"),
		plist("<key>CFBundleIconFile</key><string>icon.icns</string>"),
	);

	const noIcon = join(frameworks, "Local Operator Helper.app");
	const staleIcon = join(frameworks, "Local Operator Helper (Renderer).app");
	for (const bundle of [noIcon, staleIcon]) {
		mkdirSync(join(bundle, "Contents", "Resources"), { recursive: true });
	}
	writeFileSync(
		join(noIcon, "Contents", "Info.plist"),
		plist("<key>CFBundleName</key><string>Electron Helper</string>"),
	);
	writeFileSync(
		join(staleIcon, "Contents", "Info.plist"),
		plist(
			"<key>CFBundleName</key><string>Electron Helper (Renderer)</string><key>CFBundleIconFile</key><string>electron.icns</string>",
		),
	);
	// A file inside Frameworks that is not a bundle must be left alone.
	writeFileSync(join(frameworks, "notes.txt"), "not a bundle");

	const result = stampBundleIcons({
		appOutDir: out,
		productFilename: "Local Operator",
		platform: "darwin",
	});

	assert.deepEqual(result.stamped.sort(), [
		"Local Operator Helper (Renderer).app",
		"Local Operator Helper.app",
	]);
	for (const bundle of [noIcon, staleIcon]) {
		assert.deepEqual(
			readFileSync(join(bundle, "Contents", "Resources", "icon.icns")),
			mainIcon,
		);
		const plistText = readFileSync(
			join(bundle, "Contents", "Info.plist"),
			"utf8",
		);
		assert.match(plistText, ICON_PLIST_ENTRY);
		assert.equal(
			plistText.match(/<key>CFBundleIconFile<\/key>/g)?.length,
			1,
			"a stale CFBundleIconFile must be replaced, not duplicated",
		);
	}
	assert.ok(!existsSync(join(frameworks, "notes.txt", "Contents")));
});

test("the stamping refuses a bundle whose main icon is not the one it copies", () => {
	const out = tempDir("lop-icon-afterpack-bad-");
	const app = join(out, "Local Operator.app");
	mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
	writeFileSync(
		join(app, "Contents", "Info.plist"),
		plist("<key>CFBundleIconFile</key><string>icon.icns</string>"),
	);
	assert.throws(
		() =>
			stampBundleIcons({
				appOutDir: out,
				productFilename: "Local Operator",
				platform: "darwin",
			}),
		BUILD_ICON_ERROR,
	);
});

test("a plist value is written literally, including a dollar sign", () => {
	// `String.prototype.replace` treats `$&`, `$\`` and friends in a replacement
	// STRING as tokens. A function replacer keeps the value literal, so an icon
	// name that ever contains `$` cannot corrupt the plist.
	const absent = setPlistString(
		plist("<key>CFBundleName</key><string>Electron Helper</string>"),
		"CFBundleIconFile",
		"icon$&.icns",
	);
	assert.equal(readPlistString(absent, "CFBundleIconFile"), "icon$&.icns");
	assert.match(absent, /<string>icon\$&amp;\.icns<\/string>/);

	const present = setPlistString(
		plist("<key>CFBundleIconFile</key><string>old.icns</string>"),
		"CFBundleIconFile",
		"a$`b.icns",
	);
	assert.equal(readPlistString(present, "CFBundleIconFile"), "a$`b.icns");
});

test("a binary plist is refused rather than silently left unstamped", () => {
	const out = tempDir("lop-icon-afterpack-binary-");
	const app = join(out, "Local Operator.app");
	mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
	mkdirSync(join(app, "Contents", "Frameworks"), { recursive: true });
	writeFileSync(join(app, "Contents", "Resources", "icon.icns"), "icon");
	writeFileSync(
		join(app, "Contents", "Info.plist"),
		"bplist00not-an-xml-plist",
	);
	assert.throws(
		() =>
			stampBundleIcons({
				appOutDir: out,
				productFilename: "Local Operator",
				platform: "darwin",
			}),
		/binary property list/,
	);
});

test("a bundle with no helper bundles is refused rather than reported clean", () => {
	const out = tempDir("lop-icon-afterpack-empty-");
	const app = join(out, "Local Operator.app");
	mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
	mkdirSync(join(app, "Contents", "Frameworks"), { recursive: true });
	writeFileSync(join(app, "Contents", "Resources", "icon.icns"), "icon");
	writeFileSync(
		join(app, "Contents", "Info.plist"),
		plist("<key>CFBundleIconFile</key><string>icon.icns</string>"),
	);
	assert.throws(
		() =>
			stampBundleIcons({
				appOutDir: out,
				productFilename: "Local Operator",
				platform: "darwin",
			}),
		/No nested helper/,
	);
});

test("non-macOS builds are left alone", () => {
	assert.deepEqual(
		stampBundleIcons({
			appOutDir: "/nonexistent",
			productFilename: "Local Operator",
			platform: "win32",
		}),
		{ stamped: [] },
	);
});

function plist(entries) {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>${entries}</dict></plist>
`;
}
