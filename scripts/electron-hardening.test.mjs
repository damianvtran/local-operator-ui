/**
 * F2 hardening: the Electron fuse wire, the main/inherit entitlement split, the
 * attestation epoch, the `--lo-launch-probe` contract and the packaged-app
 * `ELECTRON_RENDERER_URL` rule.
 *
 * What these tests hold, and why each matters (design: F2, "card answers
 * verified by the app's code signature"):
 * - package.json asks electron-builder for exactly the fuse table the release
 *   gate then reads back (`scripts/electron-fuse-policy.mjs`), so the config
 *   and the gate cannot drift into a build that passes its own gate unhardened;
 * - the committed plists carry none of the keys the gate forbids, so a local
 *   `pnpm dist:mac` and CI produce the same hardened signature;
 * - the gate's fuse reader fails closed on every shape a broken wire can take;
 * - the gate's hardening row fails a bundle signed the 0.57.8 way (DYLD
 *   entitlement on main and every helper), and passes the split;
 * - the launch probe's flag and marker are spelled the same in the app and the
 *   gate, and the app answers it before its single-instance lock.
 *
 * The TypeScript modules are imported directly: Node 24 strips their types
 * (`process.features.typescript === "strip"`), and both are written to need
 * nothing else.
 */
import assert from "node:assert/strict";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	ATTESTATION_EPOCH_KEY,
	ATTESTATION_EPOCH_VALUE,
	ELECTRON_FRAMEWORK_BINARY,
	FUSE_SENTINEL,
	REQUIRED_FUSES,
	attestationEpochFromInfoPlist,
	fuseViolations,
	readFuseWires,
} from "./electron-fuse-policy.mjs";
import { hardeningViolations } from "./macos-entitlement-policy.mjs";
import {
	LAUNCH_PROBE_FLAG,
	LAUNCH_PROBE_MARKER,
	attestationEpochCheck,
	electronFusesCheck,
	parseLaunchProbe,
	profileAuthorizationCheck,
} from "./verify-macos-artifacts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const MAIN_PLIST = readFileSync(
	join(ROOT, "build", "entitlements.mac.plist"),
	"utf8",
);
const INHERIT_PLIST = readFileSync(
	join(ROOT, "build", "entitlements.mac.inherit.plist"),
	"utf8",
);

const temps = [];
after(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
function tempDir(prefix) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	temps.push(dir);
	return dir;
}

/** A synthetic framework binary: padding, then one fuse wire per `wires`. */
function fuseBinary(wires, { version = 1 } = {}) {
	const parts = [Buffer.from("\0\0padding\0")];
	for (const wire of wires) {
		parts.push(Buffer.from(FUSE_SENTINEL, "latin1"));
		parts.push(Buffer.from([version, wire.length]));
		parts.push(Buffer.from(wire, "latin1"));
		parts.push(Buffer.from("\0tail\0"));
	}
	return Buffer.concat(parts);
}

/** The wire a hardened build carries: the shipped 9-fuse layout, F2 states.
 * Index: 0 RunAsNode, 1 Cookie, 2 NodeOptions, 3 Inspect, 4 AsarIntegrity,
 * 5 OnlyAsar, 6 V8Snapshot, 7 FileProtocol, 8 WasmTrapHandlers. */
const HARDENED_WIRE = "010011011";
/** The wire read from the installed 0.57.8 (F2 design note). */
const WIRE_0_57_8 = "101100011";

test("package.json asks electron-builder for exactly the fuses the gate requires", () => {
	const config = pkg.build.electronFuses;
	assert.ok(config, "build.electronFuses is missing");
	for (const fuse of REQUIRED_FUSES)
		assert.equal(
			config[fuse.configKey],
			fuse.state === "on",
			`${fuse.configKey} must be ${fuse.state === "on"}`,
		);
	// The deliberate exception, recorded so a later flip is a decision: turning
	// it off blanks the file:// renderer until an app:// protocol exists.
	assert.equal(config.grantFileProtocolExtraPrivileges, true);
	// Without it an UNSIGNED local arm64 package will not launch: the flip
	// breaks Electron Framework's ad-hoc linker signature, and electron-builder
	// only re-signs when it has an identity (round-1 review, MINOR-1).
	assert.equal(config.resetAdHocDarwinSignature, true);
});

