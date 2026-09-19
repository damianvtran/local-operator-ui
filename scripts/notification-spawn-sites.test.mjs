import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { test } from "node:test";
import { NOTIFICATIONS_ENV } from "./notifications-off.mjs";

/**
 * Every call site in this repo that starts the app — or the suite that starts it
 * — names the notification kill switch in the environment it hands over.
 *
 * Why a table the test walks rather than a case per rig. The guard is applied by
 * hand at each such site, and `scripts/renderer-driver.mjs` is the one the
 * incident most likely came through (#190's dev harness boots the real app): a
 * seventh rig, or a `spawn(electronPath, …)` added to an existing one, is
 * silently unguarded, and "the class, not the instance" is then true only until
 * somebody writes the next harness. The failure this file prevents is a person
 * reading `AGENTS.md`'s "every path in this repo that spawns the app or the
 * suite sets it" while one of them does not.
 *
 * The shape follows this repo's own precedents: `python-bytecode-cache.test.mjs`
 * scans a whole tree for child-process call sites and requires each to be named
 * in `SPAWN_SITES`, and `window-mode.test.mjs` scans `src/main/` for a call the
 * audit is about. Like those, it is a TEXT scan, so its reach is exactly the
 * spellings below — a rig that hid the Electron binary behind a name that does
 * not say "electron" would not be found by it. What it does guarantee is that a
 * new script which spawns the runtime the ordinary way cannot be added without
 * this table being considered.
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
 * WHY a vanished file is not a finding. The loop below ENUMERATES `scripts/` and
 * `bin/` and reads each entry afterwards, while `node --test` runs test FILES in
 * parallel: a file that exists at enumeration can be gone at the read. That is
 * the race that turned `Desktop Tests` red on CI for the sibling scan
 * (`scripts/chrome-keychain.test.mjs`'s own `readScannedFile`, whose docblock
 * carries the full account): a throwaway `scripts/_*.bundle.mjs` written and
 * unlinked by a concurrent test file, a pattern this repository gitignores
 * precisely because it is disposable. Every test file that writes one is in this
 * file's own roster (`package.json`), so this scanner can be crossed by it too.
 *
 * The helper is per-file rather than shared, like this scanner's own
 * `splitArguments` and comment blanker: the two scanners import nothing from each
 * other, and a file-read helper has no business in `chrome-keychain.mjs`'s
 * keychain module.
 *
 * Skipping such a file keeps every assertion's meaning - what this scan asserts
 * about is the files that ARE there, and a rig that is really gone is still
 * caught by the reach assertions below (`electron.length >= 6`, the guarded-row
 * count, and `UNSCANNABLE_SPAWN_PATHS`' own `existsSync`). ONLY `ENOENT` is
 * tolerated: a directory or a permission failure is a finding, and is thrown.
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
 * however the file names it: `electronPath` and `ELECTRON_BIN` are the two
 * spellings the repo uses today, a literal `…/electron` path is the third, and
 * anything else mentioning "electron" as the command is treated the same way.
 * `electron-vite`, `electron-builder` and the other tooling are commands, not
 * the app, so they are not.
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
 * A site that boots Electron and builds that child's environment through
 * `withNotificationsOff`.
 *
 * `binding` is for the rigs whose environment arrives as a variable rather than
 * as an inline literal at the call, and it is asserted on the FILE: the point is
 * that the object handed to this spawn is the one the helper built, which a
 * per-site grep for the helper's name cannot show (the same lesson
 * `python-bytecode-cache.test.mjs` records for its second install-script row).
 */
function guarded(file, name, index, site, why, binding) {
	return { file, name, index, guarded: true, site, why, binding };
}

/**
 * A site that boots Electron or an app, with the reason it carries no switch.
 *
 * `noEnv` is for the exemption whose reason is a NEGATIVE claim about the call —
 * "it deliberately passes no `env`" — and it asserts exactly that. An exemption
 * is a decision, and a decision nothing checks is the shape this whole file
 * exists to remove: adding an `env` to the published launcher's spawn would leave
 * the sentence false with the suite green, and that launcher is what `npx
 * local-operator-ui` and the published tarball run.
 */
