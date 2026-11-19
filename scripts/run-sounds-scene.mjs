#!/usr/bin/env node
/** One self-contained, silent, headless evidence run. Builds this source tree,
 * seeds an isolated daemon, and reaps every owned process group in finally.
 * No provider calls; the PCM fixture is local and deliberately non-silent. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { writeSoundsFixture } from "./sounds-fixture.mjs";

const repo = resolve(import.meta.dirname, "..");
const scratch = process.env.LOCAL_OPERATOR_SCRATCHPAD;
if (!scratch)
	throw new Error("LOCAL_OPERATOR_SCRATCHPAD must name the evidence root");
const root = mkdtempSync(join(scratch, "sounds-native-"));
const harness =
	process.env.LOP_SOUNDS_HARNESS ??
	join(homedir(), "local-operator", ".worktrees", "sound-generation");
const python = join(homedir(), "local-operator", ".venv", "bin", "python");
if (
	!existsSync(python) ||
	!existsSync(join(harness, "local_operator")) ||
	!existsSync(join(repo, "node_modules/electron/dist/Electron.app"))
)
	throw new Error(
		"sounds preflight: existing Python, harness source and Electron dependencies required; no installs performed",
	);
const owned = new Set();
const env = Object.fromEntries(
	Object.entries(process.env).filter(
		([key]) =>
			!key.startsWith("CMUX_") &&
			!key.startsWith("LOP_") &&
			key !== "XPC_FLAGS",
	),
);
Object.assign(env, {
	HOME: join(root, "home"),
	TMPDIR: root,
	npm_config_cache: process.env.npm_config_cache ?? join(homedir(), ".npm"),
	LOCAL_OPERATOR_CONFIG_DIR: join(root, "config"),
	LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
	LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
	LOCAL_OPERATOR_UI_TELEMETRY: "off",
	PYTHONPATH: harness,
	VITE_GOOGLE_CLIENT_ID: "sounds-fixture",
	VITE_GOOGLE_CLIENT_SECRET: "sounds-fixture-not-a-credential",
	VITE_MICROSOFT_CLIENT_ID: "sounds-fixture",
	VITE_MICROSOFT_TENANT_ID: "sounds-fixture",
	LOCAL_OPERATOR_DESKTOP_TOKEN: randomBytes(32).toString("hex"),
	GIT_CONFIG_SYSTEM: "/dev/null",
	GIT_TERMINAL_PROMPT: "0",
});
mkdirSync(env.HOME, { recursive: true });
let signedHits = 0;
const signed = createHttpServer((_request, response) => {
	signedHits += 1;
	response.writeHead(403, { "Content-Type": "text/plain" });
	response.end("Fixture signed URL expired");
});
await new Promise((resolveListen) =>
	signed.listen(0, "127.0.0.1", resolveListen),
);
signed.unref();
const expiredUrl = `http://127.0.0.1:${signed.address().port}/expired-signed-audio?expired=1`;
const fixture = writeSoundsFixture(env.LOCAL_OPERATOR_CONFIG_DIR, expiredUrl);
writeFileSync(
	join(env.LOCAL_OPERATOR_CONFIG_DIR, "config.yml"),
	"values:\n  hosting: test\n  model_name: mock-model\n",
);
function launch(command, args, name) {
	const log = openSync(join(root, `${name}.log`), "a");
	const child = spawn(command, args, {
		cwd: repo,
		env,
		detached: true,
		stdio: ["ignore", log, log],
	});
	owned.add(child);
	// Retain owned group IDs even when a launcher exits: descendants may remain.
	return child;
}
const complete = (child) =>
	new Promise((ok, no) => {
		child.once("error", no);
		child.once("exit", (code, signal) =>
			code === 0
				? ok()
				: no(
						new Error(
							`process ${child.pid}: code=${code} signal=${signal}; logs ${root}`,
						),
					),
		);
	});
const reap = () => {
	for (const child of owned) {
		try {
			process.kill(-child.pid, "SIGTERM");
		} catch (error) {
			if (error.code !== "ESRCH") {
				console.error(error);
				process.exitCode = 1;
			}
		}
	}
};
for (const signal of ["SIGINT", "SIGTERM"])
	process.once(signal, () => {
		reap();
		process.exit(1);
	});
/*
 * THE BOUND COVERS THE WHOLE RUN, AND THE BUILD IS THE LONGEST LEG. Measured
 * on this checkout (2026-10-23): `pnpm build` is 1m29s on its own, the isolated
 * daemon's readiness and the history/files preflight add ~20s, and the scene
 * itself is ~40s - which put the old 240s budget exactly at the seam and the
 * run was killed with an empty frames dir after the preflight passed. 480s
 * keeps the same reap-on-timeout guarantee with room for a cold build.
 */