test("package.json signs main and helpers with different plists and writes the epoch", () => {
	assert.equal(pkg.build.mac.entitlements, "build/entitlements.mac.plist");
	assert.equal(
		pkg.build.mac.entitlementsInherit,
		"build/entitlements.mac.inherit.plist",
	);
	assert.equal(
		pkg.build.mac.extendInfo?.[ATTESTATION_EPOCH_KEY],
		ATTESTATION_EPOCH_VALUE,
	);
	assert.equal(pkg.build.mac.hardenedRuntime, true);
});

test("the committed plists carry none of the keys the gate forbids", () => {
	assert.deepEqual(hardeningViolations(MAIN_PLIST, { isMain: true }), []);
	assert.deepEqual(hardeningViolations(INHERIT_PLIST, { isMain: false }), []);
	const keys = (plist) =>
		[...plist.matchAll(/<key>([^<]+)<\/key>/g)].map(([, key]) => key);
	// The documented residual: library validation is off for nested code only,
	// for the python seed's third-party wheels.
	assert.ok(
		keys(INHERIT_PLIST).includes(
			"com.apple.security.cs.disable-library-validation",
		),
	);
	assert.ok(
		!keys(MAIN_PLIST).includes(
			"com.apple.security.cs.disable-library-validation",
		),
	);
	// V8 still needs these in both.
	for (const plist of [MAIN_PLIST, INHERIT_PLIST])
		for (const key of [
			"com.apple.security.cs.allow-jit",
			"com.apple.security.cs.allow-unsigned-executable-memory",
		])
			assert.ok(keys(plist).includes(key), key);
});

test("hardeningViolations: forbids DYLD and get-task-allow everywhere, library validation off on main only", () => {
	const plist = (...keys) =>
		`<plist><dict>${keys.map((key) => `<key>${key}</key><true/>`).join("")}</dict></plist>`;
	const dyld = "com.apple.security.cs.allow-dyld-environment-variables";
	const dlv = "com.apple.security.cs.disable-library-validation";
	const gta = "com.apple.security.get-task-allow";
	assert.deepEqual(hardeningViolations(plist(dyld, dlv), { isMain: true }), [
		dyld,
		dlv,
	]);
	assert.deepEqual(hardeningViolations(plist(dyld, dlv), { isMain: false }), [
		dyld,
	]);
	assert.deepEqual(hardeningViolations(plist(gta), { isMain: false }), [gta]);
	assert.deepEqual(hardeningViolations("", { isMain: true }), []);
});

test("the fuse reader passes a hardened wire, a universal pair and a longer wire", () => {
	assert.deepEqual(fuseViolations(fuseBinary([HARDENED_WIRE])), []);
	assert.deepEqual(
		fuseViolations(fuseBinary([HARDENED_WIRE, HARDENED_WIRE])),
		[],
	);
	// A newer Electron with more fuses: indexed by position, so still a pass.
	assert.deepEqual(fuseViolations(fuseBinary([`${HARDENED_WIRE}01`])), []);
	const [wire] = readFuseWires(fuseBinary([HARDENED_WIRE]));
	assert.equal(wire.version, 1);
	assert.equal(wire.states[0], "off");
	assert.equal(wire.states[4], "on");
});

test("the fuse reader refuses 0.57.8's wire, naming every fuse that is wrong", () => {
	const problems = fuseViolations(fuseBinary([WIRE_0_57_8]));
	for (const name of [
		"RunAsNode is on",
		"EnableCookieEncryption is off",
		"EnableNodeOptionsEnvironmentVariable is on",
		"EnableNodeCliInspectArguments is on",
		"EnableEmbeddedAsarIntegrityValidation is off",
		"OnlyLoadAppFromAsar is off",
	])
		assert.ok(
			problems.some((line) => line.includes(name)),
			`${name}: ${problems}`,
		);
});