function exempt(file, name, index, why, site, noEnv) {
	return { file, name, index, guarded: false, why, site, noEnv };
}

const APP_SPAWN_SITES = [
	guarded(
		"scripts/renderer-driver.mjs",
		"spawn",
		1,
		/(?:\{|,)\s*env\s*,/,
		"#190's dev harness, and the rig the incident most likely came through: it boots the real app on a scratch profile",
		/const env = withNotificationsOff\(\{/,
	),
	guarded(
		"scripts/band-occlusion-evidence.mjs",
		"spawn",
		1,
		/(?:\{|,)\s*env\s*,/,
		"boots the built app on a scratch profile to photograph the shell's band geometry, headless",
		/const env = withNotificationsOff\(\{/,
	),
	guarded(
		"scripts/browser-chrome-proof.mjs",
		"spawn",
		1,
		/(?:\{|,)\s*env\s*,/,
		"boots the app to drive the browser-chrome surface on a real profile",
		/const env = withNotificationsOff\(\{/,
	),
	guarded(
		"scripts/browser-challenge-proof.mjs",
		"spawn",
		1,
		/(?:\{|,)\s*env\s*,/,
		"boots a BUILT app tree - `--app-tree`, so the same rig runs against a before and an after tree - headless for the challenge arm and inactive for the real-site one, and drives the browser host over its own /rpc",
		/const env = withNotificationsOff\(\{/,
	),
	guarded(
		"scripts/browser-host-proof.mjs",
		"spawn",
		1,
		/(?:\{|,)\s*env\s*,/,
		"boots the app to measure the browser host end to end",
		/const env = withNotificationsOff\(\{/,
	),
	guarded(
		"scripts/session-cookie-restart-proof.mjs",
		"spawn",
		1,
		/(?:\{|,)\s*env\s*,/,
		"boots the built app twice over a restart, which is two chances to banner",
		/const env = withNotificationsOff\(\{/,
	),
	guarded(
		"scripts/mentioned-files-app-proof.mjs",
		"spawn",
		1,
		/env:\s*\{/,
		"boots the app against the operator's live backend, so its child environment is built as `childEnv` and then handed to the spawn as a literal",
		/withNotificationsOff\(childEnv\);/,
	),
	guarded(
		"scripts/notification-hop-proof.mjs",
		"spawn",
		1,
		/(?:\{|,)\s*env\s*,/,
		"boots the app headless to measure the environment it hands the backend it spawns, so the app and that backend both banner here if the switch is missing",
		/withNotificationsOff\(env\);/,
	),
	guarded(
		"scripts/interrupt-esc-proof.mjs",
		"spawn",
		1,
		/env:\s*spawnEnv,/,
		"drives the composer's interrupt end to end in the real app, against a real backend turn - a stopped turn is exactly the state a notification is posted from, so a missing switch here banners the operator about a stop they just made themselves",
		/const spawnEnv = withNotificationsOff\(\{/,
	),
	exempt(
		"scripts/session-cookie-electron.test.mjs",
		"spawn",
		1,
		"boots a bare Electron scenario bundle - no app, no backend, no `Notification` - so the path that reaches the operator's Notification Center is not reachable from it",
		/env:\s*\{/,
	),
	exempt(
		"scripts/notification-evidence.mjs",
		"spawnSync",
		1,
		"raises real banners ON PURPOSE: it exists so a reviewer can photograph the shipped notifier, and it never boots the app or a backend (it stands a loopback server in for the backend). Invoked by hand - no npm script and no rig calls it",
		/env:\s*\{/,
	),
	exempt(
		"bin/local-operator-ui.js",
		"spawn",
		1,
		"the PUBLISHED launcher, and a person's own app on their own screen: it deliberately passes no `env`, so the caller's environment is inherited and `pnpm app:headless`'s switch or an export of the operator's own reaches it",
		undefined,
		true,
	),
];

/**
 * App-spawning paths a scan for an Electron COMMAND cannot see, named so the
 * list cannot decay into names of files that no longer exist - and, where the
 * guard belongs on one of them, guarded.
 */
const UNSCANNABLE_SPAWN_PATHS = [
	{
		file: "scripts/run-desktop-tests.mjs",
		guarded: true,
		why: "the runner behind `pnpm test:desktop`: it starts node over the suite rather than Electron itself, and the suite's children are what boot the app and start the backend - the ambient-removed case in `run-desktop-tests.test.mjs` reads the switch out of a real child",
	},
	{
		file: "scripts/npx-smoke-test.mjs",
		guarded: false,
		why: "starts the published tarball through `npx` on CI only; the app it boots is a released one that exits after `whenReady`, and it has no session to park on a gate",
	},
	{
		file: "scripts/verify-signed-update.mjs",
		guarded: false,
		why: "starts a packaged app, and `blocked()`s unless it is running on GitHub's own runner - it cannot run on the operator's machine at all",
	},
	{
		file: "scripts/daemon-discovery-evidence.mjs",
		guarded: false,
		why: "starts a real `lop serve` daemon to drive the electron-free discovery modules; nothing creates a session in it, and the announcement this change is about only happens when a session parks on a gate",
	},
];

/** The npm scripts that launch the app, and whether they ask for silence. */
const APP_LAUNCH_SCRIPTS = [
	{
		name: "app:headless",
		guarded: true,
		why: "the agent-driven launch; the switch rides the shell prefix AND is resolved from the launch inside the app, so a `.env` cannot replace it",
	},
	{
		name: "dev:headless",
		guarded: true,
		why: "the agent-driven dev launch. `dev` re-exports the working directory's `.env` inside its own shell, which is why the prefix alone is not the guarantee - the app-side resolution is",
	},
	{
		name: "start",
		guarded: false,
		why: "a person's own app at their own screen",
	},
	{
		name: "dev",
		guarded: false,
		why: "a person's own app at their own screen",
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
		"these start the Electron runtime and are not named in APP_SPAWN_SITES. A new rig fails here on purpose: it is the site most likely to hand the app an environment that can banner the operator",
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
			assert.doesNotMatch(
				site.text,
				/env\s*:/,
				`${where} claims to pass no environment (${row.why}), and now it passes one - either drop the override or drop the exemption`,
			);
		}
		if (!row.guarded) continue;
		assert.match(
			readFileSync(join(process.cwd(), site.file), "utf8"),
			row.binding,
			`${where} boots the app and must build that child's environment with withNotificationsOff (${row.why})`,
		);
	}

	// The scan's own reach, pinned the way `window-mode.test.mjs` pins its
	// recursion: a scan that silently matched nothing would pass every assertion
	// above while guarding nothing at all.
	assert.ok(
		electron.length >= 6,
		`the scan found ${electron.length} Electron spawn sites; the repo has at least the five app-proof rigs and the published launcher`,
	);
	assert.ok(
		[...APP_SPAWN_SITES, ...UNSCANNABLE_SPAWN_PATHS].filter(
			(row) => row.guarded,
		).length >= 6,
		"the guarded rows are the point of this file: the five app-proof rigs plus the suite's own runner",
	);
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
			/withNotificationsOff\(/,
			`${path.file} is guarded because ${path.why}, but the call is gone`,
		);
	}
});

test("the agent-driven npm launches ask for silence and the interactive ones do not", () => {
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
				new RegExp(`${NOTIFICATIONS_ENV}=1`),
				`${row.name} is ${row.why}`,
			);
		} else {
			assert.doesNotMatch(
				body,
				new RegExp(NOTIFICATIONS_ENV),
				`${row.name} is ${row.why}, so it must not carry the switch`,
			);
		}
	}
});
