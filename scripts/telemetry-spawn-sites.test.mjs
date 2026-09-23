import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";
import { TELEMETRY_ENV } from "./telemetry-off.mjs";

/**
 * Every call site in this repo that starts the app — or the suite that starts it
 * — turns the app's telemetry off in the environment it hands over.
 *
 * WHAT "EVERY" MEANS HERE, because the two halves of that sentence are checked
 * differently and the difference is the one a reader has to know: the scan below
 * finds the sites whose COMMAND reads as the Electron runtime, and the
 * `UNSCANNABLE_SPAWN_PATHS` list at the bottom holds the app-booting paths it
 * cannot see — a command that arrives as a variable, a helper's parameter, or a
 * wrapper (`npx electron`). Both halves are pinned, and the four paths added in
 * the round-1 remediation are the ones a scan of this shape misses by
 * construction: `attach-frame-evidence.mjs` and
 * `panels-without-session-evidence.mjs` spawn a `command` argument from their own
 * `launch` helper, `hold-lifetime-rig.mjs` spawns a packaged bundle's
 * `CFBundleExecutable`, and `run-panel-reveal-proof.mjs` boots the app as
 * `spawn("npx", ["electron", …])`. An earlier revision of this file claimed the
 * scan covered every site and, in the same breath, relied on a table assertion
 * that could not see any of the four.
 *
 * Why a table the test walks rather than a case per rig, and why a SIBLING of
 * `notification-spawn-sites.test.mjs` rather than an extension of it. The two
 * guards are applied at nearly the same sites, and the temptation is one table
 * with two columns; the tables are not the same, and the difference is a real
 * one. `scripts/npx-smoke-test.mjs` (the CI job that packs the tarball and boots
 * it on macOS) and `scripts/verify-signed-update.mjs` (the signed-update
 * verifier, which boots an incumbent, a candidate and a second launch) are both
 * deliberately UNGUARDED for notifications — a released build has no parked gate
 * to banner about, and the verifier cannot run on the operator's machine at all
 * — and both are exactly the runs that were arriving in the PostHog project as
 * users, from a hosted runner, on every release. A single table would have had
 * to encode "guarded for A but not for B" per row and per reason, which is the
 * shape where a row gets one column right and the other wrong.
 *
 * The failure this file prevents is the same class as its sibling's: a person
 * reading `AGENTS.md`'s "every path in this repo that spawns the app sets it"
 * while one of them does not. The rig somebody adds next month is exactly the
 * one that would forget this line.
 *
 * Like its sibling — and like `python-bytecode-cache.test.mjs` and
 * `window-mode.test.mjs`, which it also follows — the scan is a TEXT scan, so
 * its reach is exactly the spellings below; a rig that hid the Electron binary
 * behind a name that does not say "electron" would not be found. What it does
 * guarantee is that a new script which spawns the runtime the ordinary way
 * cannot be added without this table being considered.
 */
const SPAWN_NAMES = [
	"spawn",
	"spawnSync",
	"exec",
	"execSync",
	"execFile",
	"execFileSync",
];

/**
 * Comments blanked to SPACES, so an index into the result is still an index into
 * the original text: a name inside a comment or a string is not a call site, and
 * the slicing below reads the raw text by offset.
 */
function blankComments(source) {
	let out = "";
	let i = 0;
	while (i < source.length) {
		const ch = source[i];
		if (ch === "/" && source[i + 1] === "/") {
			while (i < source.length && source[i] !== "\n") {
				out += " ";
				i += 1;
			}
			continue;
		}
		if (ch === "/" && source[i + 1] === "*") {
			out += "  ";
			i += 2;
			while (
				i < source.length &&
				!(source[i] === "*" && source[i + 1] === "/")
			) {
				out += source[i] === "\n" ? "\n" : " ";
				i += 1;
			}
			out += "  ";
			i += 2;
			continue;
		}
		out += ch;
		i += 1;
	}
	return out;
}

