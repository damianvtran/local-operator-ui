import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";

/*
 * The Library page against the SHIPPED components, with the desktop bridge
 * stubbed at `window.api.desktop.request` - the boundary the app actually
 * crosses, so the query layer, the route, the cards, the preview and the
 * composer all run for real.
 *
 * WHAT IS PINNED:
 * - the four catalogue states (loading skeleton, empty, error with Retry,
 *   populated);
 * - the header's layout contract: it sizes to its content while keeping the
 *   design's 136px floor, and the building line is one of its flow rows above
 *   the results (the fixed-height defect painted it over the grid);
 * - a failed refetch with last-good pages keeps the rows and adds an inline
 *   warning rather than replacing the painted grid with the blocking error;
 * - an image card's thumbnail read waits for the card to be near the viewport;
 * - selection entering `/library/assets/:id` and the preview rendering there
 *   (the standalone branch in this harness, because a JSDOM page reports no
 *   workspace width - the dock branch is a rendered-frame concern);
 * - a linked chat's row, and continuing that chat through `sessions.message`
 *   with the linked session id rather than creating a second session.
 */

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// jsdom accessors that cannot be redefined; the DOM globals above suffice.
	}
}
for (const name of ["Event", "CustomEvent", "MouseEvent", "KeyboardEvent"]) {
	globalThis[name] = dom.window[name];
}
dom.window.Element.prototype.scrollIntoView = () => {};
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
const RESIZE_OBSERVERS = [];
globalThis.ResizeObserver = class {
	constructor(callback) {
		this.callback = callback;
		this.targets = new Set();
		RESIZE_OBSERVERS.push(this);
	}

	observe(target) {
		this.targets.add(target);
	}

	unobserve(target) {
		this.targets.delete(target);
	}

	disconnect() {
		this.targets.clear();
	}
};
/*
 * A CONTROLLABLE IntersectionObserver. jsdom has no layout and implements no
 * observer; the previous no-op stub could never answer, which would make a
 * thumbnail-gating case pass for the wrong reason (nothing "near" because
 * nothing observes). Every instance records the elements it watches, so a case
 * can deliver an intersection the way a real observer would and prove the read
 * happens only after that delivery.
 */
const OBSERVERS = [];
class TestIntersectionObserver {
	constructor(callback) {
		this.callback = callback;
		this.targets = new Set();
		OBSERVERS.push(this);
	}

	observe(target) {
		this.targets.add(target);
	}

	unobserve(target) {
		this.targets.delete(target);
	}

	disconnect() {
		this.targets.clear();
	}
}
globalThis.IntersectionObserver = TestIntersectionObserver;
dom.window.matchMedia = () => ({
	matches: false,
	media: "",
	onchange: null,
	addEventListener() {},
	removeEventListener() {},
	addListener() {},
	removeListener() {},
	dispatchEvent: () => false,
});
URL.createObjectURL = () => "blob:library-test";
URL.revokeObjectURL = () => {};
/*
 * THE CANONICAL STREAM'S TWO TRANSPORT GLOBALS. The trajectory below the asset
 * subscribes with `useCanonicalSessionStream`, which opens a desktop event
 * stream; in this harness a no-op `EventSource` and the shared story shim's
 * `window.electron` satisfy the module's imports without delivering a frame, so
 * the cases assert MOUNTING and the composer's send, not stream semantics
 * (those belong to the transcript's own suites).
 */
