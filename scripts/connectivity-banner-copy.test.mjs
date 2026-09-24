import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE FRAMES MUST DOCUMENT THE SENTENCE THE APP SHIPS (design round 1, D2; review
 * round 1, R1-7).
 *
 * WHY THIS FILE EXISTS. `connectivity-banner.stories.tsx` carries a hand-written
 * `detail` per state, and `common-connectivity-banner--unattachable` is a STORIES row
 * of `scripts/capture-evidence.mjs` - so the frames committed under
 * `docs/evidence/common-connectivity-banner/unattachable/` photographed that string.
 * When this change replaced the sentence, the fixture kept the old one, and the
 * result was measured rather than argued: the committed evidence documented copy the
 * app no longer shipped, and the next sweep would have re-shot the stale fixture and
 * agreed with itself. Nothing mechanical objected, which is the gap this file closes.
 *
 * WHAT IT CHECKS, in both directions. The shipped composers in
 * `src/main/backend/backend-service.ts` (`describeHolders`, `describeSpawnRefusal`) and
 * the shipped copy table in `src/shared/backend-status.ts` (`serverBannerCopy`) are
 * bundled and run; the story file is read as text. Then:
 *
 *   - the two occupied stories' `detail` must EQUAL what the composer produces for the
 *     occupancy record the story's own pid/version/install_kind describe, so a copy
 *     change in main fails here until the fixture (and therefore the frame) is
 *     re-captured;
 *   - the substitution story's `holder` must equal `describeHolders` for the same
 *     record, so the band's holder clause cannot become a second spelling of a fact
 *     main already words;
 *   - the copy table must have a presentation for the fallback-taken state at all, must
 *     carry main's holder clause verbatim inside it, and must report the return.
 *
 * WHY TEXT RATHER THAN AN IMPORT of the stories: that file is `.tsx` with Storybook
 * and React imports, so it is not something a node harness can evaluate - and the
 * subject here is as much the literal as the component.
 */

const HOME = mkdtempSync(join(tmpdir(), "banner-copy-"));
mkdirSync(join(HOME, "userData"), { recursive: true });

const bundle = await build({
	stdin: {
		contents:
			'export { serverBannerCopy } from "./src/shared/backend-status.ts"; export { describeHolders, describeSpawnRefusal, reclaimClause } from "./src/main/backend/backend-service.ts";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			/*
			 * The main-process fixtures `scripts/owned-serve-lifecycle.test.mjs` and
			 * `daemon-observation.test.mjs` use, and for the same reason: this file
			 * must not touch the operator's own config, log or daemon on any path. The
			 * composers below are pure, so the stubs are never reached - they exist so
			 * that stays true if a future edit makes one reach for `app` or the logger.
			 */
			name: "main-process-fixtures",
			setup(builder) {
				builder.onResolve({ filter: /^electron$/ }, () => ({
					path: "electron",
					namespace: "fixture",
				}));
				for (const filter of [/^\.\/logger$/, /^\.\/config$/]) {
					builder.onResolve({ filter }, (args) =>
						args.importer.endsWith("main/backend/backend-service.ts")
							? { path: args.path, namespace: "fixture" }
							: undefined,
					);
				}
				builder.onLoad(
					{
						filter: /^(electron|\.\/logger|\.\/config)$/,
						namespace: "fixture",
					},
					(args) => ({
						contents:
							args.path === "electron"
								? `export const app = { getPath: () => ${JSON.stringify(HOME)}, whenReady: async () => {}, on: () => {}, quit: () => {}, isPackaged: false }; export const dialog = { showErrorBox: () => {} }; export default { app, dialog };`
								: args.path === "./logger"
									? 'export const LogFileType = { INSTALLER: "installer", BACKEND: "backend" }; const emit = () => () => {}; export const logger = { info: emit(), warn: emit(), error: emit(), debug: emit(), verbose: emit() };'
									: 'export const backendConfig = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:1111", VITE_DISABLE_BACKEND_MANAGER: "false" };',
						loader: "js",
					}),
				);
			},
		},
	],
});