test("the fuse reader fails closed: one bad slice, removed, short, no sentinel, unknown version", () => {
	// Each required fuse flipped alone is caught.
	for (const fuse of REQUIRED_FUSES) {
		const wire = HARDENED_WIRE.split("");
		wire[fuse.index] = fuse.state === "on" ? "0" : "1";
		assert.equal(fuseViolations(fuseBinary([wire.join("")])).length, 1);
	}
	// A universal binary with ONE unhardened slice.
	assert.equal(
		fuseViolations(fuseBinary([HARDENED_WIRE, WIRE_0_57_8])).length > 0,
		true,
	);
	// A required fuse marked removed is not "off".
	const removed = HARDENED_WIRE.split("");
	removed[4] = "r";
	assert.match(
		fuseViolations(fuseBinary([removed.join("")])).join(" "),
		/EnableEmbeddedAsarIntegrityValidation is removed/,
	);
	// A wire too short to hold the required fuses.
	assert.match(
		fuseViolations(fuseBinary(["0100"])).join(" "),
		/OnlyLoadAppFromAsar is absent/,
	);
	assert.match(
		fuseViolations(Buffer.from("no wire here")).join(" "),
		/no Electron fuse wire/,
	);
	assert.match(
		fuseViolations(fuseBinary([HARDENED_WIRE], { version: 2 })).join(" "),
		/version 2/,
	);
	// A declared length that runs off the end of the file.
	const truncated = Buffer.concat([
		Buffer.from(FUSE_SENTINEL, "latin1"),
		Buffer.from([1, 9]),
		Buffer.from("0100", "latin1"),
	]);
	assert.match(fuseViolations(truncated).join(" "), /truncated/);
});

/** An app bundle with an Info.plist and, optionally, a framework binary. */
function fixtureApp({ framework = null, infoExtra = "" } = {}) {
	const app = join(tempDir("lo-f2-app-"), "Local Operator.app");
	mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
	writeFileSync(
		join(app, "Contents", "Info.plist"),
		`<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>com.local-operator</string><key>CFBundleExecutable</key><string>Local Operator</string>${infoExtra}</dict></plist>`,
	);
	if (framework) {
		const path = join(app, ELECTRON_FRAMEWORK_BINARY);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, framework);
	}
	return app;
}

test("app-electron-fuses passes a hardened bundle and fails 0.57.8's and a missing framework", () => {
	const good = electronFusesCheck(
		fixtureApp({ framework: fuseBinary([HARDENED_WIRE]) }),
	);
	assert.equal(good.id, "app-electron-fuses");
	assert.equal(good.passed, true, good.output);
	assert.match(good.output, /RunAsNode=off/);
	const old = electronFusesCheck(
		fixtureApp({ framework: fuseBinary([WIRE_0_57_8]) }),
	);
	assert.equal(old.passed, false);
	assert.match(old.output, /RunAsNode is on/);
	const missing = electronFusesCheck(fixtureApp());
	assert.equal(missing.passed, false);
	assert.match(missing.output, /ENOENT/);
});

test("app-attestation-epoch requires the exact value", () => {
	const entry = (value) =>
		`<key>${ATTESTATION_EPOCH_KEY}</key><string>${value}</string>`;
	assert.equal(
		attestationEpochCheck(fixtureApp({ infoExtra: entry("1") })).passed,
		true,
	);
	const absent = attestationEpochCheck(fixtureApp());
	assert.equal(absent.passed, false);
	assert.match(absent.output, /absent/);
	assert.equal(
		attestationEpochCheck(fixtureApp({ infoExtra: entry("0") })).passed,
		false,
	);
	assert.equal(attestationEpochFromInfoPlist(entry("1")), "1");
});

/** The four bytes `machOFiles` reads, plus the execute bit. */
function writeMachO(path) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
	chmodSync(path, 0o755);
}

