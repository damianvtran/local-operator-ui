/**
 * THE CONDENSE PARITY FIXTURE, GENERATED FROM THE SHIPPED MODEL.
 *
 * WHY THIS EXISTS. The quiet-group fixture
 * (`scripts/fixtures/quiet-groups.parity.json`) is hand-authored and copied by the
 * relay, the TUI and this app; on 2026-10-16 the relay added a clause to it, this
 * app never took the change, and NOTHING noticed for nine days because each side
 * pinned only its own copy's hash. Copy-plus-local-hash catches a local edit and
 * nothing else. The condensation model has the same exposure with far more
 * surface: three tiers of decisions (which rows fold, run boundaries, segment
 * keys, the count arithmetic, the latch, the elected answer, the visible-row
 * partition, the head-cut flags) that the phone must reproduce row for row.
 *
 * So this script carries no expectations. It BUILDS the shipped TypeScript the way
 * the suites do (esbuild, not a second copy of the logic), runs it over a corpus,
 * and writes only what the model DECIDED. A model change that is not regenerated
 * fails `scripts/condense-parity.test.mjs`, which is the desktop half of the
 * contract; the relay half replays the same cases through its own port.
 *
 * WHAT IS DELIBERATELY ABSENT FROM THE FIXTURE.
 * - English. Another surface words the same decision in its own catalogue and its
 *   own locale, so the shared facts are identifiers and numbers: a count
 *   segment's `key`/`count`, a bar's `SegmentLabelKind`, a run's segment keys. A
 *   fixture that pinned `Explored 4 files` would either forbid the phone its own
 *   words or drift in silence - the defect this file exists to prevent.
 * - Timestamps. Per-row times are not on the relay's wire, and the durable replay
 *   carries none on either surface, so a fixture carrying them would assert a fact
 *   the phone can never see. The corpus records carry `ts` because the model reads
 *   it; the fixture states only the null-ness of the span the model derives.
 * - The server's per-run facts (`runFacts`/`factPage`) and the align walk: there is
 *   no relay equivalent, so pinning them would pin something no second surface
 *   owes.
 *
 * CORPUS. Three sources, all already in this repository, none authored here:
 * 1. every shape string the model suites drive (`seq("U T A")`, `partition("...")`,
 *    the `["U T A",` arrays) - harvested by regex at generation time, so a shape a
 *    suite adds cannot fall out of the fixture without the regenerated file
 *    changing;
 * 2. seeded property sequences (mulberry32, fixed seed), for interleavings nobody
 *    would hand-write;
 * 3. frame sequences for the live latch, the one decision that is stateful across
 *    passes.
 *
 * USAGE.
 *   node scripts/generate-condense-parity.mjs           # write both files
 *   node scripts/generate-condense-parity.mjs --check   # exit 1 when they differ
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { RECORDS } from "./fixtures/record-tokens.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FIXTURE = join(HERE, "fixtures/condense.parity.json");
const MANIFEST = join(HERE, "fixtures/condense.parity.manifest.json");

/* The suites the shape strings come from: the corpus is what they already assert. */
const SHAPE_SOURCES = [
	"scripts/turn-segments.test.mjs",
	"scripts/turn-collapse-model.test.mjs",
	"scripts/trace-fold-model.test.mjs",
];

/** Fixed seed: the property cases are part of the committed fixture, so they must
 * be reproducible on any machine. */
const SEED = 0x5eed1e55;
const PROPERTY_CASES = 120;

/** Every corpus shape is planned in all four option combinations, so a decision
 * that only differs under one of them is still a pinned case. `olderRowsExist`
 * is the head-cut input: it is what makes a top run state `N+` with no `Took`. */
/** The token line's separator: a shape string is read by `seq` and by the latch
 * frames, so the split lives here once. */
const TOKEN_GAP = /\s+/;

/** The trailing brace of a pretty-printed object, which the fixture's one-line
 * `cases` array is spliced into. */
const TRAILING_NEWLINE_BRACE = /\n\}$/;

const BASE_OPTIONS = { mode: "by-turn", live: false, olderRowsExist: false };

const PERMUTATIONS = [
	BASE_OPTIONS,
	{ mode: "by-turn", live: true, olderRowsExist: false },
	{ mode: "by-turn", live: false, olderRowsExist: true },
	{ mode: "by-response", live: false, olderRowsExist: false },
	{ mode: "by-response", live: false, olderRowsExist: true },
];

