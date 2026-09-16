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
const { fleetFacts, plural, REGISTRY_UNAVAILABLE_NOTICE } = await bundleInto(
	"info-fleet-model",
	`export { fleetFacts, plural, REGISTRY_UNAVAILABLE_NOTICE } from "./${MODEL}";`,
);

/*
 * Top-level, not inline: `useTopLevelRegex` is a warning here rather than an
 * error, but a file this one touches lands lint-clean — the rule exists because
 * a regex compiled inside a hot path is work repeated on every call.
 */
const WIRING_FLEET_CALL = /const fleet = data \? fleetFacts\(data\) : null;/;
const WIRING_SECTION =
	/<PanelSection title="Agents and subagents" meta=\{fleet\?\.meta\}>/;
const WIRING_FACTS = /fleet\.facts\.map\(/;
const WIRING_CAVEATS = /fleet\.caveats\.map\(/;
/** The registry notice is spelled ONCE and used at both call sites (M2). */
const WIRING_NOTICE_USES = /text=\{REGISTRY_UNAVAILABLE_NOTICE\}/g;
const WIRING_NOTICE_LITERAL = /Could not scan the session registry/;
/** A breakable clause separator, which is what the note must NOT contain. */
const BREAKABLE_SEPARATOR = / · /;
const NON_BREAKING_SEPARATOR = /\u00a0·\u00a0/;

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

/** The separator the model joins clauses with: non-breaking on both sides. */
const SEP = "\u00a0·\u00a0";

/** The value and note of one fact, by its key. */
const fact = (section, key) => {
	const found = section.facts.find((entry) => entry.key === key);
	assert.ok(found, `the section must carry a \`${key}\` fact`);
	return { value: found.value, note: found.note };
};

test("every runtime reporting: the meta is a measurement, not a floor", () => {
	const section = fleet();
	assert.equal(section.meta, "21 runtimes · 42 trajectories");
	/*
	 * No note on the Runtimes card when nothing is wedged: `21 live` under a card
	 * already reading `21` restates the Live and Wedged tiles directly above it
	 * (design round 1, D3). The value is the trajectory denominator.
	 */
	assert.deepEqual(fact(section, "runtimes"), {
		value: "21",
		note: undefined,
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
	/*
	 * The note is the ADDENDS and nothing else: the count of silent runtimes is
	 * stated once per viewport, and the caveat line directly beneath the grid
	 * states it with the cause (design round 1, D2).
	 */
	assert.equal(
		fact(section, "trajectories").note,
		"19 sessions + 23 subagents",
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
	/*
	 * And NO caveat: there is no total for `the fleet total is a lower bound` to
	 * qualify, because the same viewport refuses to state one. The card's note
	 * carries the fact. This is the deliberate deviation from the terminal
	 * (design round 1, D1).
	 */
	assert.deepEqual(section.caveats, []);
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
	/*
	 * Queued rides the META in this state and so does not appear here as well:
	 * one statement per fact per viewport, and this note is in that meta's
	 * viewport (design round 1, D6).
	 */
	assert.deepEqual(fact(section, "trajectories"), {
		value: "0 total",
		note: "0 sessions + 0 subagents",
	});
	assert.deepEqual(section.caveats, []);
});

test("a queue beside a RUNNING total is named on the card, not the meta", () => {
	/*
	 * The other half of D6's rule: whenever the meta states a measured total it
	 * has no queued clause, so the waiting work has to be named beside the card's
	 * value or it is not named at all.
	 */
	const section = fleet({
		busy: 2,
		fleet_session_trajectories: 2,
		fleet_subagents_running: 4,
		fleet_subagents_queued: 3,
		fleet_trajectories: 6,
	});
	assert.equal(section.meta, "21 runtimes · 6 trajectories");
	assert.equal(
		fact(section, "trajectories").note,
		`2 sessions + 4 subagents${SEP}3 queued`,
	);
});

test("the note's separator is non-breaking on both sides", () => {
	/*
	 * A breakable middot at the end of a wrapped line reads as a bullet the next
	 * line is an item of (design round 1, D5). Pinned as the code point, not as
	 * `\u00a0`, so a later reformat cannot quietly make it a plain space.
	 */
	const section = fleet({
		live: 1,
		wedged: 1,
		total: 2,
		subagents_reporting: 1,
	});
	const note = fact(section, "runtimes").note;
	assert.equal(note, "1 live\u00a0·\u00a01 wedged");
	assert.match(note, NON_BREAKING_SEPARATOR);
	assert.doesNotMatch(note, BREAKABLE_SEPARATOR);
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
		note: `1 live${SEP}1 wedged`,
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
	assert.deepEqual(fact(section, "runtimes").note, `0 live${SEP}2 wedged`);
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

test("a failed agent COLLECTION is an unknown too, not two plausible zeros", () => {
	/*
	 * The wire carries a block-level spelling as well as the field-level one:
	 * `_safe("agents", …)` wraps the whole collection (`collect.py:1152`) and its
	 * fallback is `AgentsInfo()` — `profiles: 0`, `teams: 0` — so the failure
	 * arrives as `("agents", reason)` and a field-name-only test prints `0` on
	 * both cards, which is the Q8 failure this rule exists for. The panel's own
	 * `Dense` fixture uses this spelling, so it was reachable inside the shipped
	 * set (review round 1, M1).
	 */
	const blockFailed = fleet({}, [
		["agents", "the session roster could not be read"],
	]);
	assert.equal(fact(blockFailed, "profiles").value, "—");
	assert.equal(fact(blockFailed, "teams").value, "—");
	// A DIFFERENT block's failure names only its own fields.
	const otherBlock = fleet({}, [["env", "the environment could not be read"]]);
	assert.equal(fact(otherBlock, "profiles").value, "27");
	assert.equal(fact(otherBlock, "teams").value, "5");
});

test("a genuine zero from a probe that answered is still a zero", () => {
	const section = fleet({}, [["process.memory", "the memory probe timed out"]]);
	assert.equal(fact(section, "profiles").value, "27");
	assert.equal(fact(section, "teams").value, "5");
});

test("the refused-count note inflects its own noun", () => {
	/*
	 * Intentional departure from the terminal, which hard-codes `runtimes`
	 * (`info_panel.py:1080`): at one runtime that spelling reads `1 of 1 runtimes
	 * did not report`. The port inflects — `1 of 1 runtime did not report` — and
	 * § 6.3 records it rather than claiming a mirror it does not have (review
	 * round 1, N1).
	 */
	const single = fleet({
		live: 1,
		wedged: 0,
		total: 1,
		busy: 0,
		subagents_reporting: 0,
		subagents_unreported: 1,
		fleet_subagents_running: 0,
		fleet_session_trajectories: 0,
		fleet_trajectories: 0,
	});
	assert.equal(single.meta, "1 runtime · trajectories —");
	assert.equal(
		fact(single, "trajectories").note,
		"1 of 1 runtime did not report",
	);
	assert.deepEqual(single.caveats, []);
	assert.equal(
		fleet({
			live: 2,
			total: 2,
			busy: 0,
			subagents_reporting: 0,
			subagents_unreported: 2,
			fleet_subagents_running: 0,
			fleet_session_trajectories: 0,
			fleet_trajectories: 0,
		}).meta,
		"2 runtimes · trajectories —",
	);
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

test("the registry notice is one spelling, used by both sections", () => {
	/*
	 * Two sections report the same failed scan, and the string used to be written
	 * twice with a comment claiming they were identical — the comment was the only
	 * thing keeping them in step (review round 1, M2).
	 */
	assert.equal(
		REGISTRY_UNAVAILABLE_NOTICE,
		"Could not scan the session registry. Close and reopen this panel to try again.",
	);
	const source = readFileSync(join(ROOT, PANEL), "utf8");
	assert.equal(
		[...source.matchAll(WIRING_NOTICE_USES)].length,
		2,
		"both sections must render the exported constant",
	);
	assert.doesNotMatch(
		source,
		WIRING_NOTICE_LITERAL,
		"the sentence itself belongs in the model, not in the panel",
	);
});
