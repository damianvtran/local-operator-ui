import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

/*
 * THE READER'S FOOT OVER ITS ABSENCE ARMS: rendered, not read off the source.
 *
 * `docs/run-sidebar.md` § 5.8 records one gap and defers it: a RUNNING child
 * whose page is still empty — `pending`, `gone`, or `ready` with no rows — is
 * answered by a `QuietLine`, so `CanonicalTranscript` is never mounted and the
 * foot line never reaches the DOM, while the row is running and the relay has
 * already sent it an activity string. The follow-up that closes the gap adds a
 * line above one of those arms.
 *
 * WHY THIS FILE EXISTS. That deferral was first pinned by counting source
 * strings in `run-detail-model.test.mjs` — five `<QuietLine>`s, one
 * `workingLine={workingLine}` — and round 2's R2-4 mutated the component in
 * exactly the follow-up's shape (a working line above the `pending` arm) and the
 * pin stayed GREEN: none of the counted strings changes when a line is added, so
 * the pin claimed a behaviour it could not see. A pin on a DEFERRAL has to fail
 * on the day the deferral is taken up, which is a property of the render and not
 * of the file, so the assertion is now on the mounted pane.
 *
 * WHAT IT DRIVES. The shipped `RunChildReader` — the real reader, with the props
 * `run-panel.tsx` hands it — over the fixture's own preview page, on the running
 * child the reader set photographs. Nothing is stubbed but the seam the stories
 * themselves use (`previewPage`, which nulls the hook's `childId` and makes no
 * request). The control is the same row over a page that HAS rows: without it the
 * absence assertions would pass on a reader that renders nothing at all, and that
 * is the failure mode a source-shaped pin cannot even see.
 *
 * HOW IT RENDERS. `react-dom/server`, deliberately: the question is what the
 * tree CONTAINS, not how it behaves over time, and a static render needs no
 * document, no animation frame and no timer — so there is no interval left to
 * outlive the assertions, which is what a client mount of a row with a spinner
 * would otherwise leave behind.
 *
 * WHAT IT DOES NOT CLAIM. Nothing here is visual evidence: the committed frames
 * under `docs/evidence/` are. `loading` is not reachable from the preview seam
 * (`previewPage.state` is `ready`/`pending`/`gone`), and the no-session-id arm
 * needs a row without a `child_session_id`, so those two arms are not exercised
 * here.
 */

const SOURCE = "src/renderer/src/features/chat/components/run-details";
/*
 * React and React Query stay OUT of the bundle and everything else goes in
 * (`run-panel-navigation.test.mjs`'s rule, and for its reason): React, so the
 * mounted pane shares THIS process's copy — element symbols and `act` are
 * per-instance, and a second copy would render a tree this test cannot flush —
 * and React Query because the provider below and the hooks inside the pane have
 * to be the same module. Everything else IS bundled, which is the opposite of
 * `composer-tip-react.test.mjs`: the pane's body reaches MUI through DEEP
 * specifiers (`@mui/material/styles`), and node's ESM resolver refuses a
 * directory import, so leaving those external makes the bundle unloadable rather
 * than merely larger.
 */
const EXTERNAL = /^(react|react-dom|@tanstack\/react-query)(\/.*)?$/;
/** Any bare specifier, so staying out of the bundle means being named above. */
const BARE_SPECIFIER = /^[^./]/;
const bundle = await build({
	stdin: {
		contents: `
			export { RunChildReader } from "./${SOURCE}/run-child-reader";
			export { childrenOf, deriveRunDetails } from "./${SOURCE}/run-detail-model";
			export * as fixtures from "./${SOURCE}/run-details.fixtures";
		`,
		loader: "tsx",
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	/*
	 * `module` FIRST: MUI ships both builds and its package `main` is the CJS one,
	 * which calls `require("react")` at run time — a dynamic require that esbuild's
	 * ESM output refuses to carry, so the bundle would load and then die on the
	 * first MUI import.
	 */
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	plugins: [
		{
			name: "react-stays-out",
			setup(builder) {
				builder.onResolve({ filter: BARE_SPECIFIER }, (args) =>
					EXTERNAL.test(args.path) ? { path: args.path, external: true } : null,
				);
			},
		},
	],
	jsx: "automatic",
	// The app stylesheet arrives through the stories' import graph; no rule in it
	// can act on a DOM without layout.
	loader: { ".css": "empty" },
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45999" };',
	},
	alias: {
		"@assets": `${process.cwd()}/src/renderer/src/assets`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@renderer": `${process.cwd()}/src/renderer/src`,
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
	},
	write: false,
});
/*
 * Under `node_modules/.cache/`, the home `run-panel-navigation.test.mjs` gives its
 * own bundle: a crashed run leaves a file there rather than one in the scripts
 * tree, and git never sees either.
 */
