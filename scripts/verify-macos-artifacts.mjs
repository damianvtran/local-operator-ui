#!/usr/bin/env node
/**
 * Assert that the macOS release artifacts are actually installable.
 *
 * Why this exists: the 0.17.0 release shipped an app that was signed,
 * notarized and stapled, and a DMG that was none of those things
 * (`dmg.sign: false`, `mac.notarize: false`, only the app notarized by the
 * `afterSign` hook). `codesign --verify --deep --strict` on the app passed, so
 * nothing in the pipeline noticed; on a user's machine the freshly downloaded
 * image reported `rejected / source=no usable signature` to
 * `spctl -a -vvv -t open --context context:primary-signature`. The checks below
 * are the ones a user's Gatekeeper performs, run against the real artifacts
 * before they are attached to a release.
 *
 * Every check is a hard failure: a release that cannot be opened is worse than a
 * release that is late.
 *
 * Usage: node scripts/verify-macos-artifacts.mjs [--dist dist] [--app path] [--dmg path]
 * Exit: 0 when every check passes, 1 otherwise (including when an artifact is missing).
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CODESIGN = "/usr/bin/codesign";
const SPCTL = "/usr/sbin/spctl";
const XCRUN = "/usr/bin/xcrun";

/**
 * The checks, in the order a user's machine performs them.
 *
 * `expect` is a predicate over the raw result rather than an exit code: `spctl`
 * answers "accepted" on stdout for a Developer ID signature and "rejected" for
 * everything else, and both of those can exit 0 - so the verdict has to read
 * the output, not the status that reports whether spctl itself ran.
 */
export function artifactChecks({ appPath, dmgPath }) {
	const checks = [];
	if (appPath) {
		checks.push(
			{
				id: "app-codesign",
				scope: "app",
				target: appPath,
				description: "codesign --verify --deep --strict on the app",
				command: CODESIGN,
				args: ["--verify", "--deep", "--strict", "--verbose=2", appPath],
				expect: (result) => result.status === 0,
			},
			{
				id: "app-spctl",
				scope: "app",
				target: appPath,
				description: "spctl -a -vvv -t exec on the app",
				command: SPCTL,
				args: ["-a", "-vvv", "-t", "exec", appPath],
				expect: (result) => /accepted/.test(`${result.stdout}${result.stderr}`),
			},
			{
				id: "app-stapler",
				scope: "app",
				target: appPath,
				description: "stapler validate on the app",
				command: XCRUN,
				args: ["stapler", "validate", appPath],
				expect: (result) => result.status === 0,
			},
		);
	}
	if (dmgPath) {
		checks.push(
			{
				id: "dmg-spctl",
				scope: "dmg",
				target: dmgPath,
				description: "spctl -a -vvv -t open on the disk image",
				// context:primary-signature asks about the image's own signature -
				// the one a quarantined download is judged by - rather than about
				// the app inside it.
				command: SPCTL,
				args: [
					"-a",
					"-vvv",
					"-t",
					"open",
					"--context",
					"context:primary-signature",
					dmgPath,
				],
				expect: (result) => /accepted/.test(`${result.stdout}${result.stderr}`),
			},
			{
				id: "dmg-stapler",
				scope: "dmg",
				target: dmgPath,
				description: "stapler validate on the disk image",
				command: XCRUN,
				args: ["stapler", "validate", dmgPath],
				expect: (result) => result.status === 0,
			},
		);
	}
	return checks;
}

/** Run each check with the given runner and judge it. */
export function runChecks({ appPath, dmgPath, run }) {
	return artifactChecks({ appPath, dmgPath }).map((check) => {
		const result = run(check.command, check.args);
		const passed = check.expect(result);
		return {
			id: check.id,
			scope: check.scope,
			description: check.description,
			target: check.target,
			passed,
			output: [result.stdout, result.stderr]
				.join("\n")
				.trim()
				.split("\n")
				.filter((line) => line.trim().length > 0)
				.slice(0, 4)
				.join(" | "),
		};
	});
}

export function summarize(results) {
	const failures = results.filter((result) => !result.passed);
	return { ok: failures.length === 0, failures };
}

/** The packaged app inside a `dist` directory, if the build produced one. */
export function discoverApp(distDir, { listDir = readdirSync } = {}) {
	if (!existsSync(distDir)) return null;
	for (const entry of listDir(distDir)) {
		const candidate = join(distDir, entry);
		if (!entry.startsWith("mac") || !statSync(candidate).isDirectory()) continue;
		for (const inner of listDir(candidate)) {
			if (inner.endsWith(".app")) return join(candidate, inner);
		}
	}
	return null;
}

export function discoverDmg(distDir, { listDir = readdirSync } = {}) {
	if (!existsSync(distDir)) return null;
	const match = listDir(distDir).find((entry) => entry.endsWith(".dmg"));
	return match ? join(distDir, match) : null;
}

/** `spawnSync` runner: the real thing, used by the CLI. */
export function spawnRunner(command, args) {
	const result = spawnSync(command, args, { encoding: "utf8" });
	return {
		status: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? result.error?.message ?? "",
	};
}

function parseArgs(argv) {
	const args = { dist: "dist", app: null, dmg: null };
	for (let index = 0; index < argv.length; index++) {
		if (argv[index] === "--dist") args.dist = argv[index + 1];
		if (argv[index] === "--app") args.app = argv[index + 1];
		if (argv[index] === "--dmg") args.dmg = argv[index + 1];
	}
	return args;
}

export function verifyArtifacts({
	dist = "dist",
	app = null,
	dmg = null,
	run = spawnRunner,
	log = console.log,
} = {}) {
	const appPath = app ?? discoverApp(dist);
	const dmgPath = dmg ?? discoverDmg(dist);

	if (!appPath || !existsSync(appPath)) {
		log(`No packaged app found under ${dist}`);
		return { ok: false, results: [] };
	}
	if (!dmgPath || !existsSync(dmgPath)) {
		log(`No disk image found under ${dist}`);
		return { ok: false, results: [] };
	}

	log(`Checking app: ${appPath}`);
	log(`Checking disk image: ${dmgPath}`);
	const results = runChecks({ appPath, dmgPath, run });
	for (const result of results) {
		log(
			`${result.passed ? "PASS" : "FAIL"} ${result.id}: ${result.description}${result.passed ? "" : ` -> ${result.output}`}`,
		);
	}
	const { ok, failures } = summarize(results);
	if (!ok) {
		log(
			`\n${failures.length} of ${results.length} artifact checks failed. The release must not be published until the disk image is signed, notarized and stapled.`,
		);
	}
	return { ok, results };
}

const isMain =
	process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
	const args = parseArgs(process.argv.slice(2));
	const { ok } = verifyArtifacts(args);
	process.exit(ok ? 0 : 1);
}