const {
	serverBannerCopy,
	describeHolders,
	describeSpawnRefusal,
	reclaimClause,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const stories = readFileSync(
	"src/renderer/src/shared/components/common/connectivity-banner.stories.tsx",
	"utf8",
);

/**
 * One story's source, so its literals can be read without another story's.
 *
 * Bounded by the next `export const`, which every story in that file starts with.
 */
const storyBody = (name) => {
	const start = stories.indexOf(`export const ${name}: Story`);
	assert.ok(start > 0, `the story this test pins is still here: ${name}`);
	const end = stories.indexOf("export const ", start + 1);
	return stories.slice(start, end === -1 ? undefined : end);
};

/** The value of one `field:` string literal inside a story. */
const literal = (name, field) => {
	const body = storyBody(name);
	const match = body.match(new RegExp(`${field}:\\s*\\n?\\s*"([^"]*)"`));
	assert.ok(match, `${name} carries a ${field} literal`);
	return match[1];
};

/*
 * The occupancy records the fixtures describe. The shape is `AddressOccupant`'s, and
 * the values are the ones the stories name: `pid 42411, uv-tool, v0.55.6` at 1111 and
 * `pid 53501, v0.55.5` at 8080 (no `install_kind`, so no install fact).
 */
const occupant = (over) => ({
	address: "http://127.0.0.1:1111",
	pid: null,
	pidSource: null,
	version: "",
	prefix: "",
	installKind: "",
	startedAtMs: null,
	desktopReadStatus: null,
	...over,
});
const daemonRecord = (over = {}) => ({
	kind: "daemon",
	occupant: occupant({
		pid: 42411,
		pidSource: "answer",
		version: "0.55.6",
		installKind: "uv-tool",
		...over,
	}),
	detail: "answered with a different instance id",
});
const oneHolder = [daemonRecord()];
const bothHeld = [
	daemonRecord(),
	daemonRecord({
		address: "http://127.0.0.1:8080",
		pid: 53501,
		version: "0.55.5",
		installKind: "",
		/*
		 * NO `install_kind`, so the install fact is the prefix's LAST SEGMENT - the shape
		 * design round 2's D4 asked to see in a frame rather than in prose (the band used
		 * to render the whole 47-character home path).
		 */
		prefix: "/Users/you/.local/share/uv/tools/local-operator",
	}),
];

test("the two-holder frame carries the prefix-derived install name, and the class once", () => {
	assert.equal(
		literal("BothAddressesHeld", "detail"),
		describeSpawnRefusal(bothHeld),
		"the two-holder frame documents this one",
	);
	assert.match(
		literal("BothAddressesHeld", "detail"),
		/are running Local Operator daemons this app has no key for/,
		"the class is stated ONCE for two holders (design round 1, D6)",
	);
	assert.match(
		literal("BothAddressesHeld", "detail"),
		/\(pid 53501, local-operator, v0\.55\.5\)/,
		"a holder with no install_kind is named by the prefix's last segment, not the path (design round 2, D4/D11)",
	);
	assert.doesNotMatch(
		literal("BothAddressesHeld", "detail"),
		/\/Users\//,
		"and the home path itself is prose the sentence does not spend",
	);
	assert.match(
		literal("BothAddressesHeld", "detail"),
		/Stop them from the installs that own them/,
		"the act's verb agrees with the holders: two of them are not `it` (design round 2, D9)",
	);
	assert.match(
		literal("Unattachable", "detail"),
		/lop services reclaim 42411/,
		"and the sentence names the act, with the pid it needs (design round 1, D3)",
	);
	assert.match(
		literal("Unattachable", "detail"),
		/Stop it from the install that owns it with/,
		"the singular form is kept for a single holder (design round 2, D9)",
	);
});

/*
 * THE START FACT IS RENDERED BUT NOT PHOTOGRAPHED (design round 2, D11), and the
 * reason is in the second assertion: the sentence carries the reader's own locale and
 * timezone, so a fixture literal with a clock time in it would document the machine
 * that shot the frame rather than the tree. What can be pinned here is the SHAPE the
 * design round asked for - a humanised start, never the raw ISO-8601 instant with
 * milliseconds this replaced - and the README's "What these frames do not prove"
 * states the gap for the frame half.
 */
test("a holder that published a start time renders it in the reader's terms, never as a raw instant", () => {
	const withStart = describeHolders([
		daemonRecord({
			address: "http://127.0.0.1:8080",
			pid: 53501,
			version: "0.55.5",
			installKind: "",
			prefix: "/Users/you/.local/share/uv/tools/local-operator",
			startedAtMs: Date.parse("2026-01-05T16:00:00Z"),
		}),
	]);
	assert.match(withStart, /started /, "the start time is rendered at all (D4)");
	assert.doesNotMatch(
		withStart,
		/T\d\d:\d\d:\d\d\.\d{3}Z/,
		"and never as the raw ISO-8601 UTC instant with milliseconds the finding measured",
	);
	assert.doesNotMatch(
		withStart,
		/\.\d{3}/,
		"nor with a millisecond fraction anywhere in it",
	);
});

test("the substitution stories carry main's own holder clause AND its own act", () => {
	assert.equal(
		literal("ServingOnFallback", "holder"),
		describeHolders(oneHolder),
		"the band's holder clause and the log line are one function's output",
	);
	/*
	 * AGENT ROUND 2, R2-4 (and design round 2, D9). THE ACT IS MAIN'S TOO. This band
	 * used to spell it by hand as `lop services reclaim <pid>` while the `unattachable`
	 * frame printed the same single holder's REAL pid - so the fallback command an
	 * operator reads was the one that cannot be run, one frame apart from the one that
	 * can. The literal has to be the composer's output, pid included.
	 */
	assert.equal(
		literal("ServingOnFallback", "reclaim"),
		reclaimClause(oneHolder).trim(),
		"the act in the band is `reclaimClause`'s output, not a second spelling of it",
	);
	assert.match(
		literal("ServingOnFallback", "reclaim"),
		/lop services reclaim 42411/,
		"and it spends the pid the holder clause two clauses earlier already named",
	);
});

test("the fallback-taken state has a presentation, and the return is reported", () => {
	const swap = {
		kind: "substituted",
		configured: "http://127.0.0.1:1111",
		serving: "http://127.0.0.1:8080",
		holder: describeHolders(oneHolder),
		reclaim: reclaimClause(oneHolder).trim(),
	};
	const attached = {
		state: "attached",
		reconnecting: false,
		detail:
			"Connected to the daemon on http://127.0.0.1:8080 (pid 4242, v0.54.47).",
		pairing: { available: true, cause: null },
		addressSubstitution: null,
	};
	/*
	 * The measurement the finding rests on, restated as a test: an ATTACHED app on the
	 * fallback address used to be indistinguishable from one on its configured address,
	 * because `serverBannerCopy` returns null for every attached state.
	 */
	assert.equal(
		serverBannerCopy(attached),
		null,
		"an ordinary attachment still paints nothing",
	);

	const substituted = serverBannerCopy({
		...attached,
		addressSubstitution: swap,
	});
	assert.ok(substituted, "the fallback-taken state has a presentation (D1)");
	assert.match(
		substituted.title,
		/127\.0\.0\.1:8080/,
		"it names where the app is",
	);
	/*
	 * ONE ADDRESS IN THE TITLE (design round 2, D12): the configured address was in
	 * brackets there, spending a second URL in a band that already names three. The
	 * sentence below is where the reader is told where they end up.
	 */
	assert.doesNotMatch(
		substituted.title,
		/127\.0\.0\.1:1111/,
		"the title carries the address the app is on, not both addresses",
	);
	assert.match(
		`${substituted.title} ${substituted.detail}`,
		/127\.0\.0\.1:1111/,
		"and the band still names the address the app is configured for",
	);
	assert.ok(
		substituted.detail.includes(swap.holder),
		"it carries main's holder clause verbatim rather than a second spelling of it (D5)",
	);
	assert.ok(
		substituted.detail.includes(swap.reclaim),
		"and the act with it, so one composer owns both (R2-4)",
	);
	assert.doesNotMatch(
		substituted.detail,
		/<pid>/,
		"the pid is spent where the app knows it (D3, D9)",
	);
	assert.notEqual(
		substituted.dismiss,
		true,
		"a condition the operator still has is not dismissible",
	);

	/*
	 * AGENT ROUND 2, R2-1a: THE ADOPTED DAEMON. The second launch of this incident
	 * re-attaches to the daemon the first one left on the fallback address, so no gate
	 * ran, no address was refused, and there is no holder to name and no act to offer.
	 * It still has to say which address the app is on.
	 */
	const adopted = serverBannerCopy({
		...attached,
		addressSubstitution: { ...swap, holder: null, reclaim: null },
	});
	assert.ok(
		adopted,
		"a launch that adopted a daemon on another address has a presentation too (R2-1)",
	);
	assert.match(adopted.title, /127\.0\.0\.1:8080/);
	assert.doesNotMatch(
		adopted.detail,
		/lop services reclaim/,
		"with no holder there is no act, and none is invented",
	);
	assert.doesNotMatch(
		adopted.detail,
		/is running a Local Operator daemon this app has no key for/,
		"and no holder clause either",
	);
	assert.match(
		adopted.detail,
		/127\.0\.0\.1:1111/,
		"what it does say is the address it is configured for and will look for again",
	);

	const returned = serverBannerCopy({
		...attached,
		addressSubstitution: {
			kind: "returned",
			configured: "http://127.0.0.1:1111",
			serving: "http://127.0.0.1:8080",
		},
	});
	assert.ok(
		returned,
		"the return to the configured address is rendered, not left as silence",
	);
	assert.match(returned.title, /127\.0\.0\.1:1111/);
	assert.equal(
		returned.dismiss,
		true,
		"and it is the one notice that may be dismissed",
	);
	assert.equal(
		returned.retry,
		false,
		"with no Retry: there is nothing left to try",
	);
});

test("the fallback state's own stories carry the arms the copy above renders", () => {
	/*
	 * The fixtures behind the two `substituted` frames, checked against the contract's
	 * own FIELD SET rather than against the copy: a story that omitted `reclaim` would
	 * render the no-act arm while its name says fallback, and that is exactly the silent
	 * divergence between the story file and the copy table this suite exists to catch.
	 */
	const adopted = storyBody("AttachedElsewhere");
	assert.match(
		adopted,
		/holder:\s*null/,
		"the adopted-daemon story carries no holder: no gate observed one",
	);
	assert.match(
		adopted,
		/reclaim:\s*null/,
		"and no act, because nothing held the configured address as far as this app knows",
	);
	assert.match(
		adopted,
		/kind:\s*"substituted"/,
		"and it is the `substituted` arm, not the return",
	);
	assert.match(
		storyBody("ServingOnFallback"),
		/kind:\s*"substituted"/,
		"the holder-carrying fallback story is the same arm",
	);
});

test("a detached or wedged snapshot keeps its own sentence about the address", () => {
	const swap = {
		kind: "substituted",
		configured: "http://127.0.0.1:1111",
		serving: "http://127.0.0.1:8080",
		holder: describeHolders(oneHolder),
		reclaim: reclaimClause(oneHolder).trim(),
	};
	/*
	 * The substitution is a fact about a launch, and it outlives the attachment - so
	 * the band must not carry it into a state whose own sentence is about the address
	 * the operator configured. Two bands about one address is one too many.
	 */
	for (const state of ["detached", "wedged"]) {
		const copy = serverBannerCopy({
			state,
			reconnecting: false,
			detail: "main's own sentence",
			pairing: { available: true, cause: null },
			addressSubstitution: swap,
		});
		assert.ok(copy, `${state} still has its own presentation`);
		assert.doesNotMatch(
			copy.title,
			/8080/,
			`${state} does not advertise the fallback address it is not using`,
		);
	}
});