/** Splits an argument list on its top-level commas. */
function splitArguments(text) {
	const parts = [];
	let depth = 0;
	let quote = null;
	let current = "";
	for (const ch of text) {
		if (quote) {
			current += ch;
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch;
			current += ch;
			continue;
		}
		if ("([{".includes(ch)) depth += 1;
		if (")]}".includes(ch)) depth -= 1;
		if (ch === "," && depth === 0) {
			parts.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	parts.push(current);
	return parts;
}

/**
 * The text of a scanned file, or `null` when it is gone by the time it is read.
 *
 * WHY a vanished file is not a finding: the loop below ENUMERATES `scripts/` and
 * `bin/` and reads each entry afterwards, while `node --test` runs test FILES in
 * parallel, so a file that exists at enumeration can be gone at the read. That
 * is the race that turned `Desktop Tests` red on CI for the sibling scan
 * (`chrome-keychain.test.mjs`'s own `readScannedFile` carries the full account):
 * a throwaway `scripts/_*.bundle.mjs` written and unlinked by a concurrent test
 * file, a pattern this repository gitignores precisely because it is disposable.
 *
 * Only `ENOENT` is tolerated: a directory or a permission failure is a finding,
 * and is thrown.
 */
function readScannedFile(file) {
	try {
		return readFileSync(file, "utf8");
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
		return null;
	}
}

/**
 * Every spawn-ish call site in `scripts/` and `bin/`, with the balanced text of
 * its argument list, classified by what it starts.
 *
 * A site is an ELECTRON site when the command it starts is the runtime binary,
 * however the file names it: `electronPath`, `ELECTRON_BIN` and a literal
 * `…/electron` path are the spellings the repo uses today, including
 * `./node_modules/.bin/electron`. `electron-vite`, `electron-builder` and the
 * other tooling are commands, not the app, so they are not.
 */
function findSpawnSites() {
	const sites = [];
	for (const dir of ["scripts", "bin"]) {
		if (!existsSync(dir)) continue;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isFile()) continue;
			if (!/\.(mjs|js|cjs)$/.test(entry.name)) continue;
			const file = join(dir, entry.name);
			const raw = readScannedFile(file);
			// Gone between the enumeration above and this read: a concurrent test file's
			// throwaway, which is not a spawn site. See `readScannedFile`.
			if (raw === null) continue;
			const source = blankComments(raw);
			const found = [];
			for (const name of SPAWN_NAMES) {
				for (const match of source.matchAll(
					new RegExp(`(?<![\\.\\w])${name}\\s*\\(`, "g"),
				)) {
					found.push({ name, at: match.index });
				}
			}
			found.sort((a, b) => a.at - b.at);
			const seen = {};
			for (const site of found) {
				seen[site.name] = (seen[site.name] ?? 0) + 1;
				let depth = 0;
				let end = source.indexOf("(", site.at);
				for (; end < source.length; end += 1) {
					if (source[end] === "(") depth += 1;
					else if (source[end] === ")") {
						// Spelled out rather than `(depth -= 1) === 0`: the
						// assignment-in-expression is a pre-existing lint error here, and the
						// scripts-scope gate requires the whole of `biome check` on any file
						// a change touches. Behaviour is identical.
						depth -= 1;
						if (depth === 0) break;
					}
				}
				const text = raw.slice(source.indexOf("(", site.at) + 1, end);
				const [command = ""] = splitArguments(text);
				sites.push({
					file: file.split(sep).join("/"),
					line: raw.slice(0, site.at).split("\n").length,
					name: site.name,
					index: seen[site.name],
					text,
					command: command.trim(),
					electron:
						/electron/i.test(command) &&
						!/electron-(vite|builder|updater|log|store)/i.test(command),
				});
			}
		}
	}
	return sites;
}

/**
 * A site that boots Electron and turns telemetry off in that child's
 * environment.
 *
 * `binding` is for the rigs whose environment arrives as a variable rather than
 * as an inline literal at the call, and it is asserted on the FILE: the point is
 * that the object handed to this spawn is the one the helper built, which a
 * pattern over the call's own text cannot see.
 *
 * `noEnv` is for the exemption whose reason is a NEGATIVE claim about the call —
 * "it deliberately passes no `env`" — and it asserts exactly that. That
 * exemption is the published launcher: it inherits the caller's environment, so
 * an export of the operator's own reaches it, and a launcher that started
 * overriding `env` would break that without anyone noticing.
 */
function guarded(file, name, index, site, why, binding) {
	return { file, name, index, guarded: true, why, site, binding };
}