/** A runner answering `codesign -d --entitlements` per executable. */
function entitlementRunner(byPath) {
	return (command, args) => {
		if (command.endsWith("/security"))
			return { status: 1, stdout: "", stderr: "no profile" };
		const target = args.at(-1);
		const keys = byPath(target);
		if (keys === null) return { status: 1, stdout: "", stderr: "unsigned" };
		return {
			status: 0,
			stdout: `<plist><dict>${keys.map((key) => `<key>${key}</key><true/>`).join("")}</dict></plist>`,
			stderr: "",
		};
	};
}

const DYLD = "com.apple.security.cs.allow-dyld-environment-variables";
const DLV = "com.apple.security.cs.disable-library-validation";
const JIT = "com.apple.security.cs.allow-jit";

function walkApp() {
	const app = fixtureApp();
	writeMachO(join(app, "Contents", "MacOS", "Local Operator"));
	writeMachO(
		join(
			app,
			"Contents/Frameworks/Local Operator Helper (Renderer).app/Contents/MacOS/Local Operator Helper (Renderer)",
		),
	);
	writeMachO(
		join(app, "Contents/Resources/python-runtime-seed/arm64/bin/python3"),
	);
	return app;
}

const hardeningRow = (app, byPath) =>
	profileAuthorizationCheck(app, {
		run: entitlementRunner(byPath),
		profile: { present: false, entitlements: null },
	}).find((row) => row.id === "app-hardening-entitlements");

test("app-hardening-entitlements fails the 0.57.8 signature and passes the F2 split", () => {
	const app = walkApp();
	// 0.57.8: one plist for everything, DYLD + library validation off everywhere.
	const old = hardeningRow(app, () => [JIT, DYLD, DLV]);
	assert.equal(old.passed, false);
	assert.match(old.output, /3 of 3 executable/);
	assert.match(
		old.output,
		/MacOS\/Local Operator: .*allow-dyld.*disable-library-validation/,
	);
	// F2: main clean, nested code keeps library validation off only.
	const split = hardeningRow(app, (path) =>
		path.endsWith("MacOS/Local Operator") ? [JIT] : [JIT, DLV],
	);
	assert.equal(split.passed, true, split.output);
	// Library validation off on MAIN alone is still a failure.
	const mainDlv = hardeningRow(app, (path) =>
		path.endsWith("MacOS/Local Operator") ? [JIT, DLV] : [JIT],
	);
	assert.equal(mainDlv.passed, false);
	// One helper with the DYLD key is enough to fail.
	const helperDyld = hardeningRow(app, (path) =>
		path.includes("Helper (Renderer)") ? [JIT, DYLD] : [JIT],
	);
	assert.equal(helperDyld.passed, false);
	assert.match(helperDyld.output, /Helper \(Renderer\)/);
});

test("app-hardening-entitlements is red on an empty walk and leaves unreadable signatures to the readability row", () => {
	const empty = fixtureApp();
	const row = hardeningRow(empty, () => [JIT]);
	assert.equal(row.passed, false);
	const app = walkApp();
	const rows = profileAuthorizationCheck(app, {
		run: entitlementRunner(() => null),
		profile: { present: false, entitlements: null },
	});
	assert.equal(
		rows.find((r) => r.id === "app-entitlements-readable").passed,
		false,
	);
	// Nothing read, nothing forbidden found: the host-capability row owns this.
	assert.equal(
		rows.find((r) => r.id === "app-hardening-entitlements").passed,
		true,
	);
});

test("the launch probe: the app and the gate spell flag and marker the same", async () => {
	const probe = await import("../src/main/launch-probe.ts");
	assert.equal(probe.LAUNCH_PROBE_FLAG, LAUNCH_PROBE_FLAG);
	assert.equal(probe.LAUNCH_PROBE_MARKER, LAUNCH_PROBE_MARKER);
});