globalThis.EventSource = class {
	constructor() {
		this.readyState = 0;
	}
	addEventListener() {}
	removeEventListener() {}
	close() {}
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { after } = await import("node:test");
const { build } = await import("esbuild");
const { act } = await import("react");

/** Deliver one intersection to the observer watching a matching element. */
const intersect = async (predicate) => {
	for (const observer of OBSERVERS) {
		const target = [...observer.targets].find(predicate);
		if (!target) continue;
		await act(async () =>
			observer.callback([{ isIntersecting: true, target }], observer),
		);
		return target;
	}
	return null;
};

/*
 * THE HARNESS IS BUNDLED THE WAY `projects-card-click.test.mjs` bundles its
 * card: the entry runs the SHIPPED page with the app's real providers, and
 * esbuild resolves the renderer's TSX and its `@shared`/`@features` aliases.
 * React and react-dom stay external so the test and the bundle share one
 * instance (two copies of React make `act` report every update as unwrapped).
 */
const ENTRY = `
import "./src/renderer/src/features/chat/components/story-electron-shim";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { LibraryPage } from "./src/renderer/src/features/library/components/library-page";
export { filterAssets, NO_LIBRARY_FILTERS } from "./src/renderer/src/features/library/library-model";
export * as locale from "./src/i18n/locale";

function Jump() {
	const navigate = useNavigate();
	return createElement(
		"div",
		null,
		createElement("button", { "data-go-a": "" , onClick: () => navigate("/library/assets/la_0000000000000014") }, "A"),
		createElement("button", { "data-go-b": "" , onClick: () => navigate("/library/assets/la_0000000000000012") }, "B"),
	);
}

export function mountLibrary(container, nowMs) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const root = createRoot(container);
	root.render(
		createElement(
			QueryClientProvider,
			{ client },
			createElement(
				MemoryRouter,
				{ initialEntries: ["/library"] },
				createElement(Jump),
				createElement(
					Routes,
					null,
					createElement(Route, {
						path: "/library",
						element: createElement(LibraryPage, { nowMs }),
					}),
					createElement(Route, {
						path: "/library/assets/:assetId",
						element: createElement(LibraryPage, { nowMs }),
					}),
					createElement(Route, {
						path: "/chat/:agentId",
						element: createElement("div", null, "chat route"),
					}),
				),
			),
		),
	);
	return { client, root };
}
`;
/*
 * The shared composer pulls the theme module into this graph (the strip it
 * renders reads the store's theme), and that module's only MUI VALUE is
 * `createTheme`; leaving `@mui/material/styles` external makes Node's ESM
 * resolver refuse the package's directory import, because the package is
 * resolved by a bundler in the app. A passthrough factory is enough for the
 * theme object nothing here renders.
 */
const muiStubPath = new URL(
	`./_library-page-mui-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(
	muiStubPath,
	`export const createTheme = (options) => options;
	export const ThemeProvider = ({ children }) => children;
	export const useTheme = () => ({});
	export const alpha = (colour) => colour;`,
);

const bundle = await build({
	stdin: {
		contents: ENTRY,
		resolveDir: process.cwd(),
		sourcefile: "library-page.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	define: { "import.meta.env": "{}" },
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@features/chat/components/chat-sidebar": `${process.cwd()}/scripts/library-test-stubs/chat-sidebar.ts`,
		"@shared/components/common/chat-layout": `${process.cwd()}/scripts/library-test-stubs/chat-layout.ts`,
		"@mui/material/styles": muiStubPath.pathname,
		"@assets": `${process.cwd()}/src/renderer/src/assets`,
	},
	loader: { ".css": "empty", ".png": "dataurl", ".svg": "dataurl" },
	write: false,
});
const bundlePath = new URL(
	`./_library-page-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { mountLibrary, filterAssets, NO_LIBRARY_FILTERS, locale } = await import(
	bundlePath.href
);
await unlink(bundlePath);
await unlink(muiStubPath);

const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime();

/* Class-token readers, hoisted so the layout case allocates no regex per row. */
const CLASS_TOKENS = /\s+/;
/* The Librarian row's age in each language this case drives. Top-level because
 * `useTopLevelRegex` requires it: a literal inside the test body is re-created
 * per call, and the gate treats that as the defect it is on a hot path. */
const AGE_EN = /Last organized 2h ago/;
const AGE_FR = /Dernier classement il y a 2 h/;
const AGE_ZH_CN = /上次整理于2小时前/;
const OUT_OF_FLOW = /(^|\s)(absolute|fixed)(\s|$)/;

const tag = (id, name) => ({ id, name, category: "topic" });
const asset = (id, patch = {}) => ({
	id,
	ref: {
		type: "path",
		path: `/tmp/${id}.md`,
		display_path: `~/${id}.md`,
		digest: null,
		content_type: "text/markdown",
	},
	name: "",
	derived_name: `${id}.md`,
	description: "",
	kind: "markdown",
	category: "document",
	origin: "written",
	origin_group: "created",
	origins: ["written"],
	tags: [],
	primary_tag: null,
	size_bytes: 2048,
	width: null,
	height: null,
	duration_s: null,
	created_at: 1_700_000_000,
	modified_at: 1_700_000_100,
	last_seen_at: 1_700_000_200,
	exists: true,
	highlighted: true,
	highlight_why: null,
	occurrences: [
		{
			session_id: "abcdef123456",
			session_title: "March invoices",
			origin: "written",
			tool: "write_file",
			at: 1_700_000_000,
			intent: null,
			first_seq: 1,
			last_seq: 2,
			child_id: null,
			label: null,
		},
	],
	session_count: 1,
	chat: null,
	preview: { state: "ready", mime_type: "text/markdown", pages: null },
	organized: { at: 1_700_000_300, by: "librarian", confidence: 0.9 },
	locked: false,
	favorite: false,
	archived: false,
	...patch,
});

const ROWS = [
	asset("la_0000000000000011", {
		name: "Invoice notes",
		derived_name: "invoice-notes.md",
		tags: [tag("t1", "finance")],
	}),
	asset("la_0000000000000012", {
		name: "Launch brief",
		derived_name: "launch-brief.md",
		last_seen_at: 1_700_000_100,
	}),
];

const ANSWER = {
	rows: [],
	failList: null,
	failNextPage: false,
	hang: false,
	detail: null,
	/** The path bridge for the live-file case; null keeps it absent. */
	fileBridge: null,
	/** The trajectory's durable page for a case; null is an empty page. */
	history: null,
	/** Every request the page made, for assertions about the wire. */
	requests: [],
	/** A gate the `library.update` answer waits on, so a case can see the paint first. */
	updateGate: null,
	/** Frames the stream bridge emits on subscribe; null keeps the EventSource path. */
	stream: null,
	/** Every options object the page passed to `probeFiles`, in order. */
	probeAsks: [],
	/** A gate the `sessions.create` answer waits on, for a double-press case. */
	createGate: null,
	state: "ready",
	nextCursor: null,
	allTotal: null,
	librarianHang: false,
	librarianGate: null,
	releaseLibrarian: null,
	ops: [],
	mediaOps: [],
	gate: null,
	releaseHang: null,
};

const desktopRequest = async (request) => {
	ANSWER.requests.push(request);
	ANSWER.ops.push(request);
	if (request.op === "capabilities") {
		return {
			status: 200,
			body: {
				result: {
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: { library: 1 },
				},
			},
		};
	}
	if (request.op === "library.update") {
		/*
		 * The write lands on the STORED rows, so the refetch a case triggers
		 * afterwards answers with the patched field - that is what "persists
		 * after a refetch" has to mean here.
		 */
		if (ANSWER.updateGate) await ANSWER.updateGate;
		const patch = (row) =>
			row.id === request.id ? { ...row, ...request.fields } : row;
		ANSWER.rows = ANSWER.rows.map(patch);
		if (ANSWER.detail) ANSWER.detail = patch(ANSWER.detail);
		const row = ANSWER.rows.find((item) => item.id === request.id);
		if (!row) return { status: 404, body: { detail: "not found" } };
		return { status: 200, body: { result: row } };
	}
	if (request.op === "library.list") {
		/*
		 * A next-page read is the one failure that must NOT surface as the
		 * top-of-grid warning: the page renders its own load-more block. This
		 * answers the cursor page with 500 while the first page stays good.
		 */
		if (request.cursor && ANSWER.failNextPage)
			return { status: 500, body: { detail: "The next page did not answer." } };
		if (ANSWER.hang) {
			/*
			 * ONE GATE, NOT ONE RESOLVER PER REQUEST. The page can issue a second
			 * library.list while the first is deliberately hanging; replacing
			 * `releaseHang` would leave the first promise unresolved and hold the
			 * node:test process open after every assertion passed. The shared gate
			 * releases every waiter when the test calls `releaseHang`.
			 */
			ANSWER.gate ??= new Promise((resolve) => {
				ANSWER.releaseHang = resolve;
			});
			await ANSWER.gate;
		}
		if (ANSWER.failList)
			if (ANSWER.failList)
				return { status: 500, body: { detail: ANSWER.failList } };
		/*
		 * The route scopes BEFORE counting: a `final` answer keeps only
		 * highlighted or generated assets and reports totals/counts over that
		 * population. `all` is the whole fixture set.
		 */
		const scoped = filterAssets(ANSWER.rows, {
			...NO_LIBRARY_FILTERS,
			scope: request.scope === "final" ? "final" : "all",
		}).filter((row) => (request.favorite ? row.favorite : true));
		const tally = (key) =>
			scoped.reduce((acc, row) => {
				acc[row[key]] = (acc[row[key]] ?? 0) + 1;
				return acc;
			}, {});
		return {
			status: 200,
			body: {
				result: {
					state: ANSWER.state,
					revision: 1,
					total: scoped.length,
					counts: {
						category: tally("category"),
						origin_group: tally("origin_group"),
						kind: tally("kind"),
					},
					tags: [tag("t1", "finance")],
					rows: scoped,
					next_cursor: ANSWER.nextCursor,
					cursor_reset: false,
					scan: { sessions_total: 1, sessions_scanned: 1 },
					librarian: {
						enabled: true,
						session_id: "librarian1234",
						paused: false,
						last_run_at: 1_700_000_000,
						last_summary: null,
					},
				},
			},
		};
	}
	if (request.op === "sessions.checkpoints") {
		/*
		 * The transcript's checkpoint rail reads this on mount. An empty, READY
		 * index is the honest "this conversation has none" answer; leaving it out
		 * made the harness throw, which surfaced as a render crash inside the
		 * transcript rather than as a failed request.
		 */
		return {
			status: 200,
			body: {
				result: {
					session_id: request.sessionId,
					index: { state: "ready" },
					checkpoints: [],
				},
			},
		};
	}
	if (request.op === "sessions.checkpoints.warm") {
		return {
			status: 200,
			body: { result: { accepted: [], pending: [] } },
		};
	}
	if (request.op === "sessions.history") {
		/*
		 * The trajectory's own read. A case that wants a durable page sets
		 * `ANSWER.history`; the default is an empty, proven-empty page, which is the
		 * transcript's own "no rows yet" state rather than a hang.
		 */
		return {
			status: 200,
			body: {
				result: {
					entries: ANSWER.history ?? [],
					has_more: false,
					cursor_missing: false,
				},
			},
		};
	}
	if (request.op === "library.get") {
		const row =
			ANSWER.detail ?? ANSWER.rows.find((item) => item.id === request.id);
		if (!row) return { status: 404, body: { detail: "not found" } };
		return { status: 200, body: { result: row } };
	}
	if (request.op === "library.librarian") {
		/*
		 * The status read can hang so a case can prove the header reserves the
		 * 40px Librarian track while the row has no content yet.
		 */
		if (ANSWER.librarianHang) {
			ANSWER.librarianGate ??= new Promise((resolve) => {
				ANSWER.releaseLibrarian = resolve;
			});
			await ANSWER.librarianGate;
		}
		return {
			status: 200,
			body: {
				result: {
					enabled: true,
					session_id: "librarian1234",
					paused: false,
					last_run_at: 1_700_000_000,
					last_summary: null,
					unorganized: 2,
					library: {
						total: ANSWER.allTotal ?? ANSWER.rows.length,
						unorganized: 2,
					},
				},
			},
		};
	}
	if (request.op === "library.tags") {
		return { status: 200, body: { result: [tag("t1", "finance")] } };
	}
	if (request.op === "sessions.create") {
		if (ANSWER.createGate) await ANSWER.createGate;
		return {
			status: 200,
			body: {
				result: {
					session_id: "abcdef123456",
					binding: {},
				},
			},
		};
	}
	if (request.op === "sessions.message") {
		if (ANSWER.failMessage) {
			return { status: 500, body: { detail: "The send was refused." } };
		}
		return { status: 200, body: { result: { accepted: true } } };
	}
	if (request.op === "library.chat.link") {
		if (ANSWER.linkFails > 0) {
			ANSWER.linkFails -= 1;
			/* 400, not 500: the app retries a 5xx once, and this test needs the
			 * refusal to remain a refusal on the first Send. */
			return { status: 400, body: { detail: "The link was refused." } };
		}
		return {
			status: 200,
			body: {
				result: {
					asset_id: request.id,
					chat: {
						session_id: request.sessionId,
						title: "Asset chat",
						updated_at: 1_700_000_000,
					},
					cleared: false,
				},
			},
		};
	}
	/*
	 * Navigation and session creation have follow-up reads this page test does
	 * not exercise. Answering their namespace with an empty result keeps the
	 * harness's event loop settled instead of leaving an unresolved request
	 * from a store that outlives the unmounted route.
	 */
	if (request.op.startsWith("sessions."))
		return { status: 200, body: { result: {} } };
	throw new TypeError(`unexpected desktop op in this test: ${request.op}`);
};

const api = dom.window.api ?? {};
/*
 * THE PATH BRIDGE, PER CASE. Absent by default, which is the honest default for
 * this harness: `useAssetContent` then falls back to the library's content route
 * exactly as it does in a renderer with no bridge, and every pre-existing case
 * keeps the bytes it always saw. A case that is ABOUT the live file installs
 * `ANSWER.fileBridge` and removes it afterwards.
 */
api.probeFiles = async (paths, _cwd, options) => {
	/*
	 * THE CALL'S OPTIONS ARE PART OF THE CONTRACT (review round 2, F8). The
	 * watcher must ask `{ fresh: true }` or a 2 s poll is answered from the 30 s
	 * answer cache; recording them here is what makes dropping the flag fail a
	 * test instead of quietly restoring the latency.
	 */
	ANSWER.probeAsks.push(options);
	return ANSWER.fileBridge
		? paths.map((path) => ({
				input: path,
				resolved: path,
				exists: true,
				isFile: true,
				sizeBytes: ANSWER.fileBridge.sizeBytes,
				mtimeMs: ANSWER.fileBridge.mtimeMs,
				outsideWorkspace: false,
			}))
		: [];
};
api.readFileBytes = async () => {
	if (!ANSWER.fileBridge)
		return { success: false, code: "unavailable", error: "" };
	return {
		success: true,
		data: new TextEncoder().encode(ANSWER.fileBridge.text),
		sizeBytes: ANSWER.fileBridge.sizeBytes,
	};
};
api.desktop = {
	request: desktopRequest,
	media: async (request) => {
		ANSWER.mediaOps.push(request);
		return {
			status: 200,
			kind: "bytes",
			mimeType: "text/markdown",
			data: new TextEncoder().encode("# Notes\n\nA document."),
		};
	},
};
/*
 * THE CANONICAL STREAM'S NATIVE TRANSPORT, when a case wants a painted
 * transcript: `desktop-api` prefers `window.api.desktop.stream.subscribe` over
 * the EventSource proxy, so a fake subscription that emits one JSON frame is
 * the whole mock. `streamId` resolves, and `dispose` is the no-op a story
 * subscription has.
 */
api.desktop.stream = {
	subscribe: (_args, onEvent) => {
		const streamId = "library-case-stream";
		const frames = ANSWER.stream;
		if (frames) {
			setTimeout(() => {
				for (const frame of frames) {
					onEvent({ streamId, kind: "data", data: JSON.stringify(frame) });
				}
			}, 0);
		}
		return { streamId: Promise.resolve(streamId), dispose: () => {} };
	},
};
api.openFile = async () => {};
api.showItemInFolder = async () => {};
dom.window.api = api;

const flush = async (rounds = 8) => {
	for (let index = 0; index < rounds; index += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 100));
		});
	}
};

