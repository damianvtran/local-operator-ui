#!/usr/bin/env node
/**
 * Every workflow that packages macOS builds ONE architecture per pass, covers
 * BOTH architectures the release ships, keeps the update feed whole, and gates
 * the promotion on the artifact verification.
 *
 * WHY THIS FILE EXISTS. The v0.30.10 brick was fixed in `publish.yml` (one
 * `electron-vite build` cannot serve both architectures: `pnpm run build` emits
 * V8 bytecode against `node_modules/electron/dist`, whose arch follows the HOST,
 * so a single `electron-builder --mac --arm64 --x64` packed the arm64 runner's
 * bytecode into the x64 bundle and every launch died with
 * `cachedDataRejected`). The fix went into the workflow that was read at the
 * time - `publish.yml` - and `scripts/test-publish-workflow.mjs` grew the
 * per-architecture contract beside it.
 *
 * It did not cover the OTHER workflow that packages the same bundles.
 * `signed-update-candidate.yml` kept the one-pass shape, so its
 * `app-bytecode-loadable` check failed on the x64 candidate of every release
 * from the day the check landed - measured on v0.30.15, run 35833917102:
 * `3 of 101 artifact checks failed`, all three the same x64 `.jsc`, while the
 * released artifacts from `publish.yml` were fine. A verification that is
 * permanently red for a reason nobody ships reads exactly like a verification
 * that works, which is how a real FAIL gets ignored.
 *
 * So the contract is stated over the WHOLE workflow directory rather than over
 * the file that was under review, and it names the four properties a release
 * depends on, each of which has a measured failure behind it:
 *
 *  1. no packaging pass produces more than ONE architecture, and the Electron
 *     dist it fetches (`npm_config_arch`) is the architecture it names - the
 *     dist is removed between passes because `ensure-electron.js`'s fast path
 *     keys on `dist/version`, so pass two would otherwise reuse pass one's
 *     runtime;
 *  2. the workflow's passes COVER both `arm64` and `x64`. One pass per
 *     architecture is only half of the property: deleting a pass leaves the
 *     other assertions green, and nothing else in the tree would notice, because
 *     the candidate harness asserts only the RUNNER's own architecture
 *     (`verify-signed-update.mjs`, the `-${process.arch}.zip` predicates) - so
 *     without this the audit could silently audit one architecture;
 *  3. a workflow with two macOS passes merges the update feed across them, or
 *     the second pass's `latest-mac.yml` describes only the second architecture
 *     and every user on the first is told there is no update;
 *  4. promoting a Release stays unreachable without the macOS artifact gate,
 *     and that gate is the one carrying the bytecode probe - the invariant
 *     AGENTS.md states as "the artifact gate is the safety net that makes a
 *     release from a tag defensible";
 *  5. every step that notarises CAN notarise, because both halves of it skip
 *     QUIETLY when `NOTARIZE`/`APPLE_*` are absent: one log line and exit 0, which
 *     is a pass as far as `scripts/require-report.sh` can tell (its check is
 *     emptiness, not meaning). The artifact verification DOES refuse an unnotarised
 *     image, one step later - both `dmg-spctl` rows answered `rejected |
 *     source=Unnotarized Developer ID` in run 35846109424, `4 of 101 artifact checks
 *     failed`, on disk images that were otherwise perfectly signed - so the realised
 *     cost of the step split was a red candidate verification and a whole wasted
 *     two-pass macOS build, NOT a shipped image. The disk-image step refuses a skip
 *     itself (`scripts/require-notarized-dmg.sh`), so that failure lands where it
 *     belongs, and the assertions below keep the flag and the credentials on the
 *     steps that need them.
 *
 * HOW A PASS IS READ, and why it is read this way. A `pnpm <script>` step is not
 * the command it runs: `pnpm dist:all` is `pnpm run build && electron-builder
 * -mwl --publish never`, `pnpm dist:mac` is the same with `--mac`, and a watch
 * of the step's own text sees neither the packer nor the platform it selected -
 * the shape that made this contract blind to `pnpm dist:all`. The steps are
 * therefore TOKENIZED by `scripts/check-build-env.mjs`'s exported
 * `commandSegments` (one tokenizer for "what does this `run:` block execute",
 * comments and quoting included) and each `pnpm <script>` segment is replaced by
 * the segments of that script's body in package.json, up to the same hop cap
 * that file uses. Arguments the step forwards (`--arm64`) are appended to the
 * LAST segment of the body, which is where pnpm puts them, so the argv this file
 * classifies is the argv electron-builder actually receives - proven against the
 * real CLI in `scripts/test-publish-workflow.mjs`.
 *
 * WHAT THIS DOES NOT DO. It reads YAML and source text, so it cannot prove a
 * build produces the right bytes - only that no workflow is shaped to produce
 * the wrong ones. Two boundaries worth stating rather than discovering: a pass
 * that names NO platform at all is treated as macOS-inclusive, because
 * electron-builder builds for the host and every packaging job in this
 * repository runs on `macos-latest` (the direction is deliberate: a shape this
 * file cannot classify fails loudly instead of passing unread, and the remedy is
 * to name the platform); and a build reached through a `uses:` composite action
 * is invisible here, the same boundary `check-build-env.mjs` documents. And
 * `mac.target` is deliberately not asserted per workflow: the candidate build
 * runs on a commit the dispatch names rather than on `main`, so its config is
 * whatever that tree says - which is exactly why the ARCH FLAG, and not the
 * config, is what this file requires each pass to pin.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PACKAGER_COMMANDS, commandSegments } from "./check-build-env.mjs";

const require = createRequire(import.meta.url);
const builderRequire = createRequire(
	require.resolve("electron-builder/package.json"),
);
const appRequire = createRequire(builderRequire.resolve("app-builder-lib"));
const { load } = appRequire("js-yaml");

/** The repository root, so the gates under `scripts/` can be run by absolute path. */
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The workflows, keyed by file name, parsed rather than grepped. */
const WORKFLOWS = new Map(
	readdirSync(new URL("../.github/workflows/", import.meta.url))
		.filter((name) => name.endsWith(".yml"))
		.sort()
		.map((name) => [
			name,
			load(
				readFileSync(
					new URL(`../.github/workflows/${name}`, import.meta.url),
					"utf8",
				),
			),
		]),
);

