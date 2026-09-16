/**
 * `/info`'s fleet answer: a term nobody measured must never render as a number.
 *
 *     node --test scripts/panel-info-fleet.test.mjs
 *
 * The desktop panel reported only `N live · M total` sessions. The terminal's
 * `/info` additionally answers "how many agent runtimes, and how many agent
 * trajectories, are running on this machine right now", and that section exists
 * because of a class of lie rather than a shortage of numbers: `fleet_trajectories`
 * sums only over runtimes that REPORTED their subagents, so when some did not,
 * every term of the sum is a floor. Rendering that through the measured branch
 * printed `none running` — a word chosen precisely because it asserts more
 * confidently than a bare `0` — on a frame that was simultaneously drawing
 * running children.
 *
 * WHAT THIS FILE ASSERTS, AND WHY IT IS SHAPED THIS WAY. The section's numbers
 * are DECISIONS (which spelling a state earns), not markup, so they live in
 * `fleetFacts` and this test binds the shipped function the panel calls —
 * the discipline `panel-info-credentials.test.mjs` states. Every state below is
 * named, because the states are the artefact: the difference between
 * `2 runtimes · trajectories —` and `2 runtimes · none running` is the whole
 * change, and a test written against the panel's markup would have to render a
 * portal it cannot reach to see it.
 *
 * The magnitudes are the host this was written on (21 live runtimes, 23
 * subagents, 42 trajectories), so the strings are the width a real reading
 * produces rather than a two-digit toy.
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = resolve(import.meta.dirname, "..");

/*
 * The bundle is a real file under `node_modules/.cache` because a `data:` URL
 * cannot resolve a bare specifier; React stays external so the module under
 * test uses this process's React, as in `panel-info-credentials.test.mjs`.
 */
const CACHE = join(ROOT, "node_modules/.cache/panel-info-fleet");
const bundleInto = async (name, contents) => {
	const bundle = await build({
		stdin: { contents, resolveDir: ROOT },
		bundle: true,
		format: "esm",
		platform: "node",
		jsx: "automatic",
		packages: "external",
		loader: { ".css": "empty" },
		alias: {
			"@shared": resolve("src/renderer/src/shared"),
			"@renderer": resolve("src/renderer/src"),
			"@features": resolve("src/renderer/src/features"),
		},
		write: false,
	});
	mkdirSync(CACHE, { recursive: true });
	const file = join(CACHE, `${name}.mjs`);
	writeFileSync(file, bundle.outputFiles[0].text);
	return import(pathToFileURL(file).href);
};

const PANEL = "src/renderer/src/features/chat/pickers/panels/info-panel.tsx";
const MODEL = "src/renderer/src/features/chat/pickers/panels/info-model.ts";
const { fleetFacts, plural } = await bundleInto(
	"info-fleet-model",
	`export { fleetFacts, plural } from "./${MODEL}";`,
);

/*
 * Top-level, not inline: `useTopLevelRegex` is a warning here rather than an
 * error, but a file this one touches lands lint-clean — the rule exists because
 * a regex compiled inside a hot path is work repeated on every call.
 */
const CAVEAT_RUN = /^2 sessions run /;
const CAVEAT_DO_NOT_REPORT = /do not report subagents/;
const WIRING_FLEET_CALL = /const fleet = data \? fleetFacts\(data\) : null;/;
const WIRING_SECTION =
	/<PanelSection title="Agents and subagents" meta=\{fleet\?\.meta\}>/;