/** Poll a rendered condition without guessing how many 100ms rounds it needs. */
const waitFor = async (predicate, rounds = 24) => {
	for (let index = 0; index < rounds; index += 1) {
		if (predicate()) return;
		await flush(1);
	}
	assert.fail("the rendered condition did not appear within the wait budget");
};

const MOUNTED = [];

const mount = async (nowMs = NOW) => {
	const container = document.createElement("div");
	document.body.append(container);
	const { root, client } = mountLibrary(container, nowMs);
	MOUNTED.push({ root, client });
	await flush();
	return { container, root, client };
};

after(async () => {
	for (const { root, client } of MOUNTED) {
		await act(async () => root.unmount());
		client.clear();
	}
	dom.window.close();
});

const text = (node) => node.textContent ?? "";

test("loading draws the skeleton without a premature empty state", async () => {
	ANSWER.hang = true;
	ANSWER.rows = [];
	const { container, root } = await mount();
	assert.ok(container.querySelector("[data-library-skeleton]"));
	assert.equal(text(container).includes("Your Library is empty"), false);
	ANSWER.hang = false;
	ANSWER.releaseHang?.();
	ANSWER.gate = null;
	ANSWER.releaseHang = null;
	await flush(2);
	await act(async () => root.unmount());
});

test("empty catalog draws the empty state and its guidance", async () => {
	ANSWER.rows = [];
	const { container, root } = await mount();
	assert.ok(text(container).includes("Your Library is empty"));
	assert.ok(text(container).includes("Files you create or highlight"));
	await act(async () => root.unmount());
});

test("a failed listing draws the error and its Retry control", async () => {
	ANSWER.rows = [];
	ANSWER.failList = "The backend did not answer.";
	const { container, root } = await mount();
	await flush(12);
	assert.ok(text(container).includes("The backend did not answer."));
	assert.ok(text(container).includes("Retry"));
	await act(async () => root.unmount());
	ANSWER.failList = null;
});

/*
 * THE HEADER'S LAYOUT CONTRACT, at both widths the fix is required at.
 *
 * WHAT THIS LANE CAN AND CANNOT SEE, stated rather than implied: jsdom performs
 * no layout, so every `getBoundingClientRect` is 0x0 and an intersection
 * assertion here would pass whether or not the defect exists. This case pins
 * the CAUSE instead: the header no longer declares a fixed height at >=800px
 * (the box the overflowing tracks escaped), its minimum is the design's 136px,
 * every track it renders is a direct child in normal flow, and the results
 * container follows the header rather than sitting under an absolutely
 * positioned overlay. The pixels were measured separately from the rendered
 * Storybook stories (Library/Tab/Building and InShellBuilding) at
 * 1380x900 and 900x800; those readings are in the pull request description.
 */
test("the header sizes to its tracks and the building row stays above the results at both widths", async () => {
	ANSWER.rows = ROWS;
	ANSWER.state = "building";
	for (const [width, height] of [
		[1380, 900],
		[900, 800],
	]) {
		Object.defineProperty(dom.window, "innerWidth", {
			configurable: true,
			value: width,
		});
		Object.defineProperty(dom.window, "innerHeight", {
			configurable: true,
			value: height,
		});
		const { container, root } = await mount();
		const header = container.querySelector("[data-library-header]");
		const building = container.querySelector("[data-library-building]");
		const results = container.querySelector("[data-library-results]");
		assert.ok(header, `the header renders at ${width}x${height}`);
		assert.ok(building, `the building line renders at ${width}x${height}`);
		assert.ok(results, `the results container renders at ${width}x${height}`);

		assert.equal(
			building.parentElement,
			header,
			"the building line is a header row, not a floating element",
		);
		assert.ok(
			header.nextElementSibling?.contains(results),
			"the results container follows the header in the page flow",
		);
		/*
		 * THE PAGE IS A HORIZONTAL ROW and the header lives in the vertical
		 * column to the right of the rail. jsdom reports every width as 0, so the
		 * rail itself is absent in this lane; its geometry is measured from the
		 * Storybook story. This pins the structure that makes rail-top ==
		 * header-top possible: both columns start at the page's top edge.
		 */
		const rightColumn = header.parentElement;
		const pageRoot = rightColumn?.parentElement;
		assert.ok(
			rightColumn && pageRoot,
			"the header has the page column above it",
		);
		assert.ok(
			rightColumn.className.split(CLASS_TOKENS).includes("flex-col"),
			"the header's column is vertical",
		);
		assert.equal(
			pageRoot.className.split(CLASS_TOKENS).includes("flex-col"),
			false,
			"the page root is a horizontal row, not a vertical stack",
		);

		const headerClasses = header.className.split(CLASS_TOKENS);
		assert.ok(
			headerClasses.includes("min-[800px]:min-h-[136px]"),
			"the design's 136px remains a floor at >=800px",
		);
		assert.equal(
			headerClasses.includes("min-[800px]:h-[136px]"),
			false,
			"a fixed 136px height is exactly what let 188px of tracks overflow",
		);

		/* The four rendered tracks the old fixed box under-counted. */
		const tracks = [...header.children].map((child) =>
			child.className.split(CLASS_TOKENS),
		);
		assert.equal(
			tracks.filter((classes) => classes.includes("h-12")).length,
			2,
		);
		assert.equal(
			tracks.filter((classes) => classes.includes("min-h-10")).length,
			1,
		);
		assert.ok(
			header.querySelector("[data-library-librarian-track]"),
			"the 40px Librarian track is reserved even while its row is empty",
		);
		assert.equal(tracks.filter((classes) => classes.includes("h-4")).length, 1);
		for (const child of header.children) {
			assert.equal(
				OUT_OF_FLOW.test(child.className),
				false,
				"no header track leaves normal flow",
			);
		}
		await act(async () => root.unmount());
	}
	ANSWER.state = "ready";
});