/** The scripts a `pnpm <script>` step can expand into. */
const PACKAGE_SCRIPTS = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).scripts;

/**
 * Both macOS architectures a release ships, and the flag that names each.
 *
 * `universal` is deliberately NOT a way to name them: a universal bundle holds
 * one `out/main/index.jsc`, so it carries one architecture's bytecode for the
 * other one - the brick with the sign flipped, which is why it is rejected
 * rather than counted as coverage.
 */
const MAC_ARCHITECTURES = new Map([
	["--arm64", "arm64"],
	["--x64", "x64"],
]);
/** Commands that run another command, so the word after them is not the command. */
const WRAPPERS = new Set([
	"command",
	"env",
	"nice",
	"nohup",
	"npx",
	"sudo",
	"time",
	"xargs",
]);

/** A shell assignment word (`VAR=value`), which `env` and inline prefixes use. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Drop leading `VAR=value` words, which the shell applies to the command rather
 * than being part of it.
 *
 * Not cosmetic: `npm_config_arch=arm64 pnpm dist:mac ... --arm64` is how BOTH
 * shipping workflows build each architecture, and reading the assignment as the
 * command word makes every one of those passes invisible - the exact blindness
 * this file was rewritten for.
 */
const withoutPrefixAssignments = (words) => {
	let at = 0;
	while (at < words.length && ASSIGNMENT.test(words[at])) at++;
	return words.slice(at);
};
/** An `env` flag whose next word is a value rather than the command. */
const ENV_VALUE_FLAG = /^-(u|C|S|i)$/;
/** The macOS platform: `--mac`, `-m`, or the shorthand cluster electron-builder accepts (`-mwl`). */
const MAC_PLATFORM = /^--mac$|^-[mwl]*m[mwl]*$/;
/** The other two platforms, named or clustered, which a macOS pass is not. */
const OTHER_PLATFORM = /^--(win|win32|windows|linux)$|^-[mwl]*[wl][mwl]*$/;
/** The macOS architecture a pass pins. `g`-flagged, so only `matchAll` consumes it. */
const ARCH_FLAG = /--(arm64|x64|universal)\b/g;
/** The Electron dist a pass fetches; `g`-flagged for `matchAll`. */
const FETCHED_ARCH = /npm_config_arch=([A-Za-z0-9_]+)/g;
const VERIFY_ARTIFACTS = /verify-macos-artifacts/;
/** The disk-image notarisation, as the script a step invokes and as the file it runs. */
const NOTARIZE_SCRIPT = "notarize-dmg";
const NOTARIZE_ARTIFACTS = /notarize-artifacts\.mjs/;
/** The skip gate inside that script, asserted so this file's premise is checked. */
const NOTARIZE_SKIP_GATE = /NOTARIZE !== "true"/;
/** The credentials notarisation needs, all three, or it skips. */
const APPLE_CREDENTIALS = ["APPLE_ID", "APPLE_ID_PASSWORD", "APPLE_TEAM_ID"];
/** The gate that refuses a notarisation which skipped instead of running. */
const NOTARIZED_GATE = /require-notarized-dmg\.sh/;
/**
 * The report a real release printed, byte for byte, for the gate to be tried on.
 *
 * Taken from the `Notarize and staple the disk images` step of v0.30.15's
 * publish run, so the positive case is the shape the wire actually produces
 * rather than one written to agree with the assertion.
 */