const CACHE = join(
	process.cwd(),
	"node_modules",
	".cache",
	"child-reader-foot",
);
mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, "pane.mjs");
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { RunChildReader, childrenOf, deriveRunDetails, fixtures } = await import(
	pathToFileURL(bundlePath).href
);
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);

const h = React.createElement;
/** The child the reader set photographs: running, with a stated intent. */
const CHILD_ID = "job-reader";
const details = deriveRunDetails({
	nowMs: fixtures.FIXTURE_NOW_MS,
	jobs: [fixtures.readerChild()],
	todos: [],
});
const row = details.lineage.find((candidate) => candidate.id === CHILD_ID);
// The precondition the whole file rests on: the row IS running and DOES have an
// activity string, so a line that does not paint is the deferral rather than a
// row with nothing to say.
assert.equal(row?.status, "running");
assert.ok(row?.activity, "the fixture row must carry an activity string");

/**
 * The reader itself, over one preview page: the pane's own props are all seam
 * values a test can state, and mounting it directly keeps this file off the pane's
 * `window.api` reads and the roster's disclosure state — neither of which the
 * deferral is about.
 */
const readerEl = (page) =>
	h(RunChildReader, {
		row,
		childRows: childrenOf(details.lineage, row),
		childrenOpenable: true,
		onOpenChild: () => undefined,
		sessionId: "a1b2c3d4e5f6",
		pulse: 4,
		live: true,
		previewPage: page,
		attachmentScope: null,
		onUnopenable: () => undefined,
		measuredAtMs: fixtures.FIXTURE_NOW_MS,
		measuredAtRealMs: fixtures.FIXTURE_NOW_MS,
		paneWidth: 420,
	});

/**
 * One render of the pane, as static markup.
 *
 * React Query's provider is still needed: the reader's `useChildTranscript`
 * hook is called on every render whether or not its query runs, and a missing
 * client is an exception rather than a skipped fetch.
 */
const render = (element) =>
	renderToStaticMarkup(
		h(
			QueryClientProvider,
			{
				client: new QueryClient({
					defaultOptions: {
						queries: { retry: false, gcTime: 0 },
						mutations: { retry: false, gcTime: 0 },
					},
				}),
			},
			element,
		),
	);

/** The foot line's own mark, from `working-line.tsx`. */
const LINE = "data-lo-working-line";
/** The fixture child's stated intent, which the control's line must carry. */
const INTENT = /Auditing the pending ledger rows/;
/**
 * Static markup with React's own escaping undone, for the assertions that read
 * copy: an apostrophe reaches the string as `&#x27;`, so `gone`'s
 * "This subagent's session directory…" is in the markup and not in the text.
 */
const textOf = (html) => html.replaceAll("&#x27;", "'");

test("no absence arm paints the foot line, and the same row does over a page with rows", () => {
	/*
	 * The three states the deferral names that the preview seam can reach, each
	 * with the copy its arm owns (`§ 10.1`) — a line added above one of these arms
	 * is what the follow-up will do, and it fails here.
	 */
	const empty = fixtures.childPage();
	const arms = [
		[
			"pending",
			fixtures.childPage({ state: "pending" }),
			"This subagent has no transcript on disk yet.",
		],
		[
			"gone",
			fixtures.childPage({ state: "gone" }),
			"This subagent's session directory is no longer on disk.",
		],
		[
			"ready with no rows",
			{ ...empty, entries: [] },
			"This subagent has no conversation on record yet.",
		],
	];
	for (const [name, page, copy] of arms) {
		const html = render(readerEl(page));
		assert.ok(
			textOf(html).includes(copy),
			`the ${name} arm's own copy must still be there`,
		);
		assert.ok(
			!html.includes(LINE),
			`a running child with an EMPTY page (${name}) must paint NO foot line — this is the deferral § 5.8 records, and the change that closes it has to change this assertion`,
		);
	}

	/*
	 * The CONTROL. The same row, the same pane, a page that carries rows: if this
	 * cannot find a line, the absence assertions above are measuring a pane that
	 * renders no reader, and the pin proves nothing.
	 */
	const control = render(readerEl(fixtures.childPage({ includeTool: true })));
	assert.ok(
		control.includes(LINE),
		"the pane has no foot line at all to be absent",
	);
	assert.match(
		control,
		INTENT,
		"the control's foot line must carry the row's own activity string",
	);
});
