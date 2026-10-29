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
import { isEntryPoint } from "./entry-point.mjs";
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

/**
 * A HAND-BUILT TIER CORPUS, grouped by the SUITE whose decision each case targets.
 *
 * WHAT THIS IS, precisely (agent review round 2, C0-n2 - the round-1 header
 * overclaimed). It is NOT a harvest of what those suites drive: only
 * `turn-segments.test.mjs` writes its fixtures as shape strings, and the other two
 * build them from local helpers (`row("a")`, `tool("t1", …)`, `custom("j1", …)`),
 * which no regex can turn into a sequence. So these shapes were written by hand,
 * grouped under the suite whose ARM each one exercises:
 * - the partition suite: turn boundaries and cycle opens;
 * - the plan suite: settled turns, head-cut runs, live cycles, quiet groups and the
 *   failure tally;
 * - the fold suite: the run thresholds, the class/kind/name count line, the receipt
 *   families and the tail.
 *
 * THE COST OF HAND-KEEPING IS VISIBLE ON PURPOSE. A suite that gains a shape this
 * table cannot express is a review-visible edit here, and the generator THROWS on a
 * catalogue entry the grammar cannot build rather than filtering it out - the first
 * version used letters that were never tokens and they vanished silently.
 *
 * The literal harvest still runs beside this table and covers the one suite that
 * writes shapes as strings; its widened regex also picks up English test titles from
 * the other two, which the token filter then drops. Nothing is lost by that, and it
 * is why the contribution test asserts the table, not the harvest.
 */
const SUITE_SHAPES = {
	/*
	 * The partition and cycle suite: its assertions are about which row is the
	 * answer and which rows hide, so its shapes are turn boundaries and cycle
	 * opens (a lead-in `L`, a handover `A`, a terminal `M`, a steer inside a run).
	 */
	"scripts/turn-segments.test.mjs": [
		"U T T T A",
		"U T A T A",
		"U T L T A",
		"U T F",
		"U T T T M",
		"U A T T A",
		"U T T J A",
		"U T T H A",
		"U T T X A",
		"U W T T A",
		"U P T T A",
		"U I T A",
	],
	/*
	 * The plan suite: settled turns, head-cut runs, live cycles, quiet groups and
	 * the failure tally. Its own fixtures name `opening`/`tool`/`custom` helpers,
	 * so these mirror them.
	 */
	"scripts/turn-collapse-model.test.mjs": [
		"U T T T A T A",
		"U A T T T A",
		"U T T T T T A",
		"U P J A",
		"U T J J T A",
		"U W W A",
		"U X X A",
		"U Fa Fa Fa A",
		"U Du Du Du A",
		"U T Fa Du A",
		"U T T C A",
		"U T T T A T T",
	],
	/*
	 * The fold suite: the run thresholds, the class/kind/name count line, the
	 * receipt families and the tail. These are the shapes that pin the ARITHMETIC.
	 */
	"scripts/trace-fold-model.test.mjs": [
		"T T T",
		"T T",
		"T T T T T",
		"T J J",
		"T P W",
		"T T T J X",
		"Rd Wr Sr Wb",
		"Rd Rd Rd",
		"Py Py Py",
		"Ak Ak",
		"Py Ak Td",
		"Sr Wb Rd",
		"Mc Mc",
		"Mc Rd Sr",
		"Ag Ag Ag",
		"Td Td",
		"Td Rd Rd",
		"Fa Fa Fa",
		"Fa T T",
		"Du T Du",
		"Du Du Rd",
		"U Rd Wr Sr Wb Mc Ag Td Py Ak A",
		"U Fa Fa Fa Du Du Du A",
	],
};

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
/**
 * THE BUNDLE, and the exact list of repository files it reads.
 *
 * WHY THE LIST COMES FROM ESBUILD AND NOT FROM THIS FILE. The pin's whole claim is
 * "the fixture was generated from these sources", and round 1 listed seven files by
 * hand while the bundle actually pulls in twenty - so a decision-changing edit to
 * any of the other thirteen moved the fixture's bytes with the SOURCE pin standing
 * still. `metafile.inputs` is esbuild's own answer to "what did this build read",
 * so it cannot drift from the build it describes. Three inputs are not repository
 * files and are dropped: the synthetic stdin entry, and any `node_modules` path
 * (a dependency bump is not a model change, and the lockfile already pins it).
 */