const REAL_NOTARIZATION_REPORT = [
	"Disk image notarized and stapled: /Users/runner/work/local-operator-ui/local-operator-ui/dist/local-operator-ui-0.30.15-arm64.dmg",
	"Disk image notarized and stapled: /Users/runner/work/local-operator-ui/local-operator-ui/dist/local-operator-ui-0.30.15-x64.dmg",
];
const REQUIRE_REPORT = /require-report\.sh/;
const BYTECODE_CHECK_ID = /id: "app-bytecode-loadable"/;
const FEED_SAVE = /merge-update-feed\.mjs[^\n]*--save/;
const FEED_MERGE = /merge-update-feed\.mjs[^\n]*--merge/;

/**
 * How many `pnpm <script>` hops are followed into package.json.
 *
 * The same cap `scripts/check-build-env.mjs` uses, for the same reason: one hop
 * reaches the invocation (`dist:all` IS `electron-builder -mwl`), the second
 * covers a script that reaches the packer through another script, and a cycle
 * or a chain of aliases ends instead of looping.
 */
const MAX_SCRIPT_HOPS = 2;

/** Every `run:` step in a workflow, with the job and step it belongs to. */
function runSteps(name) {
	const steps = [];
	for (const [job, definition] of Object.entries(
		WORKFLOWS.get(name).jobs ?? {},
	)) {
		for (const step of definition.steps ?? []) {
			if (typeof step.run === "string") {
				// The index is carried rather than recovered later: the filters
				// below return NEW objects, so an identity search over this list
				// finds nothing and an ordering assertion built on it would fail
				// on a compliant workflow.
				steps.push({
					job,
					step,
					index: steps.length,
					name: step.name ?? step.run.split("\n")[0],
				});
			}
		}
	}
	return steps;
}

/** The `pnpm <name>` / `pnpm run <name>` / `npm run <name>` a segment names, or null. */
function scriptNameOf(words) {
	const [command, ...rest] = withoutPrefixAssignments(words);
	if (command !== "pnpm" && command !== "npm") return null;
	let at = 0;
	while (at < rest.length && rest[at].startsWith("-")) at++;
	const word = rest[at];
	if (word === undefined) return null;
	// `npm run <name>` and `pnpm run <name>` are explicit; the bare form is
	// ambiguous with the packager's OWN subcommands, and `npm pack` means a
	// tarball rather than this repository's `pack` script - reading it as the
	// script would put the npm-publish job's `npm pack` on the macOS contract.
	// The subcommand list is imported rather than copied: a second copy of it is
	// a copy that can drift, and `scripts/check-build-env.mjs` already owns it.
	if (word === "run" || word === "run-script") {
		const name = rest[at + 1];
		return name === undefined ? null : { name, at: at + 1 };
	}
	if (PACKAGER_COMMANDS.has(word)) return null;
	return { name: word, at };
}

/**
 * The command segments a `run:` script EXECUTES, with each `pnpm <script>`
 * segment replaced by the segments of that script's body.
 *
 * Returns `{ words, via }` per segment: `via` is the chain of script names the
 * invocation was reached through, so a failure can name `pnpm dist:all ->
 * electron-builder` rather than only the argv. The expansion is what makes a
 * packaged step visible at all - see the header.
 */
function executedSegments(run) {
	const segments = [];
	const expand = (words, depth, via) => {
		const named = scriptNameOf(words);
		const body = named === null ? undefined : PACKAGE_SCRIPTS[named.name];
		if (typeof body !== "string" || depth >= MAX_SCRIPT_HOPS) {
			segments.push({ words, via });
			return;
		}
		// pnpm appends the step's own arguments to the LAST command of the
		// script's body, so a pass's arch flag reaches electron-builder from
		// outside the body it was written in.
		const forwarded = words.slice(named.at + 1);
		const inner = commandSegments(body);
		inner.forEach((segment, at) => {
			const last = at === inner.length - 1 && forwarded.length > 0;
			expand(last ? [...segment, ...forwarded] : segment, depth + 1, [
				...via,
				named.name,
			]);
		});
	};
	for (const words of commandSegments(run)) expand(words, 0, []);
	return segments;
}