test("an offscreen image card does not read its thumbnail until it is near", async () => {
	ANSWER.rows = [
		asset("la_0000000000000016", {
			name: "A photo",
			kind: "image",
			category: "image",
			width: 1600,
			height: 900,
		}),
	];
	ANSWER.mediaOps = [];
	const { container, root } = await mount();
	assert.ok(
		container.querySelector('[data-library-card-id="la_0000000000000016"]'),
		"the image card is mounted",
	);
	assert.equal(
		ANSWER.mediaOps.filter((op) => op.op === "library.thumbnail").length,
		0,
		"a card nobody has scrolled near must not read bytes over IPC",
	);
	const target = await intersect(
		(element) =>
			element.closest('[data-library-card-id="la_0000000000000016"]') !== null,
	);
	assert.ok(target, "the card's picture slot is observed");
	await waitFor(
		() =>
			ANSWER.mediaOps.filter((op) => op.op === "library.thumbnail").length ===
			1,
	);
	assert.equal(
		ANSWER.mediaOps.find((op) => op.op === "library.thumbnail").assetId,
		"la_0000000000000016",
	);
	await act(async () => root.unmount());
});

test("a failed refetch keeps the painted rows and warns inline", async () => {
	ANSWER.rows = ROWS;
	const { container, root, client } = await mount();
	const cardId = "la_0000000000000011";
	assert.ok(container.querySelector(`[data-library-card-id="${cardId}"]`));

	ANSWER.failList = "The library did not answer in time.";
	await act(async () => {
		await client.invalidateQueries({
			queryKey: ["desktop", "library", "list"],
		});
	});
	await flush(6);

	assert.ok(
		container.querySelector(`[data-library-card-id="${cardId}"]`),
		"the last good rows stay painted after the refetch fails",
	);
	const warning = container.querySelector("[data-library-partial-error]");
	assert.ok(
		warning,
		"the failure is reported inline instead of replacing the grid",
	);
	assert.equal(warning.getAttribute("role"), "alert");
	assert.ok(text(container).includes("The library did not answer in time."));
	/*
	 * Alert's body is a flex COLUMN; the message and Retry must be one row inside
	 * it, or the button stacks under the sentence and stretches full width.
	 */
	const warningRow = warning.querySelector("[data-library-partial-row]");
	assert.ok(warningRow, "the warning body is one explicit row");
	const rowClasses = warningRow.className.split(CLASS_TOKENS);
	for (const required of ["flex", "w-full", "items-center"])
		assert.ok(rowClasses.includes(required), `the warning row is ${required}`);
	const retry = warning.querySelector("button");
	assert.ok(retry, "the inline warning carries its own Retry control");
	assert.ok(
		retry.className.split(CLASS_TOKENS).includes("shrink-0"),
		"the Retry control does not stretch or shrink in the warning row",
	);
	assert.equal(
		warning.querySelectorAll("button").length,
		1,
		"the warning has one action, not one per child",
	);
	await act(async () => root.unmount());
	ANSWER.failList = null;
});

test("the header shares the results' single canvas-content glass region", async () => {
	ANSWER.rows = ROWS;
	const { container, root } = await mount();
	const header = container.querySelector("[data-library-header]");
	const results = container.querySelector("[data-library-results]");
	const region = header.closest('[data-glass-region="canvas-content"]');
	assert.ok(region, "the header is inside a canvas-content region");
	assert.equal(
		results.closest('[data-glass-region="canvas-content"]'),
		region,
		"the header and the results paint from the same region",
	);
	assert.equal(
		results.hasAttribute("data-glass-region"),
		false,
		"the results section does not nest a second region",
	);
	await act(async () => root.unmount());
});

test("the Librarian track is reserved while its status loads", async () => {
	ANSWER.rows = ROWS;
	ANSWER.librarianHang = true;
	const { container, root } = await mount();
	const track = container.querySelector("[data-library-librarian-track]");
	assert.ok(track, "the reserved track renders before the status answers");
	assert.ok(track.className.split(CLASS_TOKENS).includes("min-h-10"));
	assert.equal(
		container.querySelector("[data-library-librarian]"),
		null,
		"the row itself still waits for the status",
	);
	ANSWER.librarianHang = false;
	ANSWER.releaseLibrarian?.();
	await waitFor(
		() => container.querySelector("[data-library-librarian]") !== null,
	);
	await act(async () => root.unmount());
	ANSWER.librarianGate = null;
	ANSWER.releaseLibrarian = null;
});

test("a failed next page stays on the load-more surface, not the top warning", async () => {
	ANSWER.rows = ROWS;
	ANSWER.nextCursor = "cursor-2";
	const { container, root } = await mount();
	assert.ok(
		container.querySelector('[data-library-card-id="la_0000000000000011"]'),
		"the first page is painted",
	);
	const loadMore = [...container.querySelectorAll("button")].find(
		(button) => button.textContent?.trim() === "Load more",
	);
	assert.ok(loadMore, "the load-more control renders when a cursor exists");
	ANSWER.failNextPage = true;
	await act(async () => loadMore.click());
	await waitFor(() => text(container).includes("Couldn't load more assets."));
	assert.equal(
		container.querySelectorAll("[data-library-partial-error]").length,
		0,
		"a next-page failure does not add the refetch warning",
	);
	assert.equal(
		[...container.querySelectorAll("button")].filter(
			(button) => button.textContent?.trim() === "Retry",
		).length,
		1,
		"exactly one Retry: the load-more one",
	);
	await act(async () => root.unmount());
	ANSWER.nextCursor = null;
	ANSWER.failNextPage = false;
});

test("the rail renders as the page row's first column at 1380px", async () => {
	ANSWER.rows = ROWS;
	Object.defineProperty(dom.window, "innerWidth", {
		configurable: true,
		value: 1380,
	});
	const original = dom.window.Element.prototype.getBoundingClientRect;
	/*
	 * A scoped width shim, not a layout engine. `useWorkspaceWidth` reads the
	 * page root's rect and jsdom reports 0 for every element; returning a width
	 * for the one node that carries `data-glass-split` makes the real
	 * `railVisible` conditional render. No observer is involved, and the
	 * assertions below stay boolean so a failure never serialises a DOM node.
	 * The rail's top/bottom geometry is measured from Storybook frames.
	 */
	dom.window.Element.prototype.getBoundingClientRect = function () {
		if (this.hasAttribute?.("data-glass-split")) {
			return {
				width: 1380,
				height: 900,
				top: 0,
				left: 0,
				right: 1380,
				bottom: 900,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			};
		}
		return original.call(this);
	};
	try {
		const { container, root } = await mount();
		const rail = container.querySelector("[data-library-rail]");
		assert.ok(rail, "the rail renders at 1380px");
		assert.ok(
			rail.parentElement?.hasAttribute("data-glass-split"),
			"the rail is a child of the page row",
		);
		assert.ok(
			rail.nextElementSibling?.querySelector("[data-library-header]") !== null,
			"the header is in the column right of the rail",
		);
		await act(async () => root.unmount());
	} finally {
		dom.window.Element.prototype.getBoundingClientRect = original;
		sessionStorage.removeItem("library-filters");
	}
});