const WIRING_FACTS = /fleet\.facts\.map\(/;
const WIRING_CAVEATS = /fleet\.caveats\.map\(/;

/**
 * The roll-ups of this machine at the time of writing, which every case below
 * departs from by exactly the field it is about.
 *
 * `degraded` is empty because the probes answered; the two cases that make it
 * non-empty name the probe exactly as the backend does.
 */
const HOST = {
	sessions: {
		lines: [],
		total: 21,
		live: 21,
		wedged: 0,
		stale: 0,
		busy: 19,
		pending: 1,
		detached: 0,
		build_skew: false,
		usage_available: true,
		available: true,
		subagents_reporting: 21,
		subagents_unreported: 0,
		fleet_subagents_running: 23,
		fleet_subagents_queued: 0,
		fleet_session_trajectories: 19,
		fleet_trajectories: 42,
	},
	agents: { profiles: 27, teams: 5 },
	degraded: [],
};

const fleet = (over = {}, degraded = HOST.degraded) =>
	fleetFacts({
		sessions: { ...HOST.sessions, ...over },
		agents: HOST.agents,
		degraded,
	});

/** The value and note of one fact, by its key. */
const fact = (section, key) => {
	const found = section.facts.find((entry) => entry.key === key);
	assert.ok(found, `the section must carry a \`${key}\` fact`);
	return { value: found.value, note: found.note };
};

test("every runtime reporting: the meta is a measurement, not a floor", () => {
	const section = fleet();
	assert.equal(section.meta, "21 runtimes · 42 trajectories");
	assert.deepEqual(fact(section, "runtimes"), {
		value: "21",
		note: "21 live",
	});
	assert.deepEqual(fact(section, "trajectories"), {
		value: "42 total",
		note: "19 sessions + 23 subagents",
	});
	assert.deepEqual(fact(section, "profiles"), { value: "27", note: undefined });
	assert.deepEqual(fact(section, "teams"), { value: "5", note: undefined });
	// A line that is always there is wallpaper, so the caveats are conditional.
	assert.deepEqual(section.caveats, []);
});

test("one runtime silent: the FIGURE carries the lower bound, not just the sentence", () => {
	const section = fleet({
		subagents_reporting: 20,
		subagents_unreported: 1,
	});
	assert.equal(section.meta, "21 runtimes · ≥42 trajectories");
	assert.equal(
		fact(section, "trajectories").value,
		"≥42 total",
		"a qualifier the reader has to scroll to is not a qualifier",
	);
	assert.equal(
		fact(section, "trajectories").note,
		"19 sessions + 23 subagents · 1 did not report",
	);
	// BOTH verbs inflect together; half-inflected shipped once in the terminal.
	assert.deepEqual(section.caveats, [
		"1 session runs an older build and does not report subagents — the fleet total is a lower bound.",
	]);
});

test("nobody reporting and nothing measured: the count is refused, never zeroed", () => {
	const section = fleet({
		busy: 0,
		live: 2,
		total: 2,
		subagents_reporting: 0,
		subagents_unreported: 2,
		fleet_subagents_running: 0,
		fleet_session_trajectories: 0,
		fleet_trajectories: 0,
	});
	assert.equal(section.meta, "2 runtimes · trajectories —");
	assert.deepEqual(fact(section, "trajectories"), {
		value: "—",
		note: "2 of 2 runtimes did not report",
	});
	// The addends are absent rather than shown as three zeros.
	assert.equal(section.caveats.length, 1);
	assert.match(section.caveats[0], CAVEAT_RUN);
	assert.match(section.caveats[0], CAVEAT_DO_NOT_REPORT);
});

test("queued-only: the measured zero is named, and never contradicted", () => {
	const section = fleet({
		busy: 0,
		live: 2,
		total: 2,
		subagents_reporting: 2,
		fleet_subagents_running: 0,
		fleet_subagents_queued: 3,
		fleet_session_trajectories: 0,
		fleet_trajectories: 0,
	});
	assert.equal(section.meta, "2 runtimes · none running · 3 queued");
	// Queued is named BESIDE the total, never added into it: nothing is spent yet.
	assert.deepEqual(fact(section, "trajectories"), {
		value: "0 total",
		note: "0 sessions + 0 subagents · 3 queued",
	});
	assert.deepEqual(section.caveats, []);
});

test("all idle: the one state that earns the bare word", () => {
	const section = fleet({
		busy: 0,
		live: 2,
		total: 2,
		subagents_reporting: 2,
		fleet_subagents_running: 0,
		fleet_session_trajectories: 0,
		fleet_trajectories: 0,
	});
	assert.equal(section.meta, "2 runtimes · none running");
	assert.deepEqual(fact(section, "trajectories"), {
		value: "0 total",
		note: "0 sessions + 0 subagents",
	});
	assert.deepEqual(section.caveats, []);
});

test("a wedged runtime still counts, and its counts are dated", () => {
	const section = fleet({
		live: 1,
		wedged: 1,
		total: 2,
		subagents_reporting: 1,
	});
	assert.equal(
		section.meta,
		"2 runtimes · 42 trajectories",
		"the meta counts live + wedged, so it agrees with the sum beneath it",
	);
	assert.deepEqual(fact(section, "runtimes"), {
		value: "2",
		note: "1 live · 1 wedged",
	});
	// The possessives inflect with the subject, exactly as the verbs above do.
	assert.deepEqual(section.caveats, [
		"1 session is wedged; its counts are as of its last heartbeat.",
	]);
});

test("the wedged caveat pluralises both halves of its sentence", () => {
	const section = fleet({
		live: 0,
		wedged: 2,
		total: 2,
		subagents_reporting: 0,
	});
	assert.deepEqual(fact(section, "runtimes").note, "0 live · 2 wedged");
	assert.deepEqual(section.caveats, [
		"2 sessions are wedged; their counts are as of their last heartbeat.",
	]);
});

test("a registry that could not be scanned yields no numbers at all", () => {
	assert.equal(
		fleet({ available: false, lines: [] }),
		null,
		"the section shows section 3's notice instead of a column of unknowns",
	);
});

test("a probe that FAILED is an unknown beside a count that answered", () => {
	/*
	 * The terminal keys this on the probe NAME in `degraded` rather than on the
	 * value, because `0` is a legitimate answer on a machine that genuinely has
	 * no teams. Keying it on the value would trade one lie for another.
	 */
	const profilesFailed = fleet({}, [
		["agents.profiles", "the agent registry could not be read"],
	]);
	assert.equal(fact(profilesFailed, "profiles").value, "—");
	assert.equal(fact(profilesFailed, "teams").value, "5");

	const teamsFailed = fleet({}, [["agents.teams", "no home directory"]]);
	assert.equal(fact(teamsFailed, "profiles").value, "27");
	assert.equal(fact(teamsFailed, "teams").value, "—");
});

test("a genuine zero from a probe that answered is still a zero", () => {
	const section = fleet({}, [["process.memory", "the memory probe timed out"]]);
	assert.equal(fact(section, "profiles").value, "27");
	assert.equal(fact(section, "teams").value, "5");
});

test("the irregular plural is inflected once, for both the meta and the rows", () => {
	assert.equal(plural(1, "runtime"), "1 runtime");
	assert.equal(plural(21, "runtime"), "21 runtimes");
	assert.equal(plural(1, "trajectory"), "1 trajectory");
	assert.equal(plural(42, "trajectory"), "42 trajectories");
	assert.equal(plural(1, "session"), "1 session");
	assert.equal(plural(0, "subagent"), "0 subagents");
	// And the model actually uses it, rather than a second spelling beside it.
	const section = fleet({ live: 1, total: 1, subagents_reporting: 1 });
	assert.equal(section.meta, "1 runtime · 42 trajectories");
});

test("the panel renders the section from fleetFacts, so the two cannot drift", () => {
	/*
	 * Pinned as source text for the reason `picker-feedback.test.mjs` pins its
	 * wiring: a bundle cannot reach which expression the JSX renders, and a
	 * section that stopped calling `fleetFacts` would leave every assertion above
	 * green while the panel went back to reporting sessions only.
	 */
	const source = readFileSync(join(ROOT, PANEL), "utf8");
	assert.match(source, WIRING_FLEET_CALL);
	assert.match(source, WIRING_SECTION);
	assert.match(source, WIRING_FACTS);
	assert.match(source, WIRING_CAVEATS);
});