/** Drop the wrappers (`env`, `npx`, `pnpm exec`) so the command word is the command. */
function peelWrappers(words) {
	let rest = withoutPrefixAssignments(words);
	for (;;) {
		const [first] = rest;
		if (first === undefined) return rest;
		if ((first === "pnpm" || first === "npm") && rest[1] === "exec") {
			rest = rest.slice(2);
			continue;
		}
		if (!WRAPPERS.has(first)) return rest;
		let at = 1;
		while (at < rest.length) {
			const word = rest[at];
			if (ASSIGNMENT.test(word)) {
				at++;
				continue;
			}
			if (first === "env" && ENV_VALUE_FLAG.test(word)) {
				at += 2;
				continue;
			}
			if (first === "env" && word.startsWith("-")) {
				at++;
				continue;
			}
			break;
		}
		rest = rest.slice(at);
	}
}

/**
 * Every electron-builder invocation a step runs, with the argv electron-builder
 * receives and the script chain it came through.
 *
 * A step whose text merely DISCUSSES electron-builder is not one: `publish.yml`
 * does that in six comments, and a gate that cried wolf on those would be
 * deleted rather than fixed. Comments are dropped by the tokenizer, on the
 * shell's own rule.
 */
function packInvocations(run) {
	const invocations = [];
	for (const { words, via } of executedSegments(run)) {
		const [command, ...args] = peelWrappers(words);
		if (command === undefined) continue;
		if (command === "electron-builder" || command === "electron-builder.js") {
			invocations.push({ args, via });
		}
	}
	return invocations;
}

/** A pass is a macOS pass when its argv selects macOS, by flag or by host default. */
function isMacPass({ args }) {
	const platforms = args.filter(
		(word) => MAC_PLATFORM.test(word) || OTHER_PLATFORM.test(word),
	);
	return (
		platforms.length === 0 || platforms.some((word) => MAC_PLATFORM.test(word))
	);
}

/** The macOS architectures an invocation names, in the order it names them. */
const architecturesOf = ({ args }) =>
	[...args.join(" ").matchAll(ARCH_FLAG)].map((match) => match[1]);

/**
 * The steps that PACKAGE macOS, i.e. the ones an architecture mistake can brick,
 * each with the invocations that made it one.
 */
const macPasses = (name) =>
	runSteps(name)
		.map((entry) => ({
			...entry,
			invocations: packInvocations(entry.step.run).filter(isMacPass),
		}))
		.filter((entry) => entry.invocations.length > 0);

/** The steps of a workflow that run `merge-update-feed.mjs` in the given mode. */
const feedSteps = (name, pattern) => stepsRunning(name, pattern);

/**
 * The steps of a workflow that invoke a package.json script, directly or as the
 * command a wrapper runs.
 *
 * The WORDS are searched rather than the resolved segments, because these
 * workflows run their gates as `bash scripts/require-report.sh "<label>" pnpm
 * --silent <script>`: the segment's first word is `bash`, so the `pnpm <script>`
 * inside it is not a segment of its own and `executedSegments` has nothing to
 * expand. The script's body is read back from package.json by the caller, so a
 * name that stopped pointing at the script this test is about fails there.
 */
const stepsInvoking = (name, script) =>
	runSteps(name).filter(({ step }) =>
		executedSegments(step.run).some(({ words }) => words.includes(script)),
	);

/** The steps of a workflow whose executed commands match `pattern`. */
function stepsRunning(name, pattern) {
	return runSteps(name).filter(({ step }) =>
		executedSegments(step.run).some(({ words }) =>
			pattern.test(words.join(" ")),
		),
	);
}

/**
 * A step's EFFECTIVE environment, in GitHub's own precedence: workflow, then job,
 * then step, each overriding the last.
 *
 * Read rather than assumed, because that is the whole defect this stands over:
 * `publish.yml` puts the notarisation flag at the WORKFLOW and this repository's
 * candidate workflow puts it at the JOB, so a check that looked only at the step
 * would red on both of them.
 */
function effectiveEnv(name, job, step) {
	const workflow = WORKFLOWS.get(name);
	return {
		...workflow.env,
		...workflow.jobs[job].env,
		...step.env,
	};
}

/** How a pass is named in a failure: the workflow, the job, the step, and the command it reached. */
const where = (workflow, entry, invocation) =>
	`${workflow}:${entry.job}:${entry.name}${
		invocation.via.length > 0
			? ` (via pnpm ${invocation.via.join(" -> ")})`
			: ""
	}`;

/**
 * The workflows this contract covers, named rather than derived.
 *
 * A third workflow that packages macOS has to be added here deliberately - with
 * these properties satisfied, or with a sentence saying why it is exempt - which
 * is the point: the drift this file exists to stop was one of two copies of the
 * same build being fixed without the other.
 */
const SHIPPING_WORKFLOWS = ["publish.yml", "signed-update-candidate.yml"];