test("the dock resizes by keyboard and pointer, persists, and clamps to the workspace", async () => {
	ANSWER.rows = ROWS;
	const originalInnerWidth = dom.window.innerWidth;
	Object.defineProperty(dom.window, "innerWidth", {
		configurable: true,
		value: 1380,
	});
	let workspaceWidth = 1380;
	const original = dom.window.Element.prototype.getBoundingClientRect;
	dom.window.Element.prototype.getBoundingClientRect = function () {
		if (this.hasAttribute?.("data-glass-split")) {
			return {
				width: workspaceWidth,
				height: 900,
				top: 0,
				left: 0,
				right: workspaceWidth,
				bottom: 900,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			};
		}
		return original.call(this);
	};
	const resizeWorkspace = async (width) => {
		workspaceWidth = width;
		await act(async () => {
			for (const observer of RESIZE_OBSERVERS) {
				for (const target of observer.targets) {
					if (target.hasAttribute?.("data-glass-split")) {
						observer.callback([{ contentRect: { width } }], observer);
					}
				}
			}
		});
		await flush(1);
	};
	const openDock = async () => {
		const mounted = await mount();
		await act(async () =>
			mounted.container
				.querySelector('[data-library-card-id="la_0000000000000011"] button')
				?.click(),
		);
		await flush(8);
		return mounted;
	};
	try {
		localStorage.removeItem("library-details-width");
		let { container, root } = await openDock();
		let dock = container.querySelector("[data-library-dock]");
		let separator = container.querySelector('[role="separator"]');
		assert.equal(dock?.style.width, "448px");
		assert.equal(separator?.getAttribute("aria-valuemin"), "320");
		assert.equal(separator?.getAttribute("aria-valuemax"), "720");
		assert.ok(dock?.className.includes("panel-top-pad"));
		assert.ok(dock?.className.includes("bg-surface"));
		assert.equal(dock?.getAttribute("data-glass-region"), "pane");
		assert.equal(
			container
				.querySelector("[data-library-preview]")
				?.getAttribute("data-glass-region"),
			"pane",
			"the inner preview is nested inside the outer alpha owner",
		);
		assert.ok(
			container
				.querySelector("[data-library-preview]")
				?.className.includes("w-full"),
			"the preview fills every resized width",
		);
		const composer = container.querySelector("[data-library-composer]");
		assert.ok(composer?.className.includes("bg-sunken"));
		assert.ok(composer?.className.includes("px-4"));
		assert.ok(composer?.className.includes("pt-3"));
		assert.ok(composer?.className.includes("pb-1"));
		const search = container.querySelector(
			'input[placeholder="Search the Library"]',
		);
		assert.ok(search?.parentElement?.className.includes("min-w-0"));
		const toolbar = container.querySelector("[data-library-toolbar]");
		const sort = [...(toolbar?.querySelectorAll("button") ?? [])].find(
			(button) => button.textContent === "Sort",
		);
		assert.ok(sort?.className.includes("shrink-0"));
		assert.ok(
			toolbar
				?.querySelector('[aria-label="Reverse the order"]')
				?.className.includes("shrink-0"),
		);

		await act(async () => {
			separator.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "ArrowLeft",
					bubbles: true,
				}),
			);
		});
		assert.equal(dock.style.width, "464px");
		assert.equal(separator.getAttribute("aria-valuenow"), "464");
		assert.equal(localStorage.getItem("library-details-width"), "464");

		await act(async () =>
			container.querySelector('[aria-label="Close the preview"]').click(),
		);
		await flush(2);
		assert.equal(container.querySelector("[data-library-dock]"), null);
		await act(async () =>
			container
				.querySelector('[data-library-card-id="la_0000000000000011"] button')
				?.click(),
		);
		await flush(8);
		dock = container.querySelector("[data-library-dock]");
		assert.equal(dock?.style.width, "464px", "close/reopen keeps the width");

		await act(async () => root.unmount());
		({ container, root } = await openDock());
		dock = container.querySelector("[data-library-dock]");
		separator = container.querySelector('[role="separator"]');
		assert.equal(dock?.style.width, "464px", "remount restores the width");

		await act(async () => {
			separator.dispatchEvent(
				new dom.window.MouseEvent("mousedown", {
					bubbles: true,
					button: 0,
					clientX: 600,
				}),
			);
			dom.window.dispatchEvent(
				new dom.window.MouseEvent("mousemove", { clientX: 560 }),
			);
		});
		assert.equal(dock.style.width, "504px");
		assert.equal(dom.window.document.body.style.userSelect, "none");
		await act(async () => {
			dom.window.dispatchEvent(new dom.window.MouseEvent("mouseup"));
		});
		assert.equal(dom.window.document.body.style.userSelect, "");
		await act(async () => {
			dom.window.dispatchEvent(
				new dom.window.MouseEvent("mousemove", { clientX: 300 }),
			);
		});
		assert.equal(dock.style.width, "504px", "the drag is really disposed");

		await act(async () => {
			separator.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "End",
					bubbles: true,
				}),
			);
		});
		assert.equal(dock.style.width, "720px");
		await resizeWorkspace(1200);
		assert.equal(dock.style.width, "688px");
		assert.equal(separator.getAttribute("aria-valuemax"), "688");
		assert.equal(separator.getAttribute("aria-valuenow"), "688");
		await resizeWorkspace(1152);
		assert.equal(dock.style.width, "640px");
		assert.equal(separator.getAttribute("aria-valuemax"), "640");
		assert.equal(separator.getAttribute("aria-valuenow"), "640");
		await resizeWorkspace(1380);
		assert.equal(
			dock.style.width,
			"720px",
			"the preference survives a temporary workspace clamp",
		);
		await act(async () => {
			separator.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
				}),
			);
		});
		assert.equal(dock.style.width, "448px");
		assert.equal(localStorage.getItem("library-details-width"), "448");
		await act(async () => {
			separator.dispatchEvent(
				new dom.window.MouseEvent("mousedown", {
					bubbles: true,
					button: 0,
					clientX: 600,
				}),
			);
		});
		assert.equal(dom.window.document.body.style.userSelect, "none");
		await act(async () => root.unmount());
		assert.equal(
			dom.window.document.body.style.userSelect,
			"",
			"unmounting mid-drag restores selection and removes global listeners",
		);

		for (const [stored, expected] of [
			["not-a-number", "448px"],
			["-100", "320px"],
			["9999", "720px"],
		]) {
			localStorage.setItem("library-details-width", stored);
			({ container, root } = await openDock());
			assert.equal(
				container.querySelector("[data-library-dock]")?.style.width,
				expected,
				`stored ${stored} restores defensively`,
			);
			await act(async () => root.unmount());
		}
	} finally {
		dom.window.Element.prototype.getBoundingClientRect = original;
		Object.defineProperty(dom.window, "innerWidth", {
			configurable: true,
			value: originalInnerWidth,
		});
		localStorage.removeItem("library-details-width");
		sessionStorage.removeItem("library-filters");
	}
});

test("the default listing is final artifacts and the rail switches to all inclusions", async () => {
	ANSWER.rows = [
		asset("la_0000000000000041", {
			name: "Generated report",
			origin: "generated",
			origin_group: "generated",
		}),
		asset("la_0000000000000042", { name: "Kept note", highlighted: true }),
		asset("la_0000000000000043", {
			name: "Mentioned file",
			origin: "mentioned",
			origin_group: "mentioned",
			highlighted: false,
		}),
		asset("la_0000000000000044", {
			name: "Created scratch",
			origin: "written",
			origin_group: "created",
			highlighted: false,
		}),
	];
	ANSWER.allTotal = 4;
	ANSWER.ops = [];
	Object.defineProperty(dom.window, "innerWidth", {
		configurable: true,
		value: 1380,
	});
	const original = dom.window.Element.prototype.getBoundingClientRect;
	/* Same scoped width shim as the rail case: the rail must render so its
	 * Scope rows are clickable. No observer is involved. */
	dom.window.Element.prototype.getBoundingClientRect = function () {
		if (this.hasAttribute?.("data-glass-split")) {
			return {
				width: 1380,
				height: 900,
				top: 0,
				left: 0,
				right: 1380,
				bottom: 900,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			};
		}
		return original.call(this);
	};
	try {
		const { container, root } = await mount();
		const firstList = ANSWER.ops.find((op) => op.op === "library.list");
		assert.equal(
			firstList?.scope,
			"final",
			"the default listing asks the route for final artifacts",
		);
		assert.ok(text(container).includes("Generated report"));
		assert.ok(text(container).includes("Kept note"));
		assert.equal(text(container).includes("Mentioned file"), false);
		assert.equal(text(container).includes("Created scratch"), false);
		const railButton = (label) =>
			[...container.querySelectorAll("[data-library-rail] button")].find(
				(button) => button.textContent?.trim().startsWith(label),
			);
		assert.equal(
			railButton("Mentioned"),
			undefined,
			"a zero-count source is hidden under final",
		);

		const scopeAll = railButton("All inclusions");
		assert.ok(scopeAll, "the rail offers the all-inclusions scope");
		assert.ok(
			scopeAll.textContent?.includes("4"),
			"the all scope carries the catalog-wide total",
		);
		await act(async () => scopeAll.click());
		await flush(6);
		const lastList = [...ANSWER.ops]
			.filter((op) => op.op === "library.list")
			.at(-1);
		assert.equal(lastList?.scope, "all");
		assert.ok(text(container).includes("Mentioned file"));
		assert.ok(text(container).includes("Created scratch"));
		const mentioned = railButton("Mentioned");
		assert.ok(mentioned, "the all scope shows every source row");

		/* m-3: the active source must survive the scope switch. An All ->
		 * Final move preserves originGroup; hiding its zero-count row would
		 * leave an empty grid with no visible cause. */
		await act(async () => mentioned.click());
		await flush(4);
		const scopedList = [...ANSWER.ops]
			.filter((op) => op.op === "library.list")
			.at(-1);
		assert.equal(scopedList?.origin_group, "mentioned");
		await act(async () => railButton("Final artifacts").click());
		await flush(4);
		const activeMentioned = railButton("Mentioned");
		assert.ok(
			activeMentioned,
			"the active source row stays visible when the scope empties it",
		);
		assert.equal(activeMentioned.getAttribute("aria-pressed"), "true");
		const finalScopedList = [...ANSWER.ops]
			.filter((op) => op.op === "library.list")
			.at(-1);
		assert.equal(finalScopedList?.scope, "final");
		assert.equal(finalScopedList?.origin_group, "mentioned");
		assert.equal(text(container).includes("Mentioned file"), false);
		await act(async () => root.unmount());
	} finally {
		dom.window.Element.prototype.getBoundingClientRect = original;
	}
	ANSWER.allTotal = null;
	ANSWER.rows = ROWS;
});

