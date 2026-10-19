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
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
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
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { LibraryPage } from "./src/renderer/src/features/library/components/library-page";

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
	},
	loader: { ".css": "empty" },
	write: false,
});
const bundlePath = new URL(
	`./_library-page-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { mountLibrary } = await import(bundlePath.href);
await unlink(bundlePath);

const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime();

/* Class-token readers, hoisted so the layout case allocates no regex per row. */
const CLASS_TOKENS = /\s+/;
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
		const scoped =
			request.scope === "final"
				? ANSWER.rows.filter(
						(row) => row.highlighted || row.origin_group === "generated",
					)
				: ANSWER.rows;
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

const mount = async () => {
	const container = document.createElement("div");
	document.body.append(container);
	const { root, client } = mountLibrary(container, NOW);
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

		const scopeAll = [...container.querySelectorAll("button")].find((button) =>
			button.textContent?.trim().startsWith("All inclusions"),
		);
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
		assert.ok(text(container).includes("Mentioned"));
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
		'[data-library-composer] button[aria-label="Send"]',
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
			'[data-library-composer] button[aria-label="Send"]',
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
			.querySelector('[data-library-composer] button[aria-label="Send"]')
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

after(() => {
	// jsdom keeps window timers alive; close it so a stray debounce or query
	// timer cannot hold the node:test process open after every case unmounts.
	dom.window.close();
});