test("the workflows this contract covers are the ones that package macOS", () => {
	const thatPack = [...WORKFLOWS.keys()]
		.filter((name) => macPasses(name).length > 0)
		.sort();
	assert.deepEqual(
		thatPack,
		SHIPPING_WORKFLOWS,
		`the workflows whose steps package macOS are ${JSON.stringify(thatPack)} while this contract covers ${JSON.stringify(SHIPPING_WORKFLOWS)}. A workflow that packages macOS and is not listed here is unchecked, and one listed here that no longer packages it is a contract asserting nothing - update SHIPPING_WORKFLOWS in scripts/mac-build-arch.test.mjs either way.`,
	);
});

for (const workflow of SHIPPING_WORKFLOWS) {
	const passes = macPasses(workflow);

	test(`${workflow}: no macOS pass packages more than one architecture`, () => {
		// The defect this file exists for, stated as one assertion per pass.
		for (const entry of passes) {
			for (const invocation of entry.invocations) {
				const architectures = architecturesOf(invocation);
				const label = where(workflow, entry, invocation);
				assert.ok(
					architectures.length <= 1,
					`${label} pins ${architectures.length} architectures (${architectures.join(", ")}). One \`pnpm run build\` emits bytecode for ONE V8, so both bundles from one pass means one of them carries the other's bytecode and dies at launch with cachedDataRejected (v0.30.10, and the x64 candidate of every release after it). Split the pass per architecture; see the macOS steps in .github/workflows/publish.yml.`,
				);
				assert.ok(
					!architectures.includes("universal"),
					`${label} builds a universal bundle, which carries ONE \`out/main/index.jsc\` for both architectures - the same brick as a two-architecture pass, spelled the other way. Build each architecture in its own pass.`,
				);
				// The fetch that decides which V8 the bytecode is compiled against, when
				// the pass pins one: a pass that asks for `--x64` while `npm_config_arch`
				// says arm64 is the same brick with the sign flipped, and a pass that pins
				// no dist at all compiles the RUNNER's bytecode (`ensure-electron.js`
				// fetches the host's arch unless told otherwise).
				if (architectures.length === 1) {
					const fetched = [...entry.step.run.matchAll(FETCHED_ARCH)].map(
						(match) => match[1],
					);
					assert.ok(
						fetched.length > 0,
						`${label} packages ${architectures[0]} without fetching an Electron dist for it. electron-vite's bytecode step runs the binary in node_modules/electron/dist, and that dist follows the HOST unless npm_config_arch is set - so the pass would compile the runner's bytecode for this architecture.`,
					);
					assert.deepEqual(
						[...new Set(fetched)],
						[architectures[0]],
						`${label} fetches ${fetched.join(", ")} while packaging ${architectures[0]}: the bytecode would be compiled against the wrong runtime.`,
					);
				}
			}
		}
	});

	test(`${workflow}: the macOS passes cover both architectures a release ships`, () => {
		// Coverage is the other half, and the half nothing else checks: one pass is
		// a valid shape on its own, so deleting a pass leaves the assertion above
		// green. `verify-signed-update.mjs` asserts only the RUNNER's architecture
		// (`-${process.arch}.zip`), so the audit would exercise one architecture
		// and report a verdict about the candidate.
		const named = new Set(
			passes.flatMap((entry) =>
				entry.invocations.flatMap((invocation) => architecturesOf(invocation)),
			),
		);
		for (const [flag, architecture] of MAC_ARCHITECTURES) {
			assert.ok(
				named.has(architecture),
				`${workflow} never builds ${architecture} (no macOS pass names ${flag}), so the artifacts it produces cover one architecture while the release offers both - and nothing else in the tree requires both: scripts/verify-signed-update.mjs asserts only the runner's own architecture. Restore the ${architecture} pass, with its own pnpm run build and its own npm_config_arch.`,
			);
		}
		assert.deepEqual(
			[...named].sort(),
			["arm64", "x64"],
			`${workflow} names macOS architectures ${JSON.stringify([...named].sort())}; the release ships ${JSON.stringify(["arm64", "x64"])}.`,
		);
	});

	test(`${workflow}: the steps that notarise carry the flag and the credentials that make it happen`, () => {
		// Both halves of notarisation - `scripts/notarize.js` on `afterSign` for each
		// app bundle, `scripts/notarize-artifacts.mjs` for each disk image - gate on
		// `NOTARIZE === "true"` AND all three `APPLE_*` values, and both SKIP QUIETLY
		// without them: one log line, exit 0. A skip therefore satisfies
		// `scripts/require-report.sh`, whose check is emptiness rather than meaning,
		// and the refusal only lands one step later at the artifact verification -
		// measured on audit run 35846109424, where the two `dmg-spctl` rows answered
		// `rejected | source=Unnotarized Developer ID` after a whole two-pass build had
		// been spent, while every app-level row passed.
		const notarising = stepsInvoking(workflow, NOTARIZE_SCRIPT);
		assert.ok(
			notarising.length > 0,
			`${workflow} no longer runs the disk-image notarisation, so this assertion has nothing to be about. If that is intended, say so here: an unnotarised disk image is refused by Gatekeeper on a user's machine.`,
		);
		// That `notarize-dmg` is still the disk-image notarisation, read from
		// package.json rather than assumed from its name.
		assert.match(
			String(PACKAGE_SCRIPTS[NOTARIZE_SCRIPT]),
			NOTARIZE_ARTIFACTS,
			`pnpm ${NOTARIZE_SCRIPT} no longer runs scripts/notarize-artifacts.mjs, so the step this test requires credentials for is no longer the disk-image notarisation.`,
		);
		// The packaging passes are in the list because the APP BUNDLE inside each
		// image is notarised during its own pass (`afterSign`), and a disk image can
		// only be stapled over an app that was notarised.
		for (const entry of [...notarising, ...passes]) {
			const env = effectiveEnv(workflow, entry.job, entry.step);
			const label = `${workflow}:${entry.job}:${entry.name}`;
			assert.ok(
				String(env.NOTARIZE).toLowerCase() === "true",
				`${label} has no NOTARIZE=true in its effective environment (step over job over workflow). Both notarisation paths skip quietly without it - one log line, exit 0 - so the step's own gate reads a skip as a pass and the refusal lands one step later at verification: audit run 35846109424 printed 'Skipping disk image notarization: NOTARIZE not set to true', then answered FAIL dmg-spctl and FAIL dmg-stapler for BOTH images - 4 of 101 artifact checks - after a two-pass macOS build had already been spent.`,
			);
			for (const credential of APPLE_CREDENTIALS) {
				assert.ok(
					typeof env[credential] === "string" && env[credential].length > 0,
					`${label} has no ${credential} in its effective environment. Notarisation needs all three credentials and skips quietly without them, so the disk image is left unnotarised and the verification one step later refuses it - the Gatekeeper refusal a user would meet, reached after the build that was supposed to prevent it.`,
				);
			}
		}
		// The premise, read from the script rather than assumed: if the skip gate is
		// refactored away, this test stops being about the real one and should say so
		// rather than keep passing on a rule nobody enforces any more.
		const notarizeArtifacts = readFileSync(
			new URL("../scripts/notarize-artifacts.mjs", import.meta.url),
			"utf8",
		);
		assert.match(
			notarizeArtifacts,
			NOTARIZE_SKIP_GATE,
			'scripts/notarize-artifacts.mjs no longer skips on `NOTARIZE !== "true"`, so the flag this test requires may no longer be the one that decides whether a disk image is notarised - re-read that script and this assertion together.',
		);
	});

	test(`${workflow}: the disk-image notarisation refuses a skip instead of leaving it to verification`, () => {
		// The environment assertion above cannot see this one: with the flag and the
		// three credentials bound, the script still short-circuits on an empty `dist`,
		// and on a credential that is bound but EMPTY (`${{ secrets.X }}` for a secret
		// that was never set renders as nothing, which is the shape a rotation or a
		// mis-scoped secret takes). A skip is one line and exit 0, so
		// `require-report.sh` reads it as a pass; `scripts/require-notarized-dmg.sh` is
		// the half that refuses it, at the step that failed to do the job.
		for (const entry of stepsInvoking(workflow, NOTARIZE_SCRIPT)) {
			assert.match(
				String(entry.step.run),
				NOTARIZED_GATE,
				`${workflow}:${entry.job}:${entry.name} runs the disk-image notarisation without \`scripts/require-notarized-dmg.sh\`, so a skip there reads as a pass until the artifact verification refuses the images one step later - after the whole build it was meant to protect has been spent (run 35846109424).`,
			);
		}
	});

	test(`${workflow}: the Apple credentials are bound on the steps that notarise, never around them`, () => {
		// These are SECRETS, and the scope they are bound at decides how many steps can
		// read them: at job or workflow scope they are handed to every step under it -
		// `pnpm install --frozen-lockfile` postinstall scripts and marketplace actions
		// included - where they buy nothing. Asserted rather than remembered, because
		// the convenient binding is the job one and this is the file that would
		// otherwise let it back in.
		const document = WORKFLOWS.get(workflow);
		const scopes = [
			[`${workflow} workflow env`, document.env],
			...Object.entries(document.jobs ?? {}).map(([job, definition]) => [
				`${workflow}:${job} job env`,
				definition.env,
			]),
		];
		for (const [label, env] of scopes) {
			for (const credential of APPLE_CREDENTIALS) {
				assert.ok(
					!(credential in (env ?? {})),
					`${label} binds ${credential}, so every step beneath it can read a notarisation credential it has no use for. Bind it on the steps that notarise instead - the two macOS passes and the disk-image step - which is where it is read, and which is what publish.yml does.`,
				);
			}
		}
	});

	test(`${workflow}: the update feed is snapshotted between the passes and merged after the last`, () => {
		// `latest-mac.yml` is ONE file describing BOTH architectures, and
		// electron-builder rewrites it from scratch at the end of every pass.
		// Splitting the build without this pair trades the launch brick for a
		// silently dead update channel on whichever architecture built first.
		const runs = runSteps(workflow);
		const indexOf = (pattern) =>
			runs.findIndex(({ step }) =>
				executedSegments(step.run).some(({ words }) =>
					pattern.test(words.join(" ")),
				),
			);
		const save = indexOf(FEED_SAVE);
		const merge = indexOf(FEED_MERGE);
		const ordered = passes.map((pass) => pass.index);
		assert.notEqual(
			save,
			-1,
			`${workflow} builds ${passes.length} macOS passes but never snapshots the first pass's update feed (node scripts/merge-update-feed.mjs --save).`,
		);
		assert.notEqual(
			merge,
			-1,
			`${workflow} builds ${passes.length} macOS passes but never merges the update feeds, so the shipped latest-mac.yml lists only the last architecture built.`,
		);
		assert.ok(
			save < merge,
			`${workflow}: the update feed is merged before it is saved, so the merge carries nothing.`,
		);
		assert.ok(
			save > ordered[0] && save < ordered.at(-1),
			`${workflow}: the update feed snapshot (step ${save}) does not sit between the first (${ordered[0]}) and last (${ordered.at(-1)}) macOS pass.`,
		);
		assert.ok(
			merge > ordered.at(-1),
			`${workflow}: the update feed is merged before the last macOS pass rewrites it, so the merge is overwritten.`,
		);
	});
}