test("a card selects its asset route and the preview renders there", async () => {
	ANSWER.rows = ROWS;
	const { container, root } = await mount();
	assert.ok(text(container).includes("Invoice notes"));
	const card = container.querySelector(
		'[data-library-card-id="la_0000000000000011"] button',
	);
	assert.ok(card, "the first card's primary button exists");
	await act(async () => card.click());
	await flush();
	assert.ok(
		container.querySelector('[data-library-preview="la_0000000000000011"]'),
		"the selected route renders the preview for that asset",
	);
	const composer = container.querySelector("[data-library-composer] textarea");
	assert.equal(composer?.getAttribute("placeholder"), "Ask about this asset");
	/*
	 * THE BOX IS THE APP'S OWN COMPOSER, not a second text field: the chat
	 * region and the composer's tour tag are markers only `MessageInput` writes,
	 * so their presence is what distinguishes the shared control from the
	 * bespoke textarea this surface used to mount.
	 */
	assert.ok(
		container.querySelector(
			'[data-library-composer] [data-chat-region="composer"]',
		),
		"the Library mounts the shared MessageInput",
	);
	assert.ok(
		container.querySelector(
			'[data-library-composer] [data-tour-tag="chat-input-textarea"]',
		),
		"the shared composer's own box is what renders here",
	);
	await act(async () => root.unmount());
});

test("a linked chat is shown and continued with its own session", async () => {
	ANSWER.rows = [
		asset("la_0000000000000013", {
			name: "Chatty asset",
			chat: {
				session_id: "abcdef123456",
				title: "Asset chat",
				updated_at: 1_700_000_000,
			},
		}),
	];
	ANSWER.ops = [];
	const { container, root } = await mount();
	const card = container.querySelector(
		'[data-library-card-id="la_0000000000000013"] button',
	);
	await act(async () => card.click());
	await flush();
	assert.ok(text(container).includes("Chat about this asset: Asset chat"));
	/*
	 * THE PERSISTED LINK IS ENOUGH TO MOUNT THE TRAJECTORY (operator: returning
	 * to the asset pulls the existing conversation back up). Nothing was lifted
	 * here - the id came from the row's own `chat.session_id`.
	 */
	assert.ok(
		container.querySelector("[data-library-trajectory]"),
		"a linked asset mounts its conversation below the asset",
	);

	const textarea = container.querySelector("[data-library-composer] textarea");
	assert.ok(textarea);
	await act(async () => {
		const setter = Object.getOwnPropertyDescriptor(
			dom.window.HTMLTextAreaElement.prototype,
			"value",
		).set;
		setter.call(textarea, "Summarise this asset");
		textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
	await flush();
	const send = container.querySelector(
		'[data-library-composer] button[aria-label="Send message"]',
	);
	assert.ok(send);
	await act(async () => send.click());
	await flush();
	const message = ANSWER.ops.find((op) => op.op === "sessions.message");
	assert.equal(message?.sessionId, "abcdef123456");
	assert.equal(
		ANSWER.ops.some((op) => op.op === "library.chat.link"),
		false,
		"continuing a linked chat does not link it again",
	);
	/*
	 * AND IT STAYS PUT. The old send ended in `openConversation(navigate, id)`,
	 * which left the Library for `/chat` — the navigation this feature removes.
	 * The preview is still mounted and the chat route's own element was never
	 * rendered.
	 */
	assert.ok(
		container.querySelector('[data-library-preview="la_0000000000000013"]'),
		"the send keeps the asset and its preview on screen",
	);
	assert.equal(
		text(container).includes("chat route"),
		false,
		"the send does not navigate to the chat route",
	);
	await act(async () => root.unmount());
});

test("an accepted send survives a link failure and the next send reuses its session", async () => {
	ANSWER.rows = [
		asset("la_0000000000000014", { name: "Unlinked asset" }),
		asset("la_0000000000000012", { name: "Second asset" }),
	];
	ANSWER.ops = [];
	ANSWER.linkFails = 1;
	const { container, root } = await mount();
	const card = container.querySelector(
		'[data-library-card-id="la_0000000000000014"] button',
	);
	await act(async () => card.click());
	await flush();
	const textarea = () =>
		container.querySelector("[data-library-composer] textarea");
	const type = async (text) => {
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				dom.window.HTMLTextAreaElement.prototype,
				"value",
			).set;
			setter.call(textarea(), text);
			textarea().dispatchEvent(
				new dom.window.Event("input", { bubbles: true }),
			);
		});
		await flush(2);
	};
	const send = () =>
		container.querySelector(
			'[data-library-composer] button[aria-label="Send message"]',
		);
	await type("First message");
	await act(async () => send().click());
	await flush(10);
	assert.equal(
		ANSWER.ops.filter((op) => op.op === "sessions.message").length,
		1,
	);
	assert.equal(textarea().value, "", "the accepted draft is cleared");
	assert.ok(
		container.querySelector("[data-library-link-failed]"),
		"the link failure is shown as partial success",
	);

	/* Same composer instance, different asset: B must not inherit A's row. */
	await act(async () => container.querySelector("[data-go-b]").click());
	await flush(8);
	assert.equal(
		container.querySelector("[data-library-link-failed]"),
		null,
		"B does not inherit A's pending link",
	);
	await act(async () => container.querySelector("[data-go-a]").click());
	await flush(8);
	assert.ok(container.querySelector("[data-library-link-failed]"));
	await type("Second message");
	await act(async () => send().click());
	await flush(10);
	const messages = ANSWER.ops.filter((op) => op.op === "sessions.message");
	assert.equal(messages.length, 2);
	assert.equal(messages[0].sessionId, "abcdef123456");
	assert.equal(messages[1].sessionId, "abcdef123456");
	assert.equal(
		ANSWER.ops.filter((op) => op.op === "sessions.create").length,
		1,
		"the second send reuses the created session",
	);
	await act(async () =>
		container.querySelector("[data-library-link-failed] button")?.click(),
	);
	await flush(6);
	assert.equal(container.querySelector("[data-library-link-failed]"), null);
	await act(async () => root.unmount());
	ANSWER.linkFails = 0;
});

