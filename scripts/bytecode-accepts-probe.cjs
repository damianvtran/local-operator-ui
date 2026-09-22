"use strict";
/**
 * Ask a packaged bundle's OWN V8 whether the `.jsc` it ships is loadable BY IT.
 *
 * WHY THIS EXISTS. `out/main/index.jsc` is V8 bytecode, and V8 bytecode is only
 * accepted by the V8 that produced it — same version, same flags, same
 * ARCHITECTURE. When the release built both macOS bundles in one pass, the x64
 * DMG went out carrying the arm64 runner's bytecode (v0.30.10: the `.jsc` in
 * both DMGs was byte-identical, sha256 23a37ddc…), and every launch died in
 * `bytecode-loader.cjs` with `Invalid or incompatible cached data
 * (cachedDataRejected)` — surfaced to the user as Electron's "A JavaScript error
 * occurred in the main process" dialog. The app never opened, once.
 *
 * WHY THE EXISTING GATES ALL PASSED ON IT. `codesign`, `spctl` and `stapler`
 * read the signature, which was valid — the bytecode is payload, not signature.
 * And `app-spawn` runs `ELECTRON_RUN_AS_NODE=1 <exe> -p 'process.exit(0)'`,
 * which reaches the OS's exec decision and then runs the STRING it was given:
 * it never requires `app.asar`, so it never touches the `.jsc`. Confirmed
 * against the real broken x64 bundle on an M3: that probe exits 0. The gap is
 * not the bound or the predicate, it is that nothing loaded the payload.
 *
 * WHY NOT JUST LAUNCH THE APP. A real launch needs a window server session, a
 * user data directory and a teardown, and on a translated child it is minutes of
 * Rosetta. This asks V8 the identical question — `cachedDataRejected` is the
 * very flag `bytecode-loader.cjs` throws on — with NO side effects: the
 * compiled wrapper is never invoked, so no app code runs, nothing is written,
 * and nothing is left behind. It mirrors the loader deliberately; if that file's
 * header handling changes, this must change with it.
 *
 * Run BY the bundle under test, never by the runner's node:
 *   ELECTRON_RUN_AS_NODE=1 "<app>/Contents/MacOS/<exe>" \
 *     scripts/bytecode-accepts-probe.cjs "<app>/Contents/Resources/app.asar/out/main/index.jsc"
 *
 * That is the whole point — the verdict has to come from the shipped V8, so the
 * x64 bundle is asked in x86_64 terms even while an arm64 runner holds the file.
 * Electron resolves the path INSIDE `app.asar` transparently, so the archive
 * never has to be unpacked.
 *
 * Exits 0 and prints ACCEPTED when the bundle can load its own bytecode; exits 1
 * and prints REJECTED when it cannot. Any other failure (unreadable file, a
 * header too short to parse) exits 2 as PROBE-ERROR, so "could not tell" is
 * never reported as a pass.
 */
const fs = require("node:fs");
const vm = require("node:vm");
const v8 = require("node:v8");

// The same two flags `out/main/bytecode-loader.cjs` sets before it builds its
// Script. They are part of what the flag hash covers, so a probe that omitted
// them could reject bytecode the real loader accepts.
v8.setFlagsFromString("--no-lazy");
v8.setFlagsFromString("--no-flush-bytecode");

const FLAG_HASH_OFFSET = 12;
const SOURCE_HASH_OFFSET = 8;

const jscPath = process.argv[2];
if (!jscPath) {
	console.error("PROBE-ERROR usage: <probe> <path-to-index.jsc>");
	process.exit(2);
}

try {
	const bytecodeBuffer = fs.readFileSync(jscPath);
	if (bytecodeBuffer.length < FLAG_HASH_OFFSET + 4) {
		console.error(`PROBE-ERROR ${jscPath} is too short to be V8 bytecode`);
		process.exit(2);
	}

	// Stamp THIS V8's flag hash, exactly as the loader does. Without it every
	// bundle would answer REJECTED for a reason that is not the one under test.
	const dummy = new vm.Script("", {
		produceCachedData: true,
	}).createCachedData();
	dummy
		.subarray(FLAG_HASH_OFFSET, FLAG_HASH_OFFSET + 4)
		.copy(bytecodeBuffer, FLAG_HASH_OFFSET);

	// The loader compiles a placeholder whose source LENGTH matches the original,
	// because V8's source hash covers the length. Same reconstruction here.
	const hash = bytecodeBuffer.subarray(
		SOURCE_HASH_OFFSET,
		SOURCE_HASH_OFFSET + 4,
	);
	const length =
		((hash[3] << 24) | (hash[2] << 16) | (hash[1] << 8) | hash[0]) >>> 0;
	const dummyCode = length > 1 ? `"${"\u200b".repeat(length - 2)}"` : "";

	const script = new vm.Script(dummyCode, {
		filename: jscPath,
		lineOffset: 0,
		displayErrors: true,
		cachedData: bytecodeBuffer,
	});

	// `script.runInThisContext()` is deliberately NOT called: the question is
	// whether V8 accepted the cache, and answering it must not execute the app.
	if (script.cachedDataRejected) {
		console.error(
			`REJECTED ${jscPath} — this bundle's V8 (${process.arch}) will not load its own bytecode; the app dies at launch with cachedDataRejected`,
		);
		process.exit(1);
	}
	console.log(`ACCEPTED ${jscPath} (${process.arch})`);
	process.exit(0);
} catch (err) {
	console.error(`PROBE-ERROR ${jscPath}: ${err?.message}`);
	process.exit(2);
}