test("signed-update-candidate.yml verifies the candidate with the same artifact gate a release runs", () => {
	// The audit exists to check the bytes a release ships. A verification that
	// runs a different set of checks than the release does - or none - cannot
	// say anything about it, which is the gap this file was written after.
	const verification = runSteps("signed-update-candidate.yml").find(
		({ step }) => VERIFY_ARTIFACTS.test(step.run),
	);
	assert.ok(
		verification,
		"signed-update-candidate.yml never runs verify-macos-artifacts, so its verdict is not about the artifacts a release ships.",
	);
	assert.match(
		verification.step.run,
		REQUIRE_REPORT,
		"the candidate's artifact verification must run through scripts/require-report.sh: this step reads an exit status, and a gate reached through an unresolvable path exits 0 having printed nothing, which is a PASS.",
	);
});

test("promoting a Release is unreachable without the macOS artifact gate", () => {
	const { jobs } = WORKFLOWS.get("publish.yml");
	const needs = (job) => [].concat(jobs[job].needs ?? []);
	// Transitive, because the gate is reached through attach-to-release: a job
	// whose closure drops build-macos promotes artifacts nothing verified.
	const closure = new Set();
	const walk = (job) => {
		for (const dependency of needs(job)) {
			if (closure.has(dependency)) continue;
			closure.add(dependency);
			walk(dependency);
		}
	};
	walk("finalize-release");
	assert.ok(
		closure.has("build-macos"),
		"finalize-release no longer depends on build-macos, so the Release can be promoted to latest without the macOS artifact gate ever running.",
	);
	const gate = runSteps("publish.yml").find(
		({ job, step }) => job === "build-macos" && VERIFY_ARTIFACTS.test(step.run),
	);
	assert.ok(
		gate,
		"the job finalize-release depends on no longer runs verify-macos-artifacts.",
	);
	assert.equal(
		feedSteps("publish.yml", FEED_MERGE).length,
		1,
		"publish.yml's merged update feed moved or disappeared; the macOS feed it publishes is the one both architectures are offered from.",
	);
	// And the check that failed on the candidate of every release is inside that
	// gate: asserted against the gate's own source, so removing the check is a
	// red test here rather than a silent loss of the only probe that asks a
	// bundle's own Electron to load the bytecode it ships.
	const gateSource = readFileSync(
		new URL("../scripts/verify-macos-artifacts.mjs", import.meta.url),
		"utf8",
	);
	assert.match(
		gateSource,
		BYTECODE_CHECK_ID,
		"verify-macos-artifacts no longer carries the app-bytecode-loadable probe, which is the only check that loads the bytecode a bundle ships.",
	);
});

