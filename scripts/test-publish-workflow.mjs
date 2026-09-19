#!/usr/bin/env node
/**
 * Test the actual YAML graph, inline shell gates and pnpm argument forwarding.
 * Packaging/signing are not executed here. Existing builder dependencies supply
 * the YAML and CLI parsers; no second parser or dependency install is needed.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const builderRequire = createRequire(
	require.resolve("electron-builder/package.json"),
);
const appRequire = createRequire(builderRequire.resolve("app-builder-lib"));
const { load } = appRequire("js-yaml");
const builder = require("electron-builder/out/builder");
const workflow = load(
	readFileSync(
		new URL("../.github/workflows/publish.yml", import.meta.url),
		"utf8",
	),
);
const pkg = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const jobs = workflow.jobs;
const steps = (job) => jobs[job].steps;
const step = (job, name) => steps(job).find((s) => s.name === name);
const needsOf = (job) => [].concat(jobs[job].needs || []);
function condition(expression, context) {
	if (!expression) return true;
	const code = expression
		.replace(/^\$\{\{\s*|\s*\}\}$/g, "")
		.replace(/needs\.([\w-]+)\.result/g, 'needs["$1"].result');
	// Expressions come only from the checked-in workflow, not user input. Status
	// functions are deliberately unsupported: they can bypass GitHub's skip gate.
	return Boolean(
		Function(
			...Object.keys(context),
			`return (${code})`,
		)(...Object.values(context)),
	);
}
function graph(event, prerelease = false, forced = {}) {
	const result = {};
	for (const job of Object.keys(jobs)) {
		const needs = Object.fromEntries(
			needsOf(job).map((n) => [n, { result: result[n] }]),
		);
		const success = Object.values(needs).every((n) => n.result === "success");
		const eligible =
			success &&
			condition(jobs[job].if, {
				needs,
				github: { event_name: event, event: { release: { prerelease } } },
			});
		result[job] = eligible ? forced[job] || "success" : "skipped";
	}
	return result;
}
function sandbox(fn) {
	const dir = mkdtempSync(join(tmpdir(), "publish-contract-"));
	try {
		return fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
const cleanEnv = {
	PATH: process.env.PATH,
	HOME: process.env.HOME,
	NODE_PATH: process.env.NODE_PATH || "",
};
function shell(script, env, cwd) {
	return spawnSync(
		"bash",
		["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script],
		{ encoding: "utf8", cwd, env: { ...cleanEnv, ...env } },
	);
}

// The trigger set itself is asserted, not inferred from the matrix below. The
// matrix walks the events it is TOLD about, so a trigger silently disappearing
// from `on:` (or being added back) would shrink this list and every case in it
// would still pass - a release path nothing covers, reported as green.
test("the only way in is a published Release, or a repair dispatch", () => {
	// Two, and only two. `release: published` is the release path, and it works
	// because a PERSON creates the Release: GitHub's anti-recursion rule means a
	// Release published by `GITHUB_TOKEN` starts no run at all, which is why the
	// tag and the Release are cut by hand (`gh release create`, see
	// `.github/RELEASE_TEMPLATE.md`) rather than by a workflow. `workflow_dispatch`
	// is the repair path, which attaches assets and never promotes.
	assert.deepEqual(Object.keys(workflow.on).sort(), [
		"release",
		"workflow_dispatch",
	]);
});

// Every trigger above is simulated here as well: a trigger whose jobs the graph
// tests below do not cover is a trigger whose job wiring nothing checks. There is
// no `repository_dispatch` case because there is no longer such a trigger - the
// automated release that produced one is deleted, and a person's Release reaches
// this workflow through the `release` event directly.
for (const [event, prerelease] of [
	["workflow_dispatch", false],
	["release", false],
	["release", true],
]) {
	test(`${event} prerelease=${prerelease}: every required job reaches upload`, () => {
		const result = graph(event, prerelease);
		assert.ok(
			Object.values(result).every((r) => r === "success"),
			JSON.stringify(result),
		);
		console.log(
			`REACHABLE ${event} prerelease=${prerelease}: ${Object.keys(result).join(" -> ")}`,
		);
	});
	for (const failed of [
		"validate-release",
		"preflight-macos",
		"npm-publish",
		"open-release-window",
		"build-macos",
		"build-windows",
		"build-linux",
	]) {
		for (const status of ["failure", "cancelled", "skipped"]) {
			test(`${event} prerelease=${prerelease}: ${failed} ${status} blocks upload`, () => {
				assert.equal(
					graph(event, prerelease, { [failed]: status })["attach-to-release"],
					"skipped",
				);
			});
		}
	}
}
test("upload requires all platform jobs; no status-function bypass", () => {
	assert.deepEqual(needsOf("attach-to-release").sort(), [
		"build-linux",
		"build-macos",
		"build-windows",
		"validate-release",
	]);
	for (const job of Object.values(jobs))
		assert.doesNotMatch(job.if || "", /always\(|failure\(|cancelled\(/);
});
// The pre-release window. A release is published and then built for 25-35
// minutes; for that whole window /releases/latest answers with it while no
// latest*.yml exists, so every running app filters the 404 into "no updates
// available" (v0.17.2, v0.19.1, v0.19.2). The window has to open before the
// first build and close only once the assets are attached and verified.
const windowJobs = [
	["open-release-window", "open"],
	["finalize-release", "finalize"],
];
const WINDOW_PINS = {
	RELEASE_TAG: "${{ needs.validate-release.outputs.release_tag }}",
	EXPECTED_SOURCE_SHA: "${{ needs.validate-release.outputs.source_sha }}",
	EXPECTED_RELEASE_ID: "${{ needs.validate-release.outputs.release_id }}",
	IS_MANUAL_DISPATCH: "${{ github.event_name == 'workflow_dispatch' }}",
};
function localImports(file, seen = new Set()) {
	// The sparse checkout lists modules by hand, so a module the script imports --
	// directly, or through another module that it imports -- but the checkout omits
	// fails the job at runtime, after the release is already published. Derive the
	// whole transitive set from the script instead of trusting the handwritten list.
	if (seen.has(file)) return [];
	seen.add(file);
	const found = [
		...readFileSync(new URL(`../${file}`, import.meta.url), "utf8").matchAll(
			/from "\.\/([\w.-]+)"/g,
		),
	].map((match) => `scripts/${match[1]}`);
	return [...found, ...found.flatMap((module) => localImports(module, seen))];
}
test("the checkout guard walks imports transitively, not just the direct ones", () => {
	// validate-release.mjs is imported by upload-release.mjs rather than by the
	// window script itself: a direct-import-only walk would leave it out of the
	// sparse checkout and fail the job only after the release was published.
	assert.ok(
		localImports("scripts/release-state.mjs").includes(
			"scripts/validate-release.mjs",
		),
	);
});

test("every scripts checkout in this workflow carries the whole import closure", () => {
	// One rule for every checkout in the file, rather than a closure test per job.
	// The two window jobs are asserted one by one below; this covers the validate
	// job and the attach job as well, and it is the general form of a defect that is
	// not hypothetical: when all the release scripts moved their entry-point
	// comparison into `scripts/entry-point.mjs`, EVERY handwritten list that names
	// one of them became incomplete at once, in a file none of those scripts lives
	// in, and would have failed at IMPORT time on a runner rather than here.
	let checkouts = 0;
	for (const job of Object.keys(jobs)) {
		for (const s of steps(job)) {
			const listed = s.with?.["sparse-checkout"];
			if (typeof listed !== "string") continue;
			const scripts = [
				...listed.matchAll(/^\s*(scripts\/[\w.-]+\.mjs)\s*$/gm),
			].map((match) => match[1]);
			if (scripts.length === 0) continue;
			checkouts += 1;
			for (const module of scripts.flatMap((file) => localImports(file)))
				assert.match(
					listed,
					new RegExp(`^\\s*${module.replace(/\./g, "\\.")}\\s*$`, "m"),
					`${module} missing from ${job}'s checkout`,
				);
		}
	}
	// The count is the point of the assertion: a fifth checkout is a new list this
	// test has just started covering, and a missing one would mean this test stopped
	// looking at a job without saying so.
	assert.ok(
		checkouts >= 4,
		`only ${checkouts} scripts checkouts found in publish.yml`,
	);
});
for (const [job, mode] of windowJobs) {
	test(`${job} runs ${mode} with both pins and its imports checked out`, () => {
		const run = steps(job).find((step) => step.run);
		assert.equal(run.run, `node workflow/scripts/release-state.mjs ${mode}`);
		assert.deepEqual(run.env, {
			...WINDOW_PINS,
			GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
		});
		const checkout = step(job, "Checkout workflow scripts");
		assert.equal(checkout.with.ref, "${{ github.workflow_sha }}");
		assert.equal(checkout.with.path, "workflow");
		for (const module of localImports("scripts/release-state.mjs"))
			assert.match(
				checkout.with["sparse-checkout"],
				new RegExp(`^\\s*${module.replace(/\./g, "\\.")}\\s*$`, "m"),
				`${module} missing from ${job}'s checkout`,
			);
		// Both mutations need contents: write. A read-only override here would
		// fail the PATCH, which is the whole point of the job.
		assert.ok(!("permissions" in jobs[job]));
	});
}
// A refused writeup (the window job failing) has to stop everything that can
// ship something, and `npm-publish` is the one that does not look like shipping:
// it is a sibling of the window job rather than a descendant of it, and Actions
// only gates a job on its own `needs`, never on a sibling's failure. With the
// edge absent, a Release whose notes were refused published to npm while every
// installer was skipped. This case is the assertion that keeps the edge there.
for (const [label, forced] of [
	["cannot be held", { "open-release-window": "failure" }],
]) {
	test(`a release that ${label} stops every build and the npm publish`, () => {
		const result = graph("release", false, forced);
		for (const job of [
			"npm-publish",
			"build-macos",
			"build-windows",
			"build-linux",
			"attach-to-release",
			"finalize-release",
		])
			assert.equal(result[job], "skipped", job);
	});
}
test("the window opens before every build and closes only after attach", () => {
	assert.deepEqual(needsOf("open-release-window"), ["validate-release"]);
	for (const job of [
		"npm-publish",
		"build-macos",
		"build-windows",
		"build-linux",
	]) {
		assert.ok(needsOf(job).includes("open-release-window"), job);
		assert.match(
			jobs[job].if,
			/needs\.open-release-window\.result == 'success'/,
			job,
		);
	}
	assert.deepEqual(needsOf("finalize-release").sort(), [
		"attach-to-release",
		"validate-release",
	]);
	assert.match(
		jobs["finalize-release"].if,
		/needs\.attach-to-release\.result == 'success'/,
	);
});
test("window scoping is the event variable, never a job that a repair skips", () => {
	// A repair has to keep running the builds and the attach, so scoping the
	// mutation with `if: github.event_name == 'release'` would either skip the
	// repair or hold a build behind a job that never ran. The scoping is the
	// script's IS_MANUAL_DISPATCH refusal, and both jobs stay reachable.
	const dispatch = graph("workflow_dispatch", false);
	for (const [job] of windowJobs) {
		assert.doesNotMatch(jobs[job].if || "", /event_name/);
		assert.equal(dispatch[job], "success", job);
	}
	for (const event of ["release", "workflow_dispatch"])
		assert.equal(
			graph(event, event === "release")["finalize-release"],
			"success",
		);
	// The window is a dependency of `npm-publish` too, so the dispatch path is the
	// case worth pinning: a repair must still REACH the npm job (the window job
	// returns success there, having only refused to mutate), and the registry write
	// stays skipped by that job's own event guard rather than by this edge.
	assert.equal(graph("workflow_dispatch", false)["npm-publish"], "success");
});
test("a failed promotion is terminal and cannot cascade", () => {
	// The promotion is the last job and nothing needs it, so a failed PATCH (the
	// script exits non-zero; its refusal paths are covered in
	// test-release-safety.mjs) fails the run after the assets are attached rather
	// than leaving a release promoted by a later job's success.
	assert.ok(
		!Object.values(jobs).some((definition) =>
			(definition.needs || []).includes("finalize-release"),
		),
	);
	assert.equal(Object.keys(jobs).at(-1), "finalize-release");
});
test("every job is declared after the jobs it needs", () => {
	// This harness resolves each job's needs from the results already computed,
	// in file order, so a job declared above one of its needs would be simulated
	// as skipped and the graph tests above would quietly stop covering it.
	const order = Object.keys(jobs);
	for (const job of order)
		for (const need of needsOf(job))
			assert.ok(
				order.indexOf(need) < order.indexOf(job),
				`${job} needs ${need}, which is declared later`,
			);
});
test("payload checkouts use validated source, helper checkouts use workflow SHA", () => {
	for (const job of [
		"npm-publish",
		"build-macos",
		"build-windows",
		"build-linux",
	]) {
		assert.equal(
			step(job, "Checkout code").with.ref,
			"${{ needs.validate-release.outputs.source_sha }}",
		);
	}
	for (const job of ["validate-release", "attach-to-release"]) {
		assert.equal(
			step(job, "Checkout workflow scripts").with.ref,
			"${{ github.workflow_sha }}",
		);
	}
	const upload = step(
		"attach-to-release",
		"Revalidate and attach artifacts to existing release",
	);
	assert.equal(upload.run, "node workflow/scripts/upload-release.mjs");
	assert.equal(
		upload.env.EXPECTED_SOURCE_SHA,
		"${{ needs.validate-release.outputs.source_sha }}",
	);
	assert.equal(
		upload.env.EXPECTED_RELEASE_ID,
		"${{ needs.validate-release.outputs.release_id }}",
	);
	assert.match(
		step("attach-to-release", "Checkout workflow scripts").with[
			"sparse-checkout"
		],
		/scripts\/upload-release.mjs/,
	);
	assert.equal(
		step("attach-to-release", "Checkout workflow scripts").with.path,
		"workflow",
	);
});
for (const event of ["release", "workflow_dispatch"]) {
	for (const published of ["true", "false"]) {
		test(`npm publish guard event=${event}, published=${published}`, () => {
			assert.equal(
				condition(step("npm-publish", "Publish to npm").if, {
					github: { event_name: event },
					steps: { check_version: { outputs: { published } } },
				}),
				// The npm channel ships on every publication and on no repair. It
				// used to be keyed on the `release` event, which was the same set
				// of runs only while that event was the only way in: under the
				// automated publication it would have shipped installers while
				// silently skipping npm.
				event !== "workflow_dispatch" && published === "false",
			);
		});
	}
}
for (const [label, output, exitCode] of [
	["exists", "0.14.1", 0],
	["absent", "", 1],
	["registry unavailable", "", 42],
	["wrong version", "0.14.0", 0],
]) {
	for (const manual of [true, false]) {
		test(`npm registry ${label}, manual=${manual}: actual shell gate`, () =>
			sandbox((dir) => {
				writeFileSync(
					join(dir, "package.json"),
					JSON.stringify({ name: "local-operator-ui", version: "0.14.1" }),
				);
				writeFileSync(
					join(dir, "npm"),
					`#!/bin/sh\nprintf '%s\\n' '${output}'\nexit ${exitCode}\n`,
					{ mode: 0o755 },
				);
				const result = shell(
					step("npm-publish", "Check if version already published").run,
					{
						PATH: `${dir}:${process.env.PATH}`,
						IS_MANUAL_DISPATCH: String(manual),
						GITHUB_OUTPUT: join(dir, "outputs"),
					},
					dir,
				);
				assert.equal(
					result.status,
					manual && label !== "exists" ? 1 : 0,
					result.stderr,
				);
				if (result.status === 0)
					assert.equal(
						readFileSync(join(dir, "outputs"), "utf8").trim(),
						`published=${label === "exists"}`,
					);
			}));
	}
}
// The .jsc guard must gate the PUBLISH path, not just ci.yml. ci.yml triggers
// on push to main/dev-*, so it protects the branch; a workflow_dispatch repair
// or a tag from a commit whose CI never ran reaches npm publish ungated.
// Run the real step's shell against real tarballs, both directions.
for (const [label, entries, expected] of [
	[
		"real npm-channel tarball",
		["package/out/main/index.js", "package/bin/local-operator-ui.js"],
		0,
	],
	[
		"synthetic bytecode tarball",
		["package/out/main/index.js", "package/out/main/index.jsc"],
		1,
	],
]) {
	test(`publish-path bytecode guard rejects ${label}: actual shell gate`, () =>
		sandbox((dir) => {
			mkdirSync(join(dir, "package", "out", "main"), { recursive: true });
			mkdirSync(join(dir, "package", "bin"), { recursive: true });
			for (const entry of entries)
				writeFileSync(join(dir, entry), "// fixture\n");
			// `npm pack` is stubbed so the gate is tested against a known tarball rather
			// than a real 100MB+ build; the assertion under test is the tar|grep, and it
			// reads whatever npm pack left on disk either way.
			const tarball = "local-operator-ui-0.14.1.tgz";
			spawnSync(
				"tar",
				["czf", tarball, ...entries.map((e) => e.replace(/^package\//, ""))],
				{ cwd: join(dir, "package") },
			);
			spawnSync("mv", [join(dir, "package", tarball), dir]);
			writeFileSync(join(dir, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
			const result = shell(
				step("npm-publish", "Pack and assert the tarball ships no V8 bytecode")
					.run,
				{
					PATH: `${dir}:${process.env.PATH}`,
					GITHUB_OUTPUT: join(dir, "outputs"),
				},
				dir,
			);
			assert.equal(
				result.status,
				expected,
				`${label}: ${result.stdout}${result.stderr}`,
			);
			if (expected === 0) {
				assert.equal(
					readFileSync(join(dir, "outputs"), "utf8").trim(),
					`tarball=${tarball}`,
				);
			} else {
				assert.match(result.stdout, /\.jsc/);
			}
			console.log(`PUBLISH_GUARD ${label}: exit ${result.status}`);
		}));
}
test("publish uses the asserted tarball, never a fresh unpacked build", () => {
	// `npm publish` with no argument re-runs prepack and ships an artifact the
	// step above never saw. The tarball reference is what ties the two together.
	const publish = step("npm-publish", "Publish to npm");
	assert.match(publish.run, /npm publish "\$\{TARBALL\}" --provenance/);
	assert.equal(publish.env.TARBALL, "${{ steps.pack.outputs.tarball }}");
	assert.equal(
		step("npm-publish", "Pack and assert the tarball ships no V8 bytecode").id,
		"pack",
	);
	// Both steps must share the publish gate, or the pack step runs when the
	// publish step does not and vice versa.
	assert.equal(
		step("npm-publish", "Pack and assert the tarball ships no V8 bytecode").if,
		publish.if,
	);
});
test("electron pins move together across the npm and installer channels", () => {
	// electron-builder never reads optionalDependencies, so without the explicit
	// build.electronVersion the installers silently take whatever is in
	// node_modules. Two declarations, one runtime: fail if they drift.
	assert.equal(pkg.build.electronVersion, pkg.optionalDependencies.electron);
	assert.match(
		pkg.optionalDependencies.electron,
		/^\d+\.\d+\.\d+$/,
		"the pin must be exact, not a range",
	);
});

const preflight = step("preflight-macos", "Check required secrets");
const signingEnv = {
	NOTARIZE: workflow.env.NOTARIZE,
	...Object.fromEntries(
		Object.keys(preflight.env).map((k) => [
			k,
			"fixture-secret-value-never-log",
		]),
	),
};
test("signing preflight accepts complete credentials", () =>
	assert.equal(shell(preflight.run, signingEnv).status, 0));
for (const name of Object.keys(signingEnv)) {
	test(`signing preflight rejects missing ${name} without exposing values`, () => {
		const result = shell(preflight.run, { ...signingEnv, [name]: "" });
		assert.equal(result.status, 1);
		assert.match(result.stdout, new RegExp(name));
		assert.doesNotMatch(result.stdout + result.stderr, /fixture-secret-value/);
	});
}
test("NOTARIZE=false is rejected", () =>
	assert.equal(
		shell(preflight.run, { ...signingEnv, NOTARIZE: "false" }).status,
		1,
	));
test("mac signing uses imported keychain without CSC_LINK, keeps notarization", () => {
	assert.equal(workflow.env.NOTARIZE, "true");
	const mac = step("build-macos", "Build macOS app");
	assert.ok(!("NOTARIZE" in mac.env));
	assert.ok(!("CSC_LINK" in mac.env));
	for (const key of ["APPLE_ID", "APPLE_ID_PASSWORD", "APPLE_TEAM_ID"])
		assert.equal(mac.env[key], preflight.env[key]);
	const setup = step("build-macos", "Setup code signing").run;
	assert.match(setup, /CSC_KEYCHAIN=\"\$RUNNER_TEMP\/build.keychain-db\"/);
	assert.match(setup, /echo "CSC_KEYCHAIN=\$CSC_KEYCHAIN" >> "\$GITHUB_ENV"/);
	assert.match(
		setup,
		/set-key-partition-list .* -k "\$KEYCHAIN_PASSWORD" "\$CSC_KEYCHAIN"/,
	);
	for (const job of ["build-windows", "build-linux"])
		assert.ok(!JSON.stringify(jobs[job]).includes("forceCodeSigning"));
});
test("the macOS app is codesigned with a RENDERED entitlements plist carrying the WebAuthn access group", () => {
	// The group is `<TEAM_ID>.<BUNDLE_ID>.webauthn` and the team id is a secret, so
	// the committed plist cannot carry it: the render step is what puts it in, and
	// the build has to consume the rendered file for both the app and the helpers
	// it inherits (`entitlementsInherit`).
	const macSteps = steps("build-macos").map((s) => s.name);
	const render = step("build-macos", "Render the macOS entitlements plist");
	assert.ok(render, "the entitlements render step exists");
	assert.ok(
		macSteps.indexOf("Render the macOS entitlements plist") <
			macSteps.indexOf("Build macOS app"),
		"the plist is rendered before the build that consumes it",
	);
	assert.deepEqual(
		render.env,
		{ APPLE_TEAM_ID: "${{ secrets.APPLE_TEAM_ID }}" },
		"the team id comes from the secret and from nothing else",
	);
	assert.match(
		render.run,
		/node scripts\/render-mac-entitlements\.mjs --out "\$RUNNER_TEMP\/entitlements\.mac\.plist"/,
	);
	assert.match(
		render.run,
		/echo "ENTITLEMENTS_PLIST=\$RUNNER_TEMP\/entitlements\.mac\.plist" >> "\$GITHUB_ENV"/,
	);
	const build = step("build-macos", "Build macOS app");
	assert.match(build.run, /-c\.mac\.entitlements="\$ENTITLEMENTS_PLIST"/);
	assert.match(
		build.run,
		/-c\.mac\.entitlementsInherit="\$ENTITLEMENTS_PLIST"/,
	);
	// The committed plist stays secret-free and carries no group: every local build
	// signs with it, and a group there would be a team id in the repository plus a
	// signature no developer's identity can honour.
	const committed = readFileSync(
		new URL("../build/entitlements.mac.plist", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(committed, /keychain-access-groups/);
	for (const job of ["build-windows", "build-linux"])
		assert.ok(!JSON.stringify(jobs[job]).includes("ENTITLEMENTS_PLIST"));
});
test("keychain password is generated per job, masked, and never a repository dependency", () => {
	assert.ok(!("KEYCHAIN_PASSWORD" in preflight.env));
	assert.doesNotMatch(preflight.run, /KEYCHAIN_PASSWORD/);
	assert.doesNotMatch(JSON.stringify(workflow), /secrets\.KEYCHAIN_PASSWORD/);
	assert.deepEqual(Object.keys(preflight.env).sort(), [
		"APPLE_ID",
		"APPLE_ID_PASSWORD",
		"APPLE_TEAM_ID",
		"CSC_CONTENT",
		"CSC_KEY_PASSWORD",
	]);
	const setup = step("build-macos", "Setup code signing");
	assert.ok(!("KEYCHAIN_PASSWORD" in setup.env));
	assert.match(setup.run, /KEYCHAIN_PASSWORD="\$\(openssl rand -hex 32\)"/);
});
test("actual signing setup masks one random password and passes it consistently", () => {
	const digests = [0, 1].map(() =>
		sandbox((dir) => {
			// Only security is stubbed: execute the checked-in shell, real OpenSSL
			// generation, base64 decoding and cleanup. Persist hashes, never passwords.
			writeFileSync(
				join(dir, "security"),
				`#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const args = process.argv.slice(2);
const command = args[0];
const flag = command === 'set-key-partition-list' ? '-k' : '-p';
const password = ['create-keychain', 'unlock-keychain', 'set-key-partition-list'].includes(command) ? args[args.indexOf(flag) + 1] : undefined;
appendFileSync(process.env.CALLS_FILE, JSON.stringify({ command, keychain: args.at(-1), flags: args.slice(1, -1).filter((a) => a.startsWith('-')), passwordShape: password ? /^[a-f0-9]{64}$/.test(password) : null, digest: password ? createHash('sha256').update(password).digest('hex') : null }) + '\\n');
console.log('SECURITY_CALLED');
`,
				{ mode: 0o755 },
			);
			const result = shell(
				step("build-macos", "Setup code signing").run,
				{
					PATH: `${dir}:${process.env.PATH}`,
					RUNNER_TEMP: dir,
					GITHUB_ENV: join(dir, "env"),
					CALLS_FILE: join(dir, "calls"),
					CSC_CONTENT: Buffer.from("fixture-p12").toString("base64"),
					CSC_KEY_PASSWORD: "fixture-p12-password",
				},
				dir,
			);
			// Avoid including captured stdout in assertion errors: the Actions mask
			// command necessarily contains the value, but no test output may reveal it.
			assert.equal(result.status, 0, "signing setup shell must succeed");
			const lines = result.stdout.trim().split("\n");
			assert.ok(
				/^::add-mask::[a-f0-9]{64}$/.test(lines[0]),
				"mask must precede every security invocation",
			);
			const password = lines[0].slice("::add-mask::".length);
			const digest = createHash("sha256").update(password).digest("hex");
			assert.ok(!result.stderr.includes(password));
			assert.deepEqual(lines.slice(1), Array(7).fill("SECURITY_CALLED"));
			const calls = readFileSync(join(dir, "calls"), "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			assert.deepEqual(
				calls.map((c) => c.command),
				[
					"create-keychain",
					"default-keychain",
					"unlock-keychain",
					"set-keychain-settings",
					"show-keychain-info",
					"import",
					"set-key-partition-list",
				],
			);
			// Regression for run 33948569170: a fresh keychain auto-locks after 300s and
			// codesign then hangs on a GUI prompt. The settings call must follow unlock,
			// precede import/partition-list, and carry no -t timeout or -l lock flag.
			const settings = calls.find((c) => c.command === "set-keychain-settings");
			assert.equal(settings.keychain, join(dir, "build.keychain-db"));
			assert.deepEqual(
				settings.flags,
				[],
				"set-keychain-settings must remove the timeout, not set one",
			);
			assert.ok(
				!settings.passwordShape,
				"keychain settings do not take the password",
			);
			const passwordCalls = calls.filter((c) => c.digest);
			assert.equal(passwordCalls.length, 3);
			assert.ok(
				passwordCalls.every((c) => c.passwordShape && c.digest === digest),
				"create/unlock/partition must share the generated 32-byte password",
			);
			assert.ok(
				calls
					.filter((c) => c.command !== "import")
					.every((c) => c.keychain === join(dir, "build.keychain-db")),
			);
			assert.equal(
				calls.findIndex((c) => c.command === "set-keychain-settings") -
					calls.findIndex((c) => c.command === "unlock-keychain"),
				1,
				"settings must be applied immediately after unlock",
			);
			assert.equal(
				readFileSync(join(dir, "env"), "utf8"),
				`CSC_KEYCHAIN=${join(dir, "build.keychain-db")}\n`,
			);
			assert.ok(
				!existsSync(join(dir, "certificate.p12")),
				"temporary certificate must be removed",
			);
			return digest;
		}),
	);
	assert.notEqual(
		digests[0],
		digests[1],
		"each job must generate a fresh password",
	);
	console.log(
		"SIGNING_SHELL: 2 fresh 32-byte passwords; mask before use; create/unlock/partition equal; set-keychain-settings after unlock with no timeout; only keychain path persisted",
	);
});
test("failed random generation stops before keychain setup", () =>
	sandbox((dir) => {
		writeFileSync(join(dir, "openssl"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
		writeFileSync(join(dir, "security"), "#!/bin/sh\necho SECURITY_CALLED\n", {
			mode: 0o755,
		});
		const result = shell(
			step("build-macos", "Setup code signing").run,
			{
				PATH: `${dir}:${process.env.PATH}`,
				RUNNER_TEMP: dir,
				GITHUB_ENV: join(dir, "env"),
			},
			dir,
		);
		assert.equal(result.status, 1);
		assert.equal(result.stdout, "");
		assert.ok(!existsSync(join(dir, "env")));
	}));
test("actual pnpm forwarding and electron-builder parser enforce signing", async () => {
	const captures = sandbox((dir) => {
		// Preserve the real dist script. Only its expensive build and packaging
		// executables are replaced at the process boundary to capture actual argv.
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				scripts: { build: "node -e ''", "dist:mac": pkg.scripts["dist:mac"] },
			}),
		);
		mkdirSync(join(dir, "bin"));
		writeFileSync(
			join(dir, "bin", "electron-builder"),
			'#!/usr/bin/env node\nconsole.log("BUILDER_ARGV="+JSON.stringify(process.argv.slice(2)));\n',
			{ mode: 0o755 },
		);
		return [
			["pnpm dist:mac -- -c.forceCodeSigning=true", false],
			[step("build-macos", "Build macOS app").run, true],
		].map(([command, shouldForce]) => {
			const result = shell(
				command,
				{ PATH: `${join(dir, "bin")}:${process.env.PATH}` },
				dir,
			);
			assert.equal(result.status, 0, result.stderr);
			const args = JSON.parse(
				result.stdout
					.split("\n")
					.find((line) => line.startsWith("BUILDER_ARGV="))
					.slice(13),
			);
			const parsed = builder
				.configureBuildCommand(builder.createYargs())
				.parse(args);
			const options = builder.normalizeOptions(parsed);
			return { command, shouldForce, args, options };
		});
	});
	for (const { command, shouldForce, args, options } of captures) {
		// AJV performs boolean coercion after yargs and normalizeOptions.
		await appRequire("./util/config/config").validateConfiguration(
			options.config || {},
			{ add() {} },
		);
		assert.equal(
			options.config?.forceCodeSigning === true,
			shouldForce,
			JSON.stringify({ args, options }),
		);
		console.log(
			`ACTUAL ${command}: argv=${JSON.stringify(args)} forceCodeSigning=${options.config?.forceCodeSigning}`,
		);
	}
});