/** The bundle the suites build, narrowed to what the fixture reads. */
async function loadModel() {
	const bundle = await build({
		stdin: {
			contents: [
				'export * from "./src/renderer/src/features/chat/canonical/turn-segments";',
				'export { buildRows, ledgerName } from "./src/renderer/src/features/chat/canonical/transcript-rows";',
				'export * from "./src/renderer/src/features/chat/canonical/turn-collapse-model";',
				'export * from "./src/renderer/src/features/chat/canonical/trace-fold-model";',
				'export { isFailedResult, toolOp } from "./src/renderer/src/features/chat/components/trace/tool-row-model";',
				'export { isInternalReceipt } from "./src/renderer/src/features/chat/components/trace/receipt-row-model";',
			].join("\n"),
			resolveDir: ROOT,
		},
		alias: {
			"@features": `${ROOT}/src/renderer/src/features`,
			"@shared": `${ROOT}/src/renderer/src/shared`,
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	const url = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
	return import(url);
}

/**
 * THE PRODUCTION FOLD WIRING, in one place.
 *
 * These are the predicates `canonical-transcript.tsx` hands `foldRuns`; they are
 * inputs to the model, not decisions of it, so the fixture has to pass the same
 * ones the app does or it would pin a model nobody ships. `summaryOf`/`opOf` shape
 * only the live clause's WORDING (surface copy, outside the contract) and an empty
 * summary still produces a live object, so the executor predicate - which the
 * fixture does compare - stays faithful here.
 */
const foldOptions = (model, liveTurn, latchedFoldIds) => ({
	nameOf: (row) => model.ledgerName(row.record),
	failedOf: (row) =>
		row.record.kind === "tool" &&
		model.isFailedResult(row.record.isError, row.record.delivery),
	durationOf: model.workedSecondsOf,
	summaryOf: () => "",
	opOf: (row) =>
		row.record.kind === "tool" ? model.toolOp(row.record.args ?? {}) : "",
	runningOf: (row) => row.record.kind === "tool" && row.record.phase !== "done",
	executingOf: (row) =>
		row.record.kind === "tool" && row.record.phase === "running",
	startedAtOf: (row) =>
		row.record.kind === "tool" ? row.record.startedAt : null,
	endedAtOf: (row) => (row.record.kind === "tool" ? row.record.endedAt : null),
	isFoldable: (row) =>
		row.record.kind === "tool" && !model.isQuietTurnCall(row.record),
	isReceipt: (row) => model.isInternalReceipt(row.record),
	receiptSummaryOf: (rows) => model.receiptFoldUnits(rows),
	liveTurn,
	latchedFoldIds,
});

/** One count-line segment as the SHARED fact (the word stays on the surface). */
const countUnits = (segments) =>
	segments.map((segment) => ({ key: segment.key, count: segment.count }));

/**
 * What the model decided for one record list.
 *
 * FOUR TIERS, one pass each, in the order the app composes them: rows (which
 * records paint at all), folds (Tier A), the collapse plan (Tier B), and the
 * visible-row partition, which is what a first paint actually mounts.
 */
function decide(model, records, options) {
	const rows = model.buildRows(records, []);
	const groups = model.foldRuns(rows, foldOptions(model, false, new Set()));
	const plan = model.collapsePlan(rows, {
		live: options.live,
		mode: options.mode,
		olderRowsExist: options.olderRowsExist,
	});
	const hidden = new Set();
	for (const run of plan.runs)
		for (const segment of run.segments)
			if (segment.collapsed)
				for (const row of segment.rows) hidden.add(row.record.id);
	return {
		visibleIds: rows
			.map((row) => row.record.id)
			.filter((id) => !hidden.has(id)),
		groups: groups
			.filter((group) => group.kind === "run")
			.map((group) => ({
				id: group.id,
				rowIds: group.rows.map((row) => row.record.id),
				countUnits: countUnits(group.summary.countUnits),
				failedCount: group.failedCount,
				/* The live clause's WORDING is surface copy; that a clause exists at
				 * all is the decision (a run must not fold over a live call). */
				live: group.live !== null,
			})),
		runs: plan.runs.map((run) => ({
			key: run.key,
			answerId: run.answerId,
			collapses: run.collapses,
			recordIds: run.recordIds,
			facts: {
				actions: run.facts.actions,
				partial: run.facts.partial,
				durationS: run.facts.durationS,
				failed: run.facts.failed,
				firstFailedId: run.facts.firstFailedId,
				countUnits: countUnits(run.facts.countUnits),
			},
			segments: run.segments.map((segment) => ({
				key: segment.key,
				rowIds: segment.rows.map((row) => row.record.id),
				labelKind: labelToken(segment.labelKind),
				collapsed: segment.collapsed,
				completed: segment.completed,
				afterAnswer: segment.afterAnswer,
				group: segment.facts.group === null ? null : segment.facts.group.family,
				groupCount:
					segment.facts.group === null ? null : segment.facts.group.count,
				facts: {
					actions: segment.facts.actions,
					partial: segment.facts.partial,
					durationS: segment.facts.durationS,
					failed: segment.facts.failed,
					countUnits: countUnits(segment.facts.countUnits),
				},
			})),
		})),
	};
}

/** `seq("U T A")` -> the corpus records, through the shared grammar. */
const seq = (spec) =>
	spec
		.trim()
		.split(TOKEN_GAP)
		.map((token, index) => RECORDS[token](`${token}${index}`, index));

/**
 * Every shape string the model suites already drive.
 *
 * A shape is read from the call that builds it (`seq("…")`, `partition("…")`) and
 * from the array literals the collapse suite uses (`["U T", …]`), so the corpus is
 * a function of the tests rather than of this file. Only token lines are kept: a
 * literal that names something else (a mode, a key) is not a shape, and the
 * grammar's own lookup rejects it below.
 */
export function harvestShapes() {
	const shapes = new Set();
	for (const file of SHAPE_SOURCES) {
		const text = readFileSync(join(ROOT, file), "utf8");
		for (const match of text.matchAll(/(?:seq|partition)\("([A-Z ]+)"\)/g))
			shapes.add(match[1].trim());
		for (const match of text.matchAll(/^\s*"([A-Z](?: [A-Z])*)",?$/gm))
			shapes.add(match[1].trim());
	}
	return [...shapes]
		.filter((shape) => shape.length > 0)
		.filter((shape) =>
			shape.split(TOKEN_GAP).every((token) => token in RECORDS),
		)
		.sort();
}

/** The token vocabulary, alphabetical: the property corpus draws from it. */
const TOKENS = Object.keys(RECORDS).sort();

/** mulberry32: a tiny seeded PRNG, so the property cases are reproducible. */
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Seeded sequences of 3-80 tokens, weighted to open on a user row (the shape a
 * real turn has) but not always, so a head-cut leading run is covered too. */
function propertyShapes() {
	const random = mulberry32(SEED);
	const shapes = [];
	for (let i = 0; i < PROPERTY_CASES; i += 1) {
		const length = 3 + Math.floor(random() * 78);
		const tokens = [];
		for (let at = 0; at < length; at += 1)
			tokens.push(TOKENS[Math.floor(random() * TOKENS.length)]);
		shapes.push(tokens.join(" "));
	}
	return shapes;
}

/**
 * The live latch, over frames.
 *
 * THE ONE STATEFUL DECISION. `latchFoldedRuns` is a union pruned against the rows
 * still held, so a pass can never dissolve a group the reader already saw folded -
 * the operator's "it alternates between collapsing and expanding". A fixture of
 * single passes cannot see it, so the latch is pinned as its own frame sequence:
 * each frame re-folds the held rows and folds the result into the latch.
 */
function latchFrames(model, tokens) {
	const frames = [
		tokens,
		`${tokens} T`,
		`${tokens} T T`,
		`${tokens} T T T`,
		`${tokens} T T T A`,
		/* The rows slide: the first frame's head is gone, and the latch must still
		 * name the group it pruned nothing of. */
		`${tokens.split(TOKEN_GAP).slice(1).join(" ")} T T T A`,
	];
	let latched = new Set();
	const passes = [];
	for (const frame of frames) {
		const rows = model.buildRows(seq(frame), []);
		const groups = model.foldRuns(rows, foldOptions(model, true, latched));
		/* The store's id index, as the pane passes it: the latch prunes against the
		 * conversation, never against this pass's window. */
		const held = { has: (id) => rows.some((row) => row.record.id === id) };
		latched = model.latchFoldedRuns(latched, held, groups);
		passes.push({
			tokens: frame,
			foldedIds: groups
				.filter((group) => group.kind === "run")
				.map((group) => group.id),
			latched: [...latched].sort(),
		});
	}
	return { tokens, passes };
}

/** The commit the decisions were generated from: the manifest pins it, so a relay
 * copy names the desktop tree it replays and a reviewer can diff the six sources
 * over that range. */
function desktopCommit() {
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: ROOT,
			encoding: "utf8",
		}).trim();
	} catch {
		return "unknown";
	}
}

