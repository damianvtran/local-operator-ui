import assert from "node:assert/strict";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { MACH_O_CPUTYPE, MACH_O_FILETYPE } from "./prune-python-seed.mjs";
import { nativeComponentsCheck } from "./verify-macos-artifacts.mjs";

/*
 * Coverage for the release gate's native-component check - the one that answers
 * the notice macOS 27 shows on launch:
 *
 *   "This version of "Local Operator" includes a component that will not open in
 *    macOS 28, the next major release."
 *
 * WHY THESE CASES EXIST, AND WHY THEY ARE THE WHOLE POINT. Every other check in
 * `verify-macos-artifacts.mjs` holds one NAMED thing to the bundle's
 * architecture: `bundleArchitectures` the Electron Framework,
 * `privatePythonSeedCheck` the seed directory's name, `bundledUvToolCheck` the
 * `uv`'s `lipo -archs`. A foreign-only component in any other shape - an x64
 * `.node`, a helper, a second interpreter tree under a name nobody enumerated -
 * passes all of them, and the gate's only symptom is a user's launch notice (and,
 * from macOS 28, an app that cannot open at all). So the assertion has to be
 * driven in BOTH directions over a bundle that really carries components: the
 * passing shape passes, and a real foreign-only component FAILS, rather than an
 * empty fixture "failing" for want of anything to look at.
 *
 * WHAT IS REAL: the shipped module, the shipped Mach-O reader, and real files on
 * a real filesystem. WHAT IS SUBSTITUTED: the Mach-O files are hand-written
 * headers - the reader reads headers and offsets, and a signed binary of the
 * right shape would exercise the same bytes - and `lipo` is a stub, because this
 * suite runs on CI's Linux runner. The real header of a real shipped bundle, read
 * by the real `lipo`, is what the PR's evidence block shows.
 */

const tempDirs = [];

function tempDir(prefix) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

after(() => {
	// Nothing here writes outside its own temp dir, so removal is a plain
	// recursive unlink; a failure to remove is not a test failure.
	for (const dir of tempDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// Ignore: the OS reclaims /tmp.
		}
	}
});

/** A thin Mach-O: the magic, the `cputype` word, a loadable filetype, padding. */
function writeThin(path, cpuType) {
	mkdirSync(dirname(path), { recursive: true });
	const header = Buffer.alloc(64);
	Buffer.from("cffaedfe", "hex").copy(header, 0);
	header.writeUInt32LE(cpuType, 4);
	header.writeUInt32LE(MACH_O_FILETYPE.MH_DYLIB, 12);
	writeFileSync(path, header);
	chmodSync(path, 0o644);
}

/**
 * A fat (universal) Mach-O: `nfat_arch` and one five-word `fat_arch` per slice.
 *
 * `cafebabe` is `FAT_MAGIC`, whose fields are big-endian; `bebafeca` is
 * `FAT_CIGAM`, the same header with little-endian fields. Both are exercised,
 * because a reader that assumes one endianness answers a plausible number for
 * the other file rather than failing.
 */
function writeFat(path, cpuTypes, { magic = "cafebabe" } = {}) {
	mkdirSync(dirname(path), { recursive: true });
	const bigEndian = magic === "cafebabe";
	const header = Buffer.alloc(8 + cpuTypes.length * 20);
	Buffer.from(magic, "hex").copy(header, 0);
	if (bigEndian) header.writeUInt32BE(cpuTypes.length, 4);
	else header.writeUInt32LE(cpuTypes.length, 4);
	cpuTypes.forEach((cpuType, index) => {
		const at = 8 + index * 20;
		if (bigEndian) header.writeUInt32BE(cpuType, at);
		else header.writeUInt32LE(cpuType, at);
	});
	writeFileSync(path, header);
	chmodSync(path, 0o644);
}

/** A file that starts with a Mach-O magic and stops before its header ends. */
function writeTruncated(path, { magic = "cffaedfe", length = 8 } = {}) {
	mkdirSync(dirname(path), { recursive: true });
	const bytes = Buffer.alloc(length);
	Buffer.from(magic, "hex").copy(bytes, 0);
	writeFileSync(path, bytes);
	chmodSync(path, 0o644);
}