/**
 * A throwaway tree with the REAL `require-report.sh` and a stub `pnpm`, so a
 * step's own `run:` text can be EXECUTED rather than pattern-matched.
 *
 * The stub is the only thing that is not real: the step's text, the wrapper and
 * the report shape all are. It also stands in for the one part no machine here
 * can do - `notarize-dmg` needs a Developer ID identity and Apple credentials.
 */
function notarizationSandbox(reportLines) {
	const root = mkdtempSync(join(tmpdir(), "lo-notarized-dmg-"));
	mkdirSync(join(root, "bin"), { recursive: true });
	mkdirSync(join(root, "tmp"), { recursive: true });
	mkdirSync(join(root, "scripts"), { recursive: true });
	for (const gate of ["require-report.sh", "require-notarized-dmg.sh"]) {
		copyFileSync(join(REPO_ROOT, "scripts", gate), join(root, "scripts", gate));
	}
	writeFileSync(
		join(root, "bin", "pnpm"),
		`#!/bin/sh\nprintf '%s\\n' ${reportLines.map((line) => JSON.stringify(line)).join(" ")}\n`,
		{ mode: 0o755 },
	);
	return root;
}

/** A step's text run the way the runner does it: `bash -e`, from the sandbox, stub on PATH. */
const runStep = (root, text) =>
	spawnSync("bash", ["-e", "-c", text], {
		cwd: root,
		env: {
			PATH: `${join(root, "bin")}:${process.env.PATH}`,
			RUNNER_TEMP: join(root, "tmp"),
		},
		encoding: "utf8",
	});