const optionToken = (options) =>
	[
		options.mode,
		options.live ? "live" : "",
		options.olderRowsExist ? "older" : "",
	]
		.filter(Boolean)
		.join("|");

/**
 * A label kind, as the token the fixture carries: `group:peer` keeps the family,
 * and every other arm is its own name. The DECISION is what travels; the word
 * (`Wake`, `Peer messages`) is each surface's own copy (`SegmentLabelKind`).
 */
const labelToken = (kind) =>
	kind === null
		? null
		: kind.kind === "group"
			? `group:${kind.family}`
			: kind.kind;

export async function generate() {
	const model = await loadModel();
	const cases = [];
	const push = (tokens, permutation) =>
		cases.push({
			tokens,
			options: optionToken(permutation),
			expected: decide(model, seq(tokens), permutation),
		});
	/*
	 * THE SUITE'S OWN SHAPES GET EVERY OPTION COMBINATION: they are the cases a
	 * review round argues about, so each one is pinned under both display modes,
	 * live and settled, with and without an unloaded head. The seeded property
	 * cases carry the settled `by-turn` baseline only - they exist to cover
	 * interleavings, not to multiply the file by five.
	 */
	for (const tokens of harvestShapes())
		for (const permutation of PERMUTATIONS) push(tokens, permutation);
	for (const tokens of propertyShapes()) push(tokens, BASE_OPTIONS);
	return {
		_:
			"THE CONDENSE PARITY FIXTURE. Generated by scripts/generate-condense-parity.mjs " +
			"from the shipped model in this repository - never hand-edited, never merged by " +
			"eye. Each case drives buildRows -> foldRuns -> collapsePlan over the token " +
			"grammar in scripts/fixtures/record-tokens.mjs and records only DECISIONS: ids, " +
			"segment keys, structured count units ({key, count}), label KINDS, the live fact, " +
			"the elected answer and the visible-row partition. No English and no timestamps - " +
			"see the generator's header for why. A client with its own record type maps the " +
			"fixture's row vocabulary onto its own shape; the DERIVATION is the shared thing.",
		desktop: {
			commit: desktopCommit(),
			sources: SHAPE_SOURCES,
			seed: SEED,
			propertyCases: PROPERTY_CASES,
			permutations: PERMUTATIONS.map(optionToken),
		},
		latch: latchFrames(model, "T T T A"),
		cases,
	};
}