/** `lipo -archs` for a bundle of this architecture, stubbed. */
const lipo = (archs) => () => ({
	status: 0,
	stdout: `${archs}\n`,
	stderr: "",
});

const FRAMEWORK = join(
	"Contents",
	"Frameworks",
	"Electron Framework.framework",
	"Versions",
	"A",
	"Electron Framework",
);

/**
 * A packaged app whose Electron Framework is arm64 - the architecture the check
 * reads, and one the sweep holds to that same architecture - carrying the
 * components given, each written in the shape it names.
 */
function makeApp(dir, { components = [] } = {}) {
	const app = join(dir, "mac-arm64", "Local Operator.app");
	writeThin(join(app, FRAMEWORK), MACH_O_CPUTYPE.ARM64);
	for (const component of components) {
		const path = join(app, component.relative);
		if (component.kind === "fat") writeFat(path, component.cpuTypes);
		else if (component.kind === "truncated") writeTruncated(path);
		else writeThin(path, component.cpuType);
	}
	return { app };
}

test("a bundle whose components all carry its own architecture passes", () => {
	// The shape the shipped arm64 artifact is: every component thin arm64. The
	// framework itself is one of the components swept, which is deliberate - the
	// check holds the bundle's own architecture to the bundle's own architecture,
	// so the file the architecture was read from is not exempt from it.
	const { app } = makeApp(tempDir("lo-native-"), {
		components: [
			{
				relative: "Contents/MacOS/Local Operator",
				cpuType: MACH_O_CPUTYPE.ARM64,
			},
			{
				relative:
					"Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node",
				cpuType: MACH_O_CPUTYPE.ARM64,
			},
			{
				relative:
					"Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib",
				cpuType: MACH_O_CPUTYPE.ARM64,
			},
		],
	});
	const pass = nativeComponentsCheck(app, { run: lipo("arm64") });
	assert.equal(pass.id, "app-native-components");
	assert.equal(pass.scope, "app");
	assert.equal(pass.passed, true, pass.output);
	assert.match(pass.output, /^4 Mach-O components, all arm64$/);
});

test("a universal component passes, because the bundle's architecture is in it", () => {
	// The invariant is membership, not equality: a component carrying arm64 AND
	// x86_64 opens natively on an arm64 Mac, and refusing it would fail a bundle
	// nobody has a reason to rebuild.
	const { app } = makeApp(tempDir("lo-native-"), {
		components: [
			{
				relative:
					"Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node",
				kind: "fat",
				cpuTypes: [MACH_O_CPUTYPE.ARM64, MACH_O_CPUTYPE.X86_64],
			},
		],
	});
	const pass = nativeComponentsCheck(app, { run: lipo("arm64") });
	assert.equal(pass.passed, true, pass.output);
	assert.match(pass.output, /2 Mach-O components, all arm64/);
});

test("a foreign-only component fails, and the failure names it and its slices", () => {
	// THE CASE macOS 27's NOTICE IS ABOUT, and the reason this check exists: a
	// bundle that is entirely correct except for one x86_64-only component. Every
	// other check in the file passes on this fixture - the framework is arm64, the
	// seed and uv trees are absent because those checks are not run here - and
	// macOS 28 refuses to open the app.
	const { app } = makeApp(tempDir("lo-native-"), {
		components: [
			{
				relative: "Contents/MacOS/Local Operator",
				cpuType: MACH_O_CPUTYPE.ARM64,
			},
			{
				relative:
					"Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-x64/pty.node",
				cpuType: MACH_O_CPUTYPE.X86_64,
			},
		],
	});
	const fail = nativeComponentsCheck(app, { run: lipo("arm64") });
	assert.equal(fail.passed, false);
	assert.match(fail.output, /1 of 3 Mach-O component\(s\) do not carry arm64/);
	// The offending path AND the slices it actually carries, both of which the
	// reader has to have got right for this to read as a diagnosis.
	assert.match(fail.output, /prebuilds\/darwin-x64\/pty\.node \[x86_64\]/);
	// The healthy components are NOT named: a list that included them would send a
	// reader to rebuild the wrong file.
	assert.doesNotMatch(fail.output, /Contents\/MacOS\/Local Operator/);
});

