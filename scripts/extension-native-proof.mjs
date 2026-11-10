#!/usr/bin/env node
/** Portable native proof of the extension manager (src/main/browser/extensions)
 * + the real TabRegistry + the patched adapter, on this repo's Electron.
 * Run: node scripts/extension-native-proof.mjs [--crx <store.crx>] [--ui-diagnostic]
 * The fixture is the official 1Password store package (the operator's target
 * extension); without --crx it downloads ONLY the product's fixed store URL.
 * Each run owns a fresh profile under gitignored out/ seeded in the legacy
 * single-vendor layout (so migration runs natively) with a SYNTHETIC consent
 * marker; it never touches the operator's profile or a real vault. Not
 * whole-app renderer QA, and not proof of a passkey assertion.
 */
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, rmSync } from "node:fs";
import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import electronPath from "electron";
import { build } from "esbuild";
import {
	alreadyGone,
	onInterrupted,
	reapOnExit,
	stopAppTree,
} from "./app-tree-teardown.mjs";
import { withMockKeychain } from "./chrome-keychain.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";
const require = createRequire(import.meta.url);
const uiDiagnostic = process.argv.includes("--ui-diagnostic");
const args = process.argv.slice(2).filter((arg) => arg !== "--ui-diagnostic");
if (args.length && (args.length !== 2 || args[0] !== "--crx"))
	throw new Error(
		"Usage: node scripts/extension-native-proof.mjs [--crx <store.crx>]",
	);
// Compiled bundles and Chromium profiles are BUILD outputs, not text scratch:
// an official extension's caches can exceed the session's 256MiB store cap.
const outputDirectory = join(process.cwd(), "out");
await mkdir(outputDirectory, { recursive: true });
if ((await lstat(outputDirectory)).isSymbolicLink())
	throw new Error("Proof output directory must not be a symlink");