test("the launch probe answers only its exact flag, before any `--`", async () => {
	const { launchProbeRequested } = await import("../src/main/launch-probe.ts");
	assert.equal(launchProbeRequested(["exe", "--lo-launch-probe"]), true);
	assert.equal(
		launchProbeRequested(["exe", "--user-data-dir=/x", "--lo-launch-probe"]),
		true,
	);
	assert.equal(launchProbeRequested(["exe"]), false);
	assert.equal(launchProbeRequested(["exe", "--lo-launch-probe=1"]), false);
	assert.equal(launchProbeRequested(["exe", "--", "--lo-launch-probe"]), false);
});

test("the launch probe prints one parseable line and exits 0; otherwise it does nothing", async () => {
	const { runLaunchProbeIfRequested } = await import(
		"../src/main/launch-probe.ts"
	);
	const lines = [];
	const exits = [];
	const app = { isPackaged: true, exit: (code) => exits.push(code) };
	assert.equal(
		runLaunchProbeIfRequested(app, ["exe", "--lo-launch-probe"], (line) =>
			lines.push(line),
		),
		true,
	);
	assert.deepEqual(exits, [0]);
	assert.equal(lines.length, 1);
	const report = parseLaunchProbe(`${lines[0]}\n`);
	assert.equal(report.ok, true);
	assert.equal(report.packaged, true);
	assert.equal(report.arch, process.arch);
	assert.equal(
		runLaunchProbeIfRequested(app, ["exe"], (line) => lines.push(line)),
		false,
	);
	assert.equal(lines.length, 1);
	assert.deepEqual(exits, [0]);
});

test("index.ts answers the probe before its single-instance lock, window or whenReady", () => {
	const source = readFileSync(join(ROOT, "src", "main", "index.ts"), "utf8");
	const probe = source.indexOf("runLaunchProbeIfRequested(app);");
	assert.ok(probe > 0, "index.ts no longer calls the launch probe");
	for (const later of [
		"app.requestSingleInstanceLock(",
		"resolveWindowLaunchPlan({",
		"app.whenReady()",
		"new BrowserWindow(",
	]) {
		const at = source.indexOf(later);
		assert.ok(at === -1 || at > probe, `${later} runs before the probe`);
	}
});

test("a packaged app ignores ELECTRON_RENDERER_URL; a dev build honours it", async () => {
	const { devRendererUrl } = await import("../src/main/dev-renderer-url.ts");
	const env = { ELECTRON_RENDERER_URL: "http://127.0.0.1:5173" };
	assert.equal(devRendererUrl(true, env), undefined);
	assert.equal(devRendererUrl(false, env), "http://127.0.0.1:5173");
	assert.equal(devRendererUrl(false, {}), undefined);
	assert.equal(devRendererUrl(false, { ELECTRON_RENDERER_URL: "" }), undefined);
});

test("no main-process read of ELECTRON_RENDERER_URL bypasses the packaged rule", () => {
	// Every read goes through `devRendererUrl`: the ones that decide trust (the
	// trusted renderer document, DevTools, the backend CORS origin, the updater's
	// dev mode) and the window loads, so the loaded document and the trusted one
	// cannot disagree.
	const files = {
		"src/main/index.ts": 0,
		"src/main/backend/backend-service.ts": 0,
		"src/main/update-service.ts": 0,
		"src/main/backend/backend-installer.ts": 0,
	};
	for (const [file, guarded] of Object.entries(files)) {
		const source = readFileSync(join(ROOT, file), "utf8");
		const direct = [
			...source.matchAll(/^.*process\.env\.ELECTRON_RENDERER_URL.*$/gm),
		]
			.map(([line]) => line)
			.filter((line) => !/^\s*(\*|\/\/)/.test(line));
		const gated = direct.filter((line) => /is\.dev &&/.test(line));
		assert.equal(
			direct.length - gated.length,
			0,
			`${file}: ungated read(s): ${direct.join(" / ")}`,
		);
		assert.equal(gated.length, guarded, file);
	}
	assert.ok(existsSync(join(ROOT, "src/main/dev-renderer-url.ts")));
});