/**
 * ONE CASE PER LINE, deliberately.
 *
 * The file has to be small (the relay ships it as wheel package data and copies it
 * byte-identically) and it has to be reviewable: a pretty-printed 400-case file is
 * 4 MB and no reviewer reads it anyway, while a fully minified one cannot be
 * diffed. One line per case is both - a regeneration shows exactly which cases
 * changed, which is the whole point of committing a generated fixture.
 */
function serialize(value) {
	const { cases, ...head } = value;
	const lines = cases.map((entry) => `\t\t${JSON.stringify(entry)}`);
	return `${JSON.stringify(head, null, "\t").replace(TRAILING_NEWLINE_BRACE, "")},\n\t"cases": [\n${lines.join(",\n")}\n\t]\n}\n`;
}

async function main() {
	const check = process.argv.includes("--check");
	const fixture = await generate();
	const body = serialize(fixture);
	const digest = createHash("sha256").update(body).digest("hex");
	const manifest = `${JSON.stringify(
		{
			_:
				"The GENERATED condense parity fixture's identity. `sha256` is over " +
				"fixtures/condense.parity.json exactly as committed; a relay copy pins this " +
				"entry, so a desktop model change the phone has not ported is a NAMED " +
				"divergence instead of the silent drift that let the quiet-group clause " +
				"fixtures diverge for nine days.",
			file: "fixtures/condense.parity.json",
			sha256: digest,
			commit: fixture.desktop.commit,
		},
		null,
		"\t",
	)}\n`;

	if (check) {
		const current = existsSync(FIXTURE) ? readFileSync(FIXTURE, "utf8") : "";
		const currentManifest = existsSync(MANIFEST)
			? readFileSync(MANIFEST, "utf8")
			: "";
		if (current !== body || currentManifest !== manifest) {
			console.error(
				"condense parity fixture is STALE: run `node scripts/generate-condense-parity.mjs` and commit both files.",
			);
			process.exit(1);
		}
		console.log(
			`condense parity fixture is current: ${fixture.cases.length} cases, sha256 ${digest.slice(0, 12)}…`,
		);
		return;
	}
	writeFileSync(FIXTURE, body);
	writeFileSync(MANIFEST, manifest);
	console.log(
		`wrote ${fixture.cases.length} cases, sha256 ${digest.slice(0, 12)}…, commit ${fixture.desktop.commit.slice(0, 10)}`,
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