test("a send refusal keeps the draft and writes no link", async () => {
	ANSWER.rows = [
		asset("la_0000000000000015", {
			name: "Send refusal",
			chat: {
				session_id: "abcdef123456",
				title: "Existing chat",
				updated_at: 1_700_000_000,
			},
		}),
	];
	ANSWER.ops = [];
	ANSWER.failMessage = true;
	const { container, root } = await mount();
	const card = container.querySelector(
		'[data-library-card-id="la_0000000000000015"] button',
	);
	await act(async () => card.click());
	await flush();
	const textarea = container.querySelector("[data-library-composer] textarea");
	await act(async () => {
		const setter = Object.getOwnPropertyDescriptor(
			dom.window.HTMLTextAreaElement.prototype,
			"value",
		).set;
		setter.call(textarea, "Will not send");
		textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
	await flush(2);
	await act(async () =>
		container
			.querySelector(
				'[data-library-composer] button[aria-label="Send message"]',
			)
			.click(),
	);
	await flush(8);
	assert.equal(textarea.value, "Will not send");
	assert.equal(
		ANSWER.ops.some((op) => op.op === "library.chat.link"),
		false,
	);
	await act(async () => root.unmount());
	ANSWER.failMessage = false;
});

/*
 * THE BUG THIS FIXES, RENDERED. `relative()` returned hardcoded English, so a
 * French reader saw "Dernier classement 2h ago": the catalogue sentence was
 * translated and its age tail was not. This mounts the REAL page, pins the
 * clock two hours after the Librarian's last run, and requires the row to
 * change language when the app language changes — the assertion the old helper
 * cannot satisfy. The French line also pins the composition: the age is an
 * adverbial fragment ("il y a 2 h"), so the row may not keep a "le" that only
 * fits a date.
 */
test("the Librarian row's age is rendered in the app language", async () => {
	ANSWER.rows = ROWS;
	const twoHoursLater = 1_700_000_000_000 + 2 * 3_600_000;
	locale.setLocale("en");
	const { container, root } = await mount(twoHoursLater);
	const row = () => container.querySelector("[data-library-librarian]");
	await waitFor(() => row() !== null);
	assert.match(text(row()), AGE_EN);
	await act(async () => locale.setLocale("fr"));
	assert.match(
		text(row()),
		AGE_FR,
		"the age fragment must be French too, not an English tail",
	);
	await act(async () => locale.setLocale("zh-CN"));
	assert.match(text(row()), AGE_ZH_CN);
	await act(async () => locale.setLocale("en"));
	assert.match(text(row()), AGE_EN, "and back again");
	await act(async () => root.unmount());
});

after(() => {
	// jsdom keeps window timers alive; close it so a stray debounce or query
	// timer cannot hold the node:test process open after every case unmounts.
	dom.window.close();
});

test("a path-backed asset reads its live file and says when it moved", async () => {
	/*
	 * THE LIVE-FILE DECISION, end to end through the shipped preview: a
	 * path-backed row is read from the PATH (not the index's digest), and when the
	 * path's mtime differs from the row's `modified_at` the strip says so instead
	 * of silently painting newer bytes under the old size.
	 */
	ANSWER.rows = [
		asset("la_0000000000000016", {
			name: "Live file",
			kind: "text",
			derived_name: "live.txt",
			ref: {
				type: "path",
				path: "/tmp/live.txt",
				display_path: "~/live.txt",
				digest: null,
				content_type: "text/plain",
			},
			modified_at: 1_700_000_000,
		}),
	];
	ANSWER.ops = [];
	/*
	 * Fresh call log for THIS case: another case's markdown preview probes through
	 * `probeLocalFile`, which passes no options, and the `every(... fresh)` check
	 * below is about the watcher's calls, not the whole suite's.
	 */
	ANSWER.probeAsks = [];
	ANSWER.fileBridge = {
		text: "rewritten by the agent",
		sizeBytes: 22,
		mtimeMs: 1_700_000_000_000 + 60_000,
	};
	const { container, root } = await mount();
	const card = container.querySelector(
		'[data-library-card-id="la_0000000000000016"] button',
	);
	await act(async () => card.click());
	await flush(6);
	assert.ok(
		text(container).includes("rewritten by the agent"),
		"the viewer paints the file at its path, not the indexed copy",
	);
	const live = () => container.querySelector("[data-library-file-live]");
	assert.equal(
		text(live()),
		"22 B",
		"the strip reports the live file's own size, not the row's 2.0 KB figure",
	);
	/*
	 * AND A SECOND WRITE IS SEEN BY THE POLL, not just by the mount. The bridge's
	 * answer moves; the watcher's 2 s visible poll (fresh, so the probe cache does
	 * not serve the old stat) must bump the revision and the viewer re-read the
	 * path. The wait is real time because the interval is the product's.
	 */
	ANSWER.fileBridge = {
		text: "rewritten once more",
		sizeBytes: 4096,
		mtimeMs: 1_700_000_000_000 + 120_000,
	};
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 2600));
	});
	await flush(8);
	assert.equal(
		text(live()),
		"4.0 KB",
		"the next poll reports the file's new size",
	);
	assert.ok(
		text(container).includes("rewritten once more"),
		"the viewer re-read the path after the mtime moved",
	);
	/*
	 * EVERY PROBE THE WATCHER MADE WAS A FRESH ONE (F8). A cached probe would have
	 * answered the old mtime and this case would have failed above; this assertion
	 * names the mechanism, so a later edit that drops the flag fails here rather
	 * than only as a latency regression QA has to re-measure.
	 */
	assert.ok(ANSWER.probeAsks.length > 0, "the watcher probed at all");
	assert.ok(
		ANSWER.probeAsks.every((options) => options?.fresh === true),
		"every watched probe passes { fresh: true }",
	);
	await act(async () => root.unmount());
	ANSWER.fileBridge = null;
});

test("a linked conversation holds the shared spinner until the stream answers", async () => {
	/*
	 * THE LOADING STATE, AND A RECORDED LIMIT OF THIS HARNESS. The link mounts the
	 * panel (the assertion above), and until the stream answers the well is the
	 * shared `Spinner` — not a blank panel and not a bespoke skeleton. The durable
	 * page here is deliberately answered by `sessions.history`: it does NOT paint
	 * on its own, because the session hook holds hydration until the stream's first
	 * snapshot, so a request-only mock (this harness, and Storybook's) cannot
	 * demonstrate a painted transcript. That is why the streaming and long-thread
	 * Storybook states are reported as blocked rather than faked with a spinner.
	 */
	ANSWER.rows = [
		asset("la_0000000000000017", {
			name: "Persisted chat",
			chat: {
				session_id: "feedface1234",
				title: "Asset chat",
				updated_at: 1_700_000_000,
			},
		}),
	];
	ANSWER.ops = [];
	ANSWER.history = [
		{
			id: "e1",
			ts: 1_700_000_000,
			type: "message",
			// A durable row's content is a BLOCK list; `messageText` reads only that
			// shape, which is why a bare string painted no row at first.
			payload: {
				role: "user",
				content: [{ type: "text", text: "what is in this file?" }],
			},
		},
		{
			id: "e2",
			ts: 1_700_000_001,
			type: "message",
			payload: { role: "assistant", content: "It is a short note." },
		},
	];
	const { container, root } = await mount();
	const card = container.querySelector(
		'[data-library-card-id="la_0000000000000017"] button',
	);
	await act(async () => card.click());
	await flush(10);
	const trajectory = container.querySelector("[data-library-trajectory]");
	assert.ok(trajectory, "the linked conversation is mounted");
	/*
	 * This harness reports no layout, so the preview's height measurement is 0
	 * and the trajectory takes its short-panel default (collapsed). The chevron is
	 * the gesture a reader makes to open it — press it rather than asserting the
	 * body the default correctly hides.
	 */
	const toggle = trajectory.querySelector("button[aria-expanded]");
	assert.equal(toggle?.getAttribute("aria-expanded"), "false");
	await act(async () => toggle.click());
	await flush(4);
	assert.ok(
		text(trajectory).includes("Loading"),
		"the well holds the shared spinner until the stream's first snapshot",
	);
	await act(async () => root.unmount());
	ANSWER.history = null;
});

test("favourite paints at the press, survives a refetch, and filters the list", async () => {
	/*
	 * THE OPERATOR'S FAVOURITE FEEDBACK (heart, not a star): pressing it must
	 * read as a toggle rather than a round-trip, a second press while the first
	 * is in flight must write nothing, the field must survive the refetch the
	 * filter causes, and the Favorites rail row must ask the wire for
	 * `favorite: true` and show the marked row.
	 */
	ANSWER.rows = [
		asset("la_0000000000000021", { name: "Heart me" }),
		asset("la_0000000000000022", { name: "Left out" }),
	];
	ANSWER.ops = [];
	ANSWER.requests = [];
	Object.defineProperty(dom.window, "innerWidth", {
		configurable: true,
		value: 1380,
	});
	const original = dom.window.Element.prototype.getBoundingClientRect;
	// The rail case's scoped width shim: the dock and rail read a real rect.
	dom.window.Element.prototype.getBoundingClientRect = function () {
		if (this.hasAttribute?.("data-glass-split")) {
			return {
				width: 1380,
				height: 900,
				top: 0,
				left: 0,
				right: 1380,
				bottom: 900,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			};
		}
		return original.call(this);
	};
	try {
		const { container, root } = await mount();
		const cardOf = (id) =>
			container.querySelector(`[data-library-card-id="${id}"]`);
		await act(async () =>
			cardOf("la_0000000000000021")?.querySelector("button")?.click(),
		);
		await flush(8);

		/*
		 * THE WRITE IS HELD so the optimistic paint is observable: if the heart
		 * were only drawn from the server's answer, this assertion could not pass
		 * before the gate is released.
		 */
		let releaseUpdate = () => {};
		ANSWER.updateGate = new Promise((resolve) => {
			releaseUpdate = resolve;
		});
		const favourite = container.querySelector(
			'[data-library-preview] [aria-label="Favorite"]',
		);
		assert.ok(favourite, "the preview's favourite control is mounted");
		await act(async () => favourite.click());
		await flush(2);
		assert.ok(
			cardOf("la_0000000000000021")?.querySelector(
				"[data-library-favorite-mark]",
			),
			"the card's heart paints before the write answers",
		);
		// A second press is the same write, not a second one.
		await act(async () => favourite.click());
		releaseUpdate();
		ANSWER.updateGate = null;
		await flush(10);
		const updates = ANSWER.requests.filter((op) => op.op === "library.update");
		assert.equal(updates.length, 1, "one press, one write");
		assert.equal(updates[0].fields.favorite, true);

		/* The refetch the filter causes must answer with the persisted field. */
		const favorites = [...container.querySelectorAll("button")].find((node) =>
			node.textContent?.includes("Favorites"),
		);
		assert.ok(favorites, "the rail's Favorites row is reachable");
		await act(async () => favorites.click());
		await flush(10);
		assert.ok(
			ANSWER.requests.some(
				(op) => op.op === "library.list" && op.favorite === true,
			),
			"the filter asks the wire for `favorite: true`",
		);
		assert.ok(
			cardOf("la_0000000000000021")?.querySelector(
				"[data-library-favorite-mark]",
			),
			"the marked row is still marked after the refetch",
		);
		assert.equal(
			cardOf("la_0000000000000022"),
			null,
			"the unmarked row is filtered out",
		);
		await act(async () => root.unmount());
	} finally {
		dom.window.Element.prototype.getBoundingClientRect = original;
		sessionStorage.removeItem("library-filters");
	}
});