const root = await mkdtemp(join(outputDirectory, "extension-native-proof-"));
// Evidence (log, PNG frames) also lives under out/: frames are build output,
// and the session scratchpad has a hard size cap.
const evidence = await mkdtemp(
	join(outputDirectory, "extension-native-evidence-"),
);
let launched = false;
process.once("exit", () => {
	if (!launched) rmSync(root, { recursive: true, force: true });
});
const profile = join(root, "user-data");
const verifier = join(root, "verify.cjs");
const bundle = join(root, "controller.cjs");
const externalAdapter = {
	name: "actual-pinned-adapter",
	setup(builder) {
		builder.onResolve({ filter: /^electron-chrome-extensions$/ }, () => ({
			path: require.resolve("electron-chrome-extensions"),
			external: true,
		}));
	},
};
await build({
	stdin: {
		contents:
			'export * from "./src/main/browser/extensions/crx"; export { downloadStoreCrx } from "./src/main/browser/extensions/install"; export { EXTENSION_STARTUP_DEADLINE_MS } from "./src/shared/browser-extensions";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	outfile: verifier,
});
await build({
	stdin: {
		contents:
			'export * from "./src/main/browser/extensions/manager"; export * from "./src/main/browser/extensions/adapter"; export { TabRegistry } from "./src/main/browser/registry";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	external: ["electron"],
	plugins: [externalAdapter],
	outfile: bundle,
});
const {
	verifyStoreCrx,
	downloadStoreCrx,
	ONEPASSWORD_EXTENSION_ID,
	EXTENSION_STARTUP_DEADLINE_MS,
} = require(verifier);
// Two engine startup bounds plus one for public download/extraction/action/
// teardown. This derives from the measured product bound, not a polling loop.
// +20 s for the fixed popup frame schedule (0/5/15 s) the main half captures.
const budget =
	EXTENSION_STARTUP_DEADLINE_MS * 3 + 20_000 + (uiDiagnostic ? 90_000 : 0);
const crx = args[1]
	? await readFile(resolve(args[1]))
	: await downloadStoreCrx(
			ONEPASSWORD_EXTENSION_ID,
			AbortSignal.timeout(budget),
			fetch,
			// QA Q2: this outer runner is plain Node (no process.versions.chrome);
			// ask the Electron binary that will load the package for its Chromium
			// version, so the store serves a compatible CRX instead of a 204.
			execFileSync(electronPath, ["-p", "process.versions.chrome"], {
				env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
				encoding: "utf8",
			}).trim(),
		);
verifyStoreCrx(crx, ONEPASSWORD_EXTENSION_ID);
await writeFile(join(root, "official.crx"), crx, { mode: 0o600 });
await mkdir(join(root, "home"), { recursive: true });
const env = withNotificationsOff({
	...process.env,
	HOME: join(root, "home"),
	LOCAL_OPERATOR_CONFIG_DIR: join(root, "config"),
	LOCAL_OPERATOR_LOG_DIR: join(root, "logs"),
	LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
	LOCAL_OPERATOR_UI_TELEMETRY: "off",
	LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
	EXTENSION_PROOF_ROOT: root,
	EXTENSION_PROOF_BUNDLE: bundle,
	EXTENSION_EVIDENCE_ROOT: evidence,
	EXTENSION_UI_DIAGNOSTIC: uiDiagnostic ? "1" : "0",
});
withTelemetryOff(env);
for (const key of Object.keys(env))
	if (
		key.startsWith("CMUX_") ||
		key.startsWith("LOP_") ||
		["XPC_FLAGS", "ELECTRON_RUN_AS_NODE", "DEBUG", "NODE_OPTIONS"].includes(key)
	)
		delete env[key];
const electronArgs = withMockKeychain([
	resolve(import.meta.dirname, "extension-native-proof-main.cjs"),
	"--window-mode=headless",
	`--user-data-dir=${profile}`,
]);
const log = createWriteStream(join(evidence, "native.log"), { mode: 0o600 });
const child = spawn(electronPath, electronArgs, {
	env,
	detached: true,
	stdio: ["ignore", "pipe", "pipe"],
});
launched = true;
reapOnExit({ pid: child.pid, userData: profile, groupOutlivesLeader: true });
const groupGone = () => {
	try {
		process.kill(-child.pid, 0);
		return false;
	} catch {
		return true;
	}
};
let cleaned;
const cleanup = () => {
	cleaned =
		cleaned ??
		stopAppTree({ pid: child.pid, userData: profile, isExited: groupGone });
	return cleaned;
};
onInterrupted(async () => {
	await cleanup();
	return 1;
});
let transcript = "";
for (const stream of [child.stdout, child.stderr])
	stream.on("data", (chunk) => {
		transcript += chunk.toString();
		log.write(chunk);
		process.stdout.write(chunk);
	});
console.log(
	JSON.stringify({
		proofRoot: root,
		evidenceRoot: evidence,
		pid: child.pid,
		log: join(evidence, "native.log"),
	}),
);
let timer;
let code = 1;
try {
	const result = await Promise.race([
		new Promise((yes, no) => {
			child.once("error", no);
			child.once("close", (exitCode, signal) => yes({ exitCode, signal }));
		}),
		new Promise((_yes, no) => {
			timer = setTimeout(
				() => no(new Error("Native proof exceeded measured product budget")),
				budget,
			);
		}),
	]);
	const expected = uiDiagnostic ? "UI_DIAGNOSTIC_CAPTURED" : "PASS";
	code =
		result.exitCode === 0 &&
		transcript.includes(JSON.stringify({ result: expected }).slice(1, -1))
			? 0
			: 1;
	console.log(
		JSON.stringify({
			nativeExit: result,
			result:
				code === 0
					? uiDiagnostic
						? "UI_DIAGNOSTIC_CAPTURED"
						: "PASS"
					: "FAIL",
		}),
	);
} finally {
	clearTimeout(timer);
	const teardown = await cleanup();
	log.end();
	console.log(JSON.stringify({ teardown, parentGone: alreadyGone(child.pid) }));
	if (!teardown.clean || !teardown.groupExited) code = 1;
	else await rm(root, { recursive: true, force: true });
}
process.exitCode = code;