test("a component whose header cannot be read fails rather than passing", () => {
	// "We could not ask" is not "it is native". A truncated file is the shape a
	// download that lost its tail takes, and the check must not read it as clean.
	const { app } = makeApp(tempDir("lo-native-"), {
		components: [
			{
				relative: "Contents/Resources/app.asar.unpacked/broken.node",
				kind: "truncated",
			},
		],
	});
	const fail = nativeComponentsCheck(app, { run: lipo("arm64") });
	assert.equal(fail.passed, false);
	assert.match(
		fail.output,
		/1 Mach-O component\(s\) whose architecture could not be read, which is not the same as native/,
	);
	assert.match(fail.output, /app\.asar\.unpacked\/broken\.node/);
});

test("a bundle that is itself two architectures fails: there is nothing to hold components to", () => {
	// The pre-#138 shape, and the reason the check refuses rather than picking the
	// architecture it recognises: this project ships one artifact per
	// architecture, so a fat bundle is a build defect, and holding its components
	// to one of its two architectures would hide the other half of the same bug.
	const { app } = makeApp(tempDir("lo-native-"), { components: [] });
	const fail = nativeComponentsCheck(app, { run: lipo("arm64 x86_64") });
	assert.equal(fail.passed, false);
	assert.match(fail.output, /reports 2 architectures \(arm64, x86_64\)/);
	assert.match(fail.output, /one artifact per architecture/);
});

test("a bundle whose architecture this gate does not know fails rather than rounding", () => {
	// The bundle's architecture is read from the Electron Framework and used as the
	// one every component is measured against. An architecture with no declared
	// Mach-O cputype has nothing to measure against, and picking the nearest one
	// would let a PowerPC-only component pass on an arm64 bundle.
	const { app } = makeApp(tempDir("lo-native-"), { components: [] });
	const fail = nativeComponentsCheck(app, { run: lipo("ppc") });
	assert.equal(fail.passed, false);
	assert.match(
		fail.output,
		/The bundle is ppc, an architecture this gate has no Mach-O cputype for/,
	);
});

test("a long list of offenders is capped, with the remainder counted", () => {
	// A release whose build is wrong is wrong everywhere: a message that printed
	// every one of a few hundred paths would bury the first line, so the cap is
	// load-bearing rather than cosmetic - and the remainder has to be COUNTED, or a
	// capped list reads as the whole list.
	const components = Array.from({ length: 12 }, (_, index) => ({
		relative: `Contents/Resources/foreign-${index}.node`,
		cpuType: MACH_O_CPUTYPE.X86_64,
	}));
	const { app } = makeApp(tempDir("lo-native-"), { components });
	const fail = nativeComponentsCheck(app, { run: lipo("arm64") });
	assert.equal(fail.passed, false);
	assert.match(
		fail.output,
		/12 of 13 Mach-O component\(s\) do not carry arm64/,
	);
	assert.match(fail.output, /foreign-7\.node \[x86_64\]/);
	assert.doesNotMatch(fail.output, /foreign-9\.node/);
	assert.match(fail.output, /\(and 2 more\)/);
});

test("a bundle with no readable component at all fails rather than passing vacuously", () => {
	// The other direction of the same rule: a walk that finds nothing must not read
	// as "everything I looked at was native". `machOFiles` skips symlinks, so a
	// framework that is a link and no real component anywhere is exactly that
	// shape - and `bundleArchitectures` still resolves the link, which is what lets
	// the check reach the walk instead of failing earlier for a missing framework.
	const dir = tempDir("lo-native-");
	const target = join(dir, "elsewhere-binary");
	writeThin(target, MACH_O_CPUTYPE.ARM64);
	const { app } = makeApp(dir, { components: [] });
	rmSync(join(app, FRAMEWORK));
	symlinkSync(target, join(app, FRAMEWORK));
	const fail = nativeComponentsCheck(app, { run: lipo("arm64") });
	assert.equal(fail.passed, false);
	assert.match(fail.output, /No Mach-O component at all under the bundle/);
});
