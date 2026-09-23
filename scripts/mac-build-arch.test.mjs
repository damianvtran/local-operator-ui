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
 *     release from a tag defensible".
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
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { PACKAGER_COMMANDS, commandSegments } from "./check-build-env.mjs";

const require = createRequire(import.meta.url);
const builderRequire = createRequire(
	require.resolve("electron-builder/package.json"),
);
const appRequire = createRequire(builderRequire.resolve("app-builder-lib"));
const { load } = appRequire("js-yaml");

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
const feedSteps = (name, pattern) =>
	runSteps(name).filter(({ step }) =>
		executedSegments(step.run).some(({ words }) =>
			pattern.test(words.join(" ")),
		),
	);

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