const bound = setTimeout(() => {
	reap();
	console.error(`sounds timed out; evidence ${root}`);
	process.exit(1);
}, 480000);
try {
	const expired = await fetch(expiredUrl);
	if (expired.status !== 403)
		throw new Error("signed URL negative control must return 403");
	console.log(
		`expired signed URL negative control HTTP ${expired.status}; requests=${signedHits}`,
	);
	const server = createServer();
	await new Promise((resolveListen) =>
		server.listen(0, "127.0.0.1", resolveListen),
	);
	const port = server.address().port;
	await new Promise((resolveClose) => server.close(resolveClose));
	const backend = `http://127.0.0.1:${port}`;
	console.log(
		JSON.stringify({
			root,
			fixture,
			harness,
			backend,
			mode: "headless",
			safety: "zero-gain graph before element creation",
		}),
	);
	const daemon = launch(
		python,
		[
			"-c",
			"from local_operator.cli import main; main()",
			"serve",
			"--host",
			"127.0.0.1",
			"--port",
			String(port),
			"--hosting",
			"test",
			"--model",
			"mock-model",
		],
		"daemon",
	);
	let ready = false;
	for (let i = 0; i < 120; i++) {
		if (daemon.exitCode !== null)
			throw new Error(`daemon exited; ${root}/daemon.log`);
		try {
			const response = await fetch(`${backend}/health`);
			if (response.ok) {
				ready = true;
				break;
			}
		} catch {}
		await new Promise((r) => setTimeout(r, 250));
	}
	if (!ready) throw new Error(`daemon readiness failed; ${root}/daemon.log`);
	const history = await fetch(
		`${backend}/v1/desktop/sessions/${fixture.sessionId}/history?limit=100`,
		{
			headers: { Authorization: `Bearer ${env.LOCAL_OPERATOR_DESKTOP_TOKEN}` },
		},
	);
	const historyBody = await history.json();
	writeFileSync(
		join(root, "preflight-history.json"),
		JSON.stringify(historyBody, null, 2),
	);
	console.log(
		`history preflight HTTP ${history.status}; ${root}/preflight-history.json`,
	);
	if (!history.ok) throw new Error("history fixture preflight failed");
	await complete(
		launch(
			process.execPath,
			["scripts/run-desktop-tests.mjs", "scripts/sounds-fixture.test.mjs"],
			"fixture-preflight",
		),
	);
	const inventory = await fetch(
		`${backend}/v1/desktop/sessions/${fixture.sessionId}/files?limit=200&scope=family`,
		{
			headers: { Authorization: `Bearer ${env.LOCAL_OPERATOR_DESKTOP_TOKEN}` },
		},
	);
	writeFileSync(
		join(root, "preflight-files.json"),
		JSON.stringify(await inventory.json(), null, 2),
	);
	// Build identity is verified again by renderer-driver's source/content guard.
	env.VITE_LOCAL_OPERATOR_API_URL = backend;
	await complete(launch("npx", ["-y", "pnpm@10.29.2", "build"], "build"));
	await complete(
		launch(
			process.execPath,
			[
				"scripts/renderer-driver.mjs",
				"--scene",
				"sounds",
				"--backend",
				backend,
				"--backend-records",
				join(env.LOCAL_OPERATOR_CONFIG_DIR, "run", "serve"),
				"--seed-onboarding-complete",
				"--out",
				join(root, "frames"),
			],
			"scene",
		),
	);
	if (signedHits !== 1)
		throw new Error(`app hotlinked expired URL: requests=${signedHits}`);
	console.log(
		`PASS expired URL remains unused by the app: requests=${signedHits}`,
	);
	console.log(
		`PASS sounds real-app scene: ${root}/frames; logs ${root}/scene.log`,
	);
} finally {
	signed.closeAllConnections();
	signed.close();
	clearTimeout(bound);
	reap();
	await new Promise((resolveWait) => setTimeout(resolveWait, 500));
	for (const child of owned) {
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch (error) {
			if (error.code !== "ESRCH") {
				console.error(error);
				process.exitCode = 1;
			}
		}
	}
}
