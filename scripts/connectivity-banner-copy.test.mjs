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
			'export { serverBannerCopy } from "./src/shared/backend-status.ts"; export { describeHolders, describeSpawnRefusal } from "./src/main/backend/backend-service.ts";',
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

const { serverBannerCopy, describeHolders, describeSpawnRefusal } =
	await import(
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
	}),
];

test("the occupied stories carry the sentence main composes, not a paraphrase of it", () => {
	assert.equal(
		literal("Unattachable", "detail"),
		describeSpawnRefusal(oneHolder),
		"`unattachable` is a STORIES row of capture-evidence: its frame documents this string",
	);
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
		literal("Unattachable", "detail"),
		/lop services reclaim 42411/,
		"and the sentence names the act, with the pid it needs (design round 1, D3)",
	);
});

test("the substitution stories carry main's own holder clause", () => {
	assert.equal(
		literal("ServingOnFallback", "holder"),
		describeHolders(oneHolder),
		"the band's holder clause and the log line are one function's output",
	);
});

test("the fallback-taken state has a presentation, and the return is reported", () => {
	const swap = {
		kind: "substituted",
		configured: "http://127.0.0.1:1111",
		serving: "http://127.0.0.1:8080",
		holder: describeHolders(oneHolder),
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
	assert.match(
		substituted.title,
		/127\.0\.0\.1:1111/,
		"and where it was told to be, so a reader who knows only one port can still tell",
	);
	assert.ok(
		substituted.detail.includes(swap.holder),
		"and it carries main's holder clause verbatim rather than a second spelling of it (D5)",
	);
	assert.notEqual(
		substituted.dismiss,
		true,
		"a condition the operator still has is not dismissible",
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

test("a detached or wedged snapshot keeps its own sentence about the address", () => {
	const swap = {
		kind: "substituted",
		configured: "http://127.0.0.1:1111",
		serving: "http://127.0.0.1:8080",
		holder: describeHolders(oneHolder),
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