test("scripts/require-notarized-dmg.sh: what it refuses, and what it accepts", () => {
	const cases = [
		{
			what: "the skip whose images no ticket was stapled to in run 35846109424",
			lines: ["Skipping disk image notarization: NOTARIZE not set to true"],
			status: 1,
			says: /Notarization skipped/,
		},
		{
			what: "an empty dist, which is the other one-line exit 0",
			lines: ["No disk images found in /Users/runner/work/dist"],
			status: 1,
			says: /Notarization skipped/,
		},
		{
			what: "a report with content but no staple in it",
			lines: ["> local-operator-ui@0.30.15 notarize-dmg"],
			status: 1,
			says: /No disk image was notarised/,
		},
		{
			what: "the report a real release printed",
			lines: REAL_NOTARIZATION_REPORT,
			status: 0,
		},
	];
	for (const { what, lines, status, says } of cases) {
		const root = notarizationSandbox(lines);
		const report = join(root, "report.log");
		writeFileSync(report, `${lines.join("\n")}\n`);
		const result = spawnSync(
			"bash",
			[join(REPO_ROOT, "scripts", "require-notarized-dmg.sh"), report],
			{ encoding: "utf8" },
		);
		assert.equal(
			result.status,
			status,
			`${what}: expected exit ${status}, got ${result.status} - ${result.stdout}${result.stderr}`,
		);
		if (says) assert.match(`${result.stdout}${result.stderr}`, says, what);
	}
	// An empty report is not "nothing to check": it is the case where nothing here
	// can tell a skip from a run, so it is refused as well, and a misuse of the
	// helper is the caller's defect rather than a pass.
	const root = notarizationSandbox([]);
	const empty = join(root, "empty.log");
	writeFileSync(empty, "");
	assert.equal(
		spawnSync(
			"bash",
			[join(REPO_ROOT, "scripts", "require-notarized-dmg.sh"), empty],
			{ encoding: "utf8" },
		).status,
		1,
		"an empty notarisation report must be refused rather than read as nothing to check",
	);
	assert.equal(
		spawnSync(
			"bash",
			[join(REPO_ROOT, "scripts", "require-notarized-dmg.sh")],
			{ encoding: "utf8" },
		).status,
		2,
		"called with no report path, the gate must refuse the caller's defect rather than pass",
	);
});

test("signed-update-candidate.yml: the notarisation step fails on a skip and passes on a real report", () => {
	const [entry] = stepsInvoking("signed-update-candidate.yml", NOTARIZE_SCRIPT);
	assert.ok(
		entry,
		"signed-update-candidate.yml no longer has a disk-image notarisation step to exercise.",
	);
	const skipped = runStep(
		notarizationSandbox([
			"Skipping disk image notarization: NOTARIZE not set to true",
		]),
		entry.step.run,
	);
	assert.notEqual(
		skipped.status,
		0,
		`a skip has to fail at the notarisation step itself; it exited 0 with: ${skipped.stdout}${skipped.stderr}`,
	);
	assert.match(`${skipped.stdout}${skipped.stderr}`, /Notarization skipped/);
	const notarised = runStep(
		notarizationSandbox(REAL_NOTARIZATION_REPORT),
		entry.step.run,
	);
	assert.equal(
		notarised.status,
		0,
		`a real notarisation report has to pass the step, or the release path dies on the guard: ${notarised.stdout}${notarised.stderr}`,
	);
});