async function bundleModel() {
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
			/*
			 * THE CORE, NOT THE RENDERER BINDING (agent review round 1, M4).
			 * `@shared/i18n` is a renderer alias for `shared/i18n`, whose index also
			 * re-exports the query-client stack and the locale writer - so `t()` alone
			 * dragged `desktop-hooks`, `desktop-api`, `use-optional-query-client`,
			 * `language-writes` and `delegated-cleanup-notice-store` into the pin. Those
			 * are the transport, not the model's decisions: a cosmetic edit there moved
			 * `sourceHash` and failed the parity test until someone regenerated a fixture
			 * that had not changed a single decision. The 24 model harnesses already
			 * alias the same way, so the pin now hashes what it claims to hash.
			 */
			"@shared/i18n": `${ROOT}/src/i18n`,
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		metafile: true,
		/*
		 * ABSOLUTE WORKING DIRECTORY, or the pin is checkout-relative (agent review
		 * round 3, C0-M3). esbuild keys `metafile.inputs` relative to
		 * `absWorkingDir`, which defaults to `process.cwd()`; `resolveDir` pins
		 * RESOLUTION only. From `scripts/` the keys arrived one directory short and
		 * `readFileSync(join(ROOT, key))` crashed with ENOENT, from `/` the absolute
		 * cwd was prepended into the joined path, and from a scratch directory a plain
		 * regeneration WROTE the fixture with `../../../Users/...` entries in
		 * `modelSources` - a committed file whose content depended on where the
		 * operator stood. With this set the keys are repo-relative by construction.
		 */
		absWorkingDir: ROOT,
	});
	return {
		code: bundle.outputFiles[0].text,
		inputs: Object.keys(bundle.metafile.inputs)
			.filter(
				(input) =>
					!input.includes("node_modules") &&
					!input.startsWith("<") &&
					/*
					 * CATALOGUE COPY IS NOT A DECISION. Wave B keys the row labels, so the
					 * model bundle now loads the whole English catalogue set; pinning those
					 * ~760 files would make every copy edit invalidate a fixture that records
					 * only ids, segment keys, counts and label KINDS, and the i18n gates own
					 * the values. Generated key catalogues are excluded for the same reason:
					 * they carry no condensation decision, so every translation PR would move
					 * the hash and redden core's build for all open core PRs while all 660
					 * decisions stayed byte-identical. The pin therefore covers the model's
					 * CODE and the locale manifest, not generated copy metadata.
					 */
					!input.startsWith("src/i18n/catalogues/") &&
					!input.startsWith("src/i18n/keys.gen."),
			)
			.map((input) => input.replace(/^\.\//, ""))
			.sort(),
	};
}

/** The loaded model, for the generator's own use. */
async function loadModel() {
	const { code } = await bundleModel();
	const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
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
	for (const [suite, shapesOfSuite] of Object.entries(SUITE_SHAPES))
		for (const shape of shapesOfSuite) {
			/*
			 * A CATALOGUE ENTRY THE GRAMMAR CANNOT BUILD IS A BUG, NOT A SKIP. The
			 * first version of this file filtered unbuildable shapes out with the
			 * harvested ones, so a catalogue full of letters the grammar never
			 * defined (B/D/G/V) contributed nothing and said nothing - exactly the
			 * silent-gap class the fixture exists to close.
			 */
			const trimmed = shape.trim();
			for (const token of trimmed.split(TOKEN_GAP))
				if (!(token in RECORDS))
					throw new Error(
						`${suite}: shape "${trimmed}" uses token "${token}", which the grammar does not define`,
					);
			shapes.add(trimmed);
		}
	for (const file of SHAPE_SOURCES) {
		const text = readFileSync(join(ROOT, file), "utf8");
		for (const match of text.matchAll(
			/(?:seq|partition)\("([A-Za-z0-9 ]+)"\)/g,
		))
			shapes.add(match[1].trim());
		for (const match of text.matchAll(
			/^\s*"([A-Za-z0-9](?: [A-Za-z0-9]+)+)",?$/gm,
		))
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
/**
 * The tokens a seeded case may draw from.
 *
 * TWO POOLS, and the split is the point. `Z`/`R` are the quiet `no_reply` call,
 * which the relay wire cannot carry at all, so a property run drawn uniformly
 * from the whole grammar spends most of its cases on shapes the PHONE cannot
 * replay - the first corpus's 120 seeded cases were 110 of that kind. One case in
 * eight still draws from the full grammar, so an interleaving that mixes a quiet
 * call into a real turn is covered; the other SEVEN IN EIGHT draw from the
 * expressible pool, so most seeded cases are a shared decision both surfaces owe.
 */
const QUIET_TOKENS = new Set(["Z", "R"]);
const EXPRESSIBLE_TOKENS = TOKENS.filter((token) => !QUIET_TOKENS.has(token));
const FULL_POOL_SHARE = 1 / 8;

function propertyShapes() {
	const random = mulberry32(SEED);
	const shapes = [];
	for (let i = 0; i < PROPERTY_CASES; i += 1) {
		const length = 3 + Math.floor(random() * 78);
		const pool = random() < FULL_POOL_SHARE ? TOKENS : EXPRESSIBLE_TOKENS;
		const tokens = [];
		for (let at = 0; at < length; at += 1)
			tokens.push(pool[Math.floor(random() * pool.length)]);
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

/**
 * THE MODEL SOURCE THE FIXTURE WAS GENERATED FROM, as one hash.
 *
 * WHY A SOURCE HASH AND NOT `git rev-parse HEAD`. A commit cannot contain its own
 * SHA, so a fixture that embeds HEAD is stale the moment it is committed: the
 * freshness check then fails on every commit - the gate nobody can pass. The source
 * files ARE what the decisions came from, they are committed beside the fixture, and
 * their hash can be recomputed at any commit. So the pin is stable and, unlike a
 * commit id, self-verifying: it fails if a bundled model file changes without a
 * regeneration, which is the drift this file exists to catch.
 *
 * WHAT IT COVERS: every repository file the bundle reads, taken from esbuild's own
 * metafile (`bundleModel().inputs`). Round 1 hand-listed seven of the twenty, so a
 * change to one of the other thirteen moved the fixture while this pin stood still.
 */
export async function modelSourceHash() {
	const { inputs } = await bundleModel();
	const digest = createHash("sha256");
	for (const file of inputs) {
		digest.update(file);
		digest.update("\u0000");
		digest.update(readFileSync(join(ROOT, file)));
		digest.update("\u0000");
	}
	return digest.digest("hex");
}

/** The repository files the bundle reads, sorted: what the source pin covers. */
export async function bundledSources() {
	return (await bundleModel()).inputs;
}

/** The shapes each declared suite drives, for the corpus-coverage test. */
export const SHAPES_BY_SOURCE = SUITE_SHAPES;

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
			sourceHash: await modelSourceHash(),
			modelSources: await bundledSources(),
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
	/*
	 * `--print` emits the exact FIXTURE bytes a regeneration would write, and writes
	 * nothing. It exists for the cwd-independence regression: proving "the same bytes
	 * from any directory" must not require running a real regeneration from a foreign
	 * cwd, which is precisely the accident C0-M3 describes.
	 */
	const print = process.argv.includes("--print");
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
			sourceHash: fixture.desktop.sourceHash,
		},
		null,
		"\t",
	)}\n`;

	if (print) {
		/* ONLY the fixture bytes: the manifest's `sha256` covers exactly these, so a
		 * caller can compare the emitted hash with the pin directly. The manifest's own
		 * bytes are covered by `--check`, which compares both files. */
		process.stdout.write(body);
		return;
	}

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
		`wrote ${fixture.cases.length} cases, sha256 ${digest.slice(0, 12)}…, sources ${fixture.desktop.sourceHash.slice(0, 12)}…`,
	);
}

/*
 * THE ENTRY POINT IS RESOLVED, NOT COMPARED AS A STRING. `process.argv[1]` is
 * whatever the caller typed while `import.meta.url` is physical, so through a
 * symlinked directory (macOS `/tmp` -> `private/tmp`, the ordinary case) they
 * disagree - and silently: the module loads, `main()` never runs, nothing prints,
 * exit 0. A `--check` that exits 0 having checked nothing is the exact failure
 * this generator exists to prevent, so it goes through `scripts/entry-point.mjs`
 * like every other script here.
 */
if (isEntryPoint(import.meta.url)) await main();