/**
 * One canonical snapshot frame, as the stream's native transport delivers it.
 *
 * `JSON.parse` in the session hook is unvalidated (`as DesktopSessionFrame`), so
 * this is the shape the reducer reads rather than a schema: the frontend
 * snapshot carries the fields the transcript paints its working line and gate
 * from, the history page carries the durable rows. `patch` lets a case state
 * `streaming` or `pending_gate`.
 */
const streamSnapshot = (sessionId, entries, patch = {}) => [
	{
		session_id: sessionId,
		epoch: "epoch-1",
		seq: 1,
		type: "snapshot",
		payload: {
			frontend: {
				state_version: 1,
				epoch: "epoch-1",
				sequence: 1,
				live_cursor: null,
				snapshot: {
					state_version: 1,
					session_id: sessionId,
					epoch: "epoch-1",
					sequence: 1,
					cwd: "/tmp",
					conversation_title: "Asset chat",
					conversation_title_user_set: false,
					conversation_title_forked: false,
					goal: "",
					active_agent: "",
					active_team: "",
					selected_model: null,
					effective_model: null,
					streaming: false,
					generation: 1,
					...patch,
				},
			},
			history: { entries, has_more: false, cursor_missing: false },
			cold: false,
		},
	},
];

test("a double press sends once and creates one session", async () => {
	/*
	 * REVIEW ROUND 2, F7 (the regression for F1). The send is HELD at
	 * `sessions.create`, so both presses happen inside the same in-flight window:
	 * the ref guard must refuse the second synchronously, and the wire most see
	 * exactly one create, one message and one link. Without the guard the second
	 * press ran the whole path and created a second conversation.
	 */
	ANSWER.rows = [asset("la_0000000000000019", { name: "One press only" })];
	ANSWER.ops = [];
	ANSWER.requests = [];
	ANSWER.linkFails = 0;
	sessionStorage.removeItem("library-filters");
	let releaseCreate = () => {};
	ANSWER.createGate = new Promise((resolve) => {
		releaseCreate = resolve;
	});
	const { container, root } = await mount();
	await act(async () =>
		container
			.querySelector('[data-library-card-id="la_0000000000000019"] button')
			?.click(),
	);
	await flush(6);
	const textarea = container.querySelector("[data-library-composer] textarea");
	await act(async () => {
		const setter = Object.getOwnPropertyDescriptor(
			dom.window.HTMLTextAreaElement.prototype,
			"value",
		).set;
		setter.call(textarea, "One question, two presses");
		textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
	await flush(2);
	const send = container.querySelector(
		'[data-library-composer] button[aria-label="Send message"]',
	);
	assert.ok(send);
	// Both presses land before the create answers.
	await act(async () => {
		send.click();
		send.click();
	});
	releaseCreate();
	ANSWER.createGate = null;
	await flush(10);
	const count = (op) =>
		ANSWER.requests.filter((request) => request.op === op).length;
	assert.equal(count("sessions.create"), 1, "one press, one session");
	assert.equal(count("sessions.message"), 1, "one press, one message");
	assert.equal(count("library.chat.link"), 1, "one press, one link");
	await act(async () => root.unmount());
});

test("the link-failed row's Open chat navigates to the conversation", async () => {
	/*
	 * REVIEW ROUND 2, F7 (the regression for F2). The control used to call
	 * `onSessionChange`, which only wrote the preview's lifted id: the press
	 * navigated nowhere. The harness has a `/chat/:agentId` route that renders
	 * "chat route", so a real `navigate` is observable here.
	 */
	ANSWER.rows = [asset("la_0000000000000020", { name: "Link refused" })];
	ANSWER.ops = [];
	ANSWER.requests = [];
	ANSWER.linkFails = 1;
	sessionStorage.removeItem("library-filters");
	const { container, root } = await mount();
	await act(async () =>
		container
			.querySelector('[data-library-card-id="la_0000000000000020"] button')
			?.click(),
	);
	await flush(6);
	const textarea = container.querySelector("[data-library-composer] textarea");
	await act(async () => {
		const setter = Object.getOwnPropertyDescriptor(
			dom.window.HTMLTextAreaElement.prototype,
			"value",
		).set;
		setter.call(textarea, "Sends, then the link is refused");
		textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
	await flush(2);
	await act(async () =>
		container
			.querySelector(
				'[data-library-composer] button[aria-label="Send message"]',
			)
			?.click(),
	);
	await flush(10);
	const row = container.querySelector("[data-library-link-failed]");
	assert.ok(row, "the partial success row is up");
	const open = [...row.querySelectorAll("button")].find((button) =>
		button.textContent?.includes("Open chat"),
	);
	assert.ok(open, "the row offers Open chat");
	await act(async () => open.click());
	await flush(4);
	assert.ok(
		text(container).includes("chat route"),
		"the press navigates to the conversation route",
	);
	await act(async () => root.unmount());
	ANSWER.linkFails = 0;
});

test("a stream snapshot paints the persisted conversation below the asset", async () => {
	ANSWER.rows = [
		asset("la_0000000000000018", {
			name: "Snapshot chat",
			chat: {
				session_id: "feedface5678",
				title: "Asset chat",
				updated_at: 1_700_000_000,
			},
		}),
	];
	ANSWER.ops = [];
	ANSWER.requests = [];
	ANSWER.history = null;
	/*
	 * THE FILTER IS THE PREVIOUS CASE'S, AND IT PERSISTS. The favourite case
	 * presses the rail's Favorites row, which writes `library-filters` to
	 * sessionStorage; a later mount reads it back and this asset is not a
	 * favourite, so its card would not render. Clear the stored filter this case
	 * does not want rather than inheriting it.
	 */
	sessionStorage.removeItem("library-filters");
	ANSWER.stream = streamSnapshot("feedface5678", [
		{
			id: "row-1",
			ts: 1_700_000_000,
			type: "message",
			// A durable row's content is a BLOCK list; `messageText` reads only that
			// shape, which is why a bare string painted no row at first.
			payload: {
				role: "user",
				content: [{ type: "text", text: "what is in this file?" }],
			},
		},
		{
			id: "row-2",
			ts: 1_700_000_001,
			type: "message",
			payload: {
				role: "assistant",
				content: [{ type: "text", text: "It is a one-line note." }],
			},
		},
	]);
	const { container, root } = await mount();
	const card = container.querySelector(
		'[data-library-card-id="la_0000000000000018"] button',
	);
	await act(async () => card.click());
	await flush(10);
	const trajectory = container.querySelector("[data-library-trajectory]");
	assert.ok(trajectory);
	const toggle = trajectory.querySelector("button[aria-expanded]");
	if (toggle?.getAttribute("aria-expanded") === "false") {
		await act(async () => toggle.click());
		await flush(4);
	}
	if (process.env.LIBRARY_DEBUG)
		console.error("TRAJ", JSON.stringify(text(trajectory)));
	assert.ok(
		text(trajectory).includes("what is in this file?"),
		"the snapshot's user row paints",
	);
	assert.ok(
		text(trajectory).includes("It is a one-line note."),
		"the snapshot's assistant row paints",
	);
	await act(async () => root.unmount());
	ANSWER.stream = null;
});