function exempt(file, name, index, why, site, noEnv) {
	return { file, name, index, guarded: false, why, site, noEnv };
}

const APP_SPAWN_SITES = [
	guarded(
		"scripts/renderer-driver.mjs",
		"spawn",
		1,
		/(?:\{|,)\s*env\s*,/,
		"the rig an agent drives a scene through, and the one that boots the real app most often: its main constructs a `posthog-node` client and its renderer mounts the other one",
		/withTelemetryOff\(env\);/,
	),
	guarded(
		"scripts/band-occlusion-evidence.mjs",
		"spawn",
		1,
		/(?:\{|,)\s*env\s*,/,
		"boots the built app headless to photograph the shell's band geometry, against a daemon it starts itself",
		/withTelemetryOff\(env\);/,
	),
	guarded(
		"scripts/browser-chrome-proof.mjs",
		"spawn",
		1,
		/(?:\{|,)\s*env\s*,/,
		"boots the app to drive the browser-chrome surface on the profile it made for the run",
		/withTelemetryOff\(env\);/,
	),
	guarded(
		"scripts/browser-challenge-proof.mjs",
		"spawn",
		1,
		/(?:\{|,)\s*env\s*,/,
		"boots a BUILT app tree - `--app-tree`, so the same rig runs against a before and an after tree - in either window mode, and drives the browser host over its own /rpc",
		/withTelemetryOff\(env\);/,
	),
	guarded(
		"scripts/browser-host-proof.mjs",
		"spawn",
		1,
		/(?:\{|,)\s*env\s*,/,
		"boots the app to measure the browser host end to end",
		/withTelemetryOff\(env\);/,
	),
	guarded(
		"scripts/console-host-proof.mjs",
		"spawn",
		1,
		/(?:\{|,)\s*env\s*,/,
		"boots the built app headless and forks a REAL pty inside it - and with `--packaged` launches an electron-builder bundle the same way, so this rig is two separate runs",
		/withTelemetryOff\(env\);/,
	),
	guarded(
		"scripts/browser-file-transfer-proof.mjs",
		"spawn",
		1,
		/(?:\{|,)\s*env\s*,/,
		"boots the built app headless to drive a real download and a real upload",
		/withTelemetryOff\(env\);/,
	),
	guarded(
		"scripts/session-cookie-restart-proof.mjs",
		"spawn",
		1,
		/(?:\{|,)\s*env\s*,/,
		"boots the built app twice over a restart, which is two runs' worth of events",
		/withTelemetryOff\(env\);/,
	),
	guarded(
		"scripts/mentioned-files-app-proof.mjs",
		"spawn",
		1,
		/env:\s*\{/,
		"boots the app against the operator's live backend, so its child environment is built as `childEnv` and then handed to the spawn as a literal",
		/withTelemetryOff\(childEnv\);/,
	),
	guarded(
		"scripts/notification-hop-proof.mjs",
		"spawn",
		1,
		/(?:\{|,)\s*env\s*,/,
		"boots the app headless to measure the environment it hands the backend it spawns",
		/withTelemetryOff\(env\);/,
	),
	guarded(
		"scripts/interrupt-esc-proof.mjs",
		"spawn",
		1,
		/env:\s*spawnEnv,/,
		"drives the composer's interrupt end to end in the real app, against a real backend turn",
		/withTelemetryOff\(spawnEnv\);/,
	),
	exempt(
		"scripts/session-cookie-electron.test.mjs",
		"spawn",
		1,
		"boots a bare Electron scenario bundle - no app main, so neither `posthog-node` nor the renderer's provider is ever loaded - over cookie jars it made itself",
		/env:\s*\{/,
	),
	exempt(
		"scripts/notification-evidence.mjs",
		"spawnSync",
		1,
		"runs a staged Electron app whose whole program is `new Notification(...)`: the app's main is not loaded, so there is no PostHog client to switch off, and deliberately so - it exists to photograph the shipped notifier",
		/env:\s*\{/,
	),
	exempt(
		"bin/local-operator-ui.js",
		"spawn",
		1,
		"the PUBLISHED launcher, and a person's own app on their own screen: it deliberately passes no `env`, so the caller's environment is inherited and an export of the operator's own reaches it",
		undefined,
		true,
	),
];

/**
 * App-booting paths a scan for an Electron COMMAND cannot see, named so the list
 * cannot decay into names of files that no longer exist - and, where the guard
 * belongs on one of them, guarded.
 *
 * TWO OF THESE ARE GUARDED HERE AND EXEMPT IN THE SIBLING TABLE, which is the
 * whole reason this file is a sibling: both boot the real packaged app in CI,
 * which says nothing about notifications and everything about telemetry.
 */
const UNSCANNABLE_SPAWN_PATHS = [
	{
		file: "scripts/run-desktop-tests.mjs",
		guarded: true,
		why: "the runner behind `pnpm test:desktop`: it starts node over the suite rather than Electron itself, and the suite's own children are what boot the app - applying the switch here covers every file the suite runs, including the ones written after this change",
	},
	{
		file: "scripts/npx-smoke-test.mjs",
		guarded: true,
		why: "starts the published tarball through `npx`, and the `npx-sanity-check` job LAUNCHES the app on macOS - the run that was reporting to PostHog from a hosted runner on every release, which the sibling table deliberately exempts because a released build has no parked gate to banner about",
	},
	{
		file: "scripts/verify-signed-update.mjs",
		guarded: true,
		why: "boots the real PACKAGED app three times (incumbent, candidate, second launch) on GitHub's runner, and cannot run on the operator's machine at all - exempt for notifications for exactly that reason, guarded here because a packaged test run is still a user in the product's analytics",
	},
	{
		file: "scripts/attach-frame-evidence.mjs",
		guarded: true,
		why: "boots the real app for its frames through its own `launch(command, …)` helper, so the COMMAND is a parameter rather than an `electron` spelling the scan can classify - and its child environment is built from an ALLOWLIST, so an operator's export never reaches the app either. Guarded inside the builder that hands out that environment, which is what covers every boot in the file",
	},
	{
		file: "scripts/panels-without-session-evidence.mjs",
		guarded: true,
		why: "boots the same app through the same helper shape (`launch(command, …)`, an allowlisted child environment); the rig takes no tree argument and boots the app once per scene, so the before/after pair comes from invoking it twice rather than from one run",
	},
	{
		file: "scripts/hold-lifetime-rig.mjs",
		guarded: true,
		why: "boots a real PACKAGED `.app` by the bundle's own `CFBundleExecutable`, which no `electron` command text can be scanned for; it does inherit `process.env`, so the switch is applied to the environment it assembles",
	},
	{
		file: "scripts/run-panel-reveal-proof.mjs",
		guarded: true,
		why: 'boots the real app as `spawn("npx", ["electron", …])`: the command is `npx`, so the scan classifies the site as not-Electron, and the runtime the arguments name boots the app and its two PostHog clients all the same. Found by the remediation sweep of every spawn site whose command is not a literal `electron` - the round-1 review sweep named the other three here - it is the shape this list exists for',
	},
	{
		file: "scripts/daemon-discovery-evidence.mjs",
		guarded: false,
		why: "starts a real `lop serve` daemon to drive the electron-free discovery modules; no app process and no renderer exist in it, so there is no PostHog client of this app's anywhere in the run",
	},
];

/** The npm scripts that launch the app, and whether they switch telemetry off. */
const APP_LAUNCH_SCRIPTS = [
	{
		name: "app:headless",
		guarded: true,
		why: "the agent-driven launch, and the line AGENTS.md and docs/agent-driver.md tell an agent to copy: it boots the real app, so it must send nothing",
	},
	{
		name: "dev:headless",
		guarded: true,
		why: "the agent-driven dev launch. `dev` loads the working directory's `.env` through `dotenv-cli`, which does NOT overwrite a variable the launch already set, so this prefix survives into the app - a fact pinned by its own test below rather than assumed, because the `dev` body used to re-export that file over the launch's environment and a `.env` line in the empty shape silently re-armed the run",
	},
	{
		name: "start",
		guarded: false,
		why: "a person's own app at their own screen, whose analytics are the feature",
	},
	{
		name: "dev",
		guarded: false,
		why: "a person's own app at their own screen, whose analytics are the feature",
	},
];

const key = (row) => `${row.file}#${row.name}#${row.index}`;

test("every Electron spawn site in scripts/ and bin/ is named, and the guarded ones carry the switch", () => {
	const sites = findSpawnSites();
	const electron = sites.filter((site) => site.electron);
	const rows = new Map(APP_SPAWN_SITES.map((row) => [key(row), row]));

	const unlisted = electron.filter((site) => !rows.has(key(site)));
	assert.deepEqual(
		unlisted.map(
			(site) =>
				`${site.file}:${site.line} ${site.name} #${site.index}: ${site.command.slice(0, 60)}`,
		),
		[],
		"these start the Electron runtime and are not named in APP_SPAWN_SITES. A new rig fails here on purpose: it is the site most likely to hand the app an environment that reports a test run as a product user",
	);

	const stale = APP_SPAWN_SITES.filter(
		(row) => !electron.some((site) => key(site) === key(row)),
	);
	assert.deepEqual(
		stale.map(key),
		[],
		"APP_SPAWN_SITES names an Electron launch that is no longer there; remove the row with the call, so the table stays a description of the tree",
	);

	for (const site of electron) {
		const row = rows.get(key(site));
		const where = `${site.file}:${site.line} ${site.name} #${site.index}`;
		if (row.site) {
			assert.match(
				site.text,
				row.site,
				`${where} must pass the environment its child needs (${row.why})`,
			);
		}
		if (row.noEnv) {
			// The negative half of an exemption: this row is exempt BECAUSE it
			// inherits the caller's environment, so it must go on not overriding it.
			// The pattern covers the shorthand a `: {` alone would miss: `{ env }`,
			// `{ env, … }` and `{ env }` after another key all override the
			// environment, and the row this pins is the published launcher's promise
			// that the caller's own export reaches the app.
			assert.doesNotMatch(
				site.text,
				/env\s*[:},]/,
				`${where} claims to pass no environment (${row.why}), and now it passes one - either drop the override or drop the exemption`,
			);
		}
		if (!row.guarded) continue;
		assert.match(
			readFileSync(join(process.cwd(), site.file), "utf8"),
			row.binding,
			`${where} boots the app and must build that child's environment with withTelemetryOff (${row.why})`,
		);
	}

	// The scan's own reach, pinned the way `window-mode.test.mjs` pins its
	// recursion: a scan that silently matched nothing would pass every assertion
	// above while guarding nothing at all.
	assert.ok(
		electron.length >= 6,
		`the scan found ${electron.length} Electron spawn sites; the repo has at least the eleven app-proof rigs and the published launcher`,
	);
	assert.ok(
		[...APP_SPAWN_SITES, ...UNSCANNABLE_SPAWN_PATHS].filter(
			(row) => row.guarded,
		).length >= 18,
		"the guarded rows are the point of this file: the eleven app-proof rigs, the suite's own runner, the CI smoke test, the signed-update verifier and the four app-booting paths the scan cannot see",
	);
});

test("a checkout .env cannot flip the dev family in either direction", () => {
	/*
	 * WHY THIS TEST SPAWNS ANYTHING, when the rest of this file is a text scan.
	 * `pnpm dev` and `pnpm dev:headless` load the working directory's `.env`
	 * INSIDE a shell the app is launched from, and the round-1 review measured what
	 * that cost: the `dev` body re-exported the file after the caller's prefix, so
	 * a `.env` line reading LOCAL_OPERATOR_UI_TELEMETRY= (the empty shape, which
	 * the app folds back to "unset" - telemetry on, no off-line printed to reveal
	 * it) or =on re-armed a `dev:headless` run. That is a fact about a SCRIPT's
	 * behaviour, so a shape assertion alone would not see it.
	 *
	 * ONE SUBSTITUTION, stated rather than hidden: `npx dotenv-cli` resolves the
	 * PACKAGE, which on a host without it cached means the registry; the `dotenv`
	 * bin in this checkout is dotenv-cli's own entry point with the same `-e .env
	 * --` arguments, and it is the layer whose non-override this rests on. The
	 * pattern is asserted first, so a rewrite of `dev` fails here rather than
	 * silently testing nothing.
	 *
	 * The stub `electron-vite` reports the environment the app's process would
	 * inherit - which is the app's reading, because main resolves from the
	 * environment it was launched with.
	 */
	const pkg = JSON.parse(readFileSync("package.json", "utf8"));
	const body = pkg.scripts.dev;
	// The shape half: no re-export of the file over the launch, for ANY key.
	assert.doesNotMatch(
		body,
		/export\s+\$\(/,
		"scripts.dev must not re-export the .env over the environment the launch already set: a launch's environment outranking a file is the principle both switches rest on",
	);
	assert.match(
		body,
		/npx dotenv-cli -e \.env -- /,
		"this test substitutes the dotenv bin for `npx dotenv-cli` and reads that spelling out of the body; a rewrite of the script must fail here rather than be tested vacuously",
	);
	const loadable = body.replace(
		/npx dotenv-cli/,
		join(process.cwd(), "node_modules", ".bin", "dotenv"),
	);

	const root = mkdtempSync(join(tmpdir(), "lo-telemetry-dev-"));
	try {
		const bin = join(root, "bin");
		mkdirSync(bin, { recursive: true });
		const stub = join(bin, "electron-vite");
		writeFileSync(
			stub,
			`#!/bin/sh\nprintf 'telemetry=%s\\nprobe=%s\\n' "\${LOCAL_OPERATOR_UI_TELEMETRY-unset}" "\${LO_TELEMETRY_PIN_PROBE-unset}"\n`,
		);
		chmodSync(stub, 0o755);

		const run = (envLine, launchValue) => {
			writeFileSync(
				join(root, ".env"),
				`VITE_LOG_LEVEL=debug\nLO_TELEMETRY_PIN_PROBE=from-file\n${envLine === null ? "" : `${envLine}\n`}`,
			);
			const env = {
				...process.env,
				PATH: `${bin}:${join(process.cwd(), "node_modules", ".bin")}:${process.env.PATH}`,
			};
			if (launchValue === null) delete env[TELEMETRY_ENV];
			else env[TELEMETRY_ENV] = launchValue;
			const out = execFileSync("bash", ["-c", loadable], {
				cwd: root,
				encoding: "utf8",
				env,
				stdio: ["ignore", "pipe", "pipe"],
			});
			return Object.fromEntries(
				out
					.split("\n")
					.filter(Boolean)
					.map((line) => line.split("=")),
			);
		};

		// The two shapes that used to re-arm it, and the one that was always fine.
		for (const envLine of [`${TELEMETRY_ENV}=`, `${TELEMETRY_ENV}=on`, null]) {
			const seen = run(envLine, "off");
			assert.equal(
				seen.telemetry,
				"off",
				`a launch that says off must stay off whatever the .env line is: ${envLine === null ? "<key absent>" : envLine}`,
			);
			// The file is still LOADED: this is a rule about precedence, not a
			// retreat from `.env`, and a key the launch never set still arrives.
			assert.equal(
				seen.probe,
				"from-file",
				"the checkout .env must still supply the keys the launch did not set",
			);
		}

		// The other direction, so the fix cannot be "always off": with the launch
		// silent, the file's own value is what the app reads.
		assert.equal(run(`${TELEMETRY_ENV}=on`, null).telemetry, "on");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the app-spawning paths the scan cannot see are still there, and their reason still holds", () => {
	for (const path of UNSCANNABLE_SPAWN_PATHS) {
		assert.ok(
			existsSync(path.file),
			`${path.file} is gone; remove it from UNSCANNABLE_SPAWN_PATHS`,
		);
		if (!path.guarded) continue;
		assert.match(
			readFileSync(path.file, "utf8"),
			/withTelemetryOff\(/,
			`${path.file} is guarded because ${path.why}, but the call is gone`,
		);
	}
});

test("the agent-driven npm launches switch telemetry off and the interactive ones do not", () => {
	const pkg = JSON.parse(readFileSync("package.json", "utf8"));
	for (const row of APP_LAUNCH_SCRIPTS) {
		const body = pkg.scripts[row.name];
		assert.ok(
			body,
			`package.json has no ${row.name} script; this pin reads it`,
		);
		if (row.guarded) {
			assert.match(
				body,
				new RegExp(`${TELEMETRY_ENV}=off`),
				`${row.name} is ${row.why}`,
			);
		} else {
			assert.doesNotMatch(
				body,
				new RegExp(TELEMETRY_ENV),
				`${row.name} is ${row.why}, so it must not carry the switch`,
			);
		}
	}
});
