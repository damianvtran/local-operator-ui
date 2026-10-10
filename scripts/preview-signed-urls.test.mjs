import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, afterEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * The previews' signed static URLs (file-serving RFC § 4, Phase A adoption).
 *
 * WHY THIS FILE EXISTS. Two route-backed viewers - the video player's route
 * attempt and the HTML iframe - now ask MAIN for a signed URL before they load
 * their media, and the risk they carry is not in the happy path: it is that an
 * OLDER CORE, a refused credential or a dead transport must land on exactly the
 * URL these viewers used before the adoption, byte for byte, or a preview
 * breaks on a machine the app has no business breaking on. Source text cannot
 * answer that, so the cases below mount the shipped components in a real DOM
 * and read the attributes the browser would fetch.
 *
 * What is faked, and only that: the transport below `desktopRequest`
 * (`window.api.desktop.request`, the same seam `desktop-renderer-transport`
 * uses). The components, the hook, the static-URL builders and the real
 * request/response plumbing between them are the shipped ones.
 *
 * What it is NOT: evidence about pixels. jsdom loads no media, so nothing here
 * says a frame renders; the claim this PR makes is that the loaded URLs are
 * equivalent on every core, and that is what the assertions read.
 */

// React DOM feature-detects at import time, so the document exists first.
const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/chats",
});
/*
 * jsdom's own constructors are FORCED onto the global - Node defines `Event`
 * itself, and a React tree whose events are built from Node's classes fails
 * inside the commit phase with an error that reads like a component bug. The
 * recipe is `agents-offer-dismiss.test.mjs`'s.
 */
const FORCE_FROM_JSDOM = [
	"Event",
	"CustomEvent",
	"UIEvent",
	"MouseEvent",
	"PointerEvent",
	"KeyboardEvent",
	"FocusEvent",
	"InputEvent",
	"CompositionEvent",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"Range",
	"Selection",
	"DOMRect",
	"DOMRectReadOnly",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
];
for (const key of Object.getOwnPropertyNames(DOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = DOM.window[key];
	} catch {
		// jsdom's own accessors refuse to be read out of scope.
	}
}
globalThis.window = DOM.window;
globalThis.document = DOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/*
 * The frame loop this harness OWNS, and why it queues rather than runs: the
 * HTML viewer keeps its editor mounted (hidden), CodeMirror reads
 * `requestAnimationFrame` off the window it captured, and jsdom without
 * `pretendToBeVisual` leaves it non-callable - the plugin then crashes inside
 * a commit phase, which reads like a component bug. Frames are drained when
 * the harness says so (`frame()`, inside `settle`), so no case races a real
 * frame clock.
 */
const queuedFrames = [];
const frame = () => {
	for (const callback of queuedFrames.splice(0)) callback(0);
};
DOM.window.requestAnimationFrame = (callback) => {
	queuedFrames.push(callback);
	return queuedFrames.length;
};
DOM.window.cancelAnimationFrame = () => {};
globalThis.requestAnimationFrame = DOM.window.requestAnimationFrame;
globalThis.cancelAnimationFrame = DOM.window.cancelAnimationFrame;

const bundle = await build({
	stdin: {
		contents: `
			export { VideoPreview } from "./src/renderer/src/features/chat/components/canvas/video-preview";
			export { HtmlPreview } from "./src/renderer/src/features/chat/components/canvas/html-preview";
			export { fetchSignedStaticUrl, getVideoUrl, getHtmlUrl } from "./src/renderer/src/shared/api/local-operator/static-api";
			export { apiConfig } from "./src/renderer/src/shared/config";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	// Stylesheets carry no assertion here and Node cannot import them.
	loader: { ".css": "empty" },
	jsx: "automatic",
	/*
	 * React stays EXTERNAL so the bundle shares ONE copy with this file's own
	 * `act`; everything else is bundled, because a bare `@mui/material/styles`
	 * left external is a DIRECTORY import Node's ESM resolver refuses (measured
	 * on the first run of this file). `import.meta.env` is defined for the
	 * reason `ask-options.test.mjs` records: `loadConfig` enumerates it at module
	 * scope, and a node import has none.
	 */
	define: { "import.meta.env": "{}" },
	external: ["react", "react-dom", "react/jsx-runtime"],
});
/*
 * A real file beside this one, not a data: URL: the bundle keeps `react`
 * external so the harness's `act` and the components' hooks share ONE React
 * instance, and a data: module cannot resolve a bare specifier. The name starts
 * with `._`, which `.gitignore` covers, and it is unlinked below.
 */
const bundlePath = new URL("._preview-signed-urls.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));
const {
	VideoPreview,
	HtmlPreview,
	fetchSignedStaticUrl,
	getVideoUrl,
	getHtmlUrl,
	apiConfig,
	QueryClient,
	QueryClientProvider,
} = await import(bundlePath.href);
const { createRoot } = await import("react-dom/client");

/* ------------------------------------------------------------------- the seam */

let requests = [];
let currentAnswer = () => {
	throw new Error("no transport installed");
};
/** Install a transport whose answer for each op comes from `answerFor`. */
const installTransport = (answerFor) => {
	requests = [];
	currentAnswer = (request) => {
		if (request.op === "static.sign") return answerFor(request);
		/*
		 * The editor's own hooks (credentials, connectivity) ride the same
		 * transport; their answers are not this file's subject, so they get
		 * benignly-shaped empty results - `config.get` needs `values` because
		 * the connectivity gate reads it before deciding anything.
		 */
		if (request.op === "config.get") {
			return { status: 200, body: { result: { values: {} } } };
		}
		return { status: 200, body: { result: {} } };
	};
	DOM.window.api = {
		desktop: {
			request: async (request) => {
				requests.push(JSON.parse(JSON.stringify(request)));
				return currentAnswer(request);
			},
		},
	};
};

const signedAnswer = (url, exp = 1_700_000_000) => ({
	status: 200,
	body: { url, exp },
});
/** Signs so far - the fixture's `exp` stamp, counted over sign requests
 * alone: the editor's own ops share this transport and must not move it. */
const signCount = () =>
	requests.filter((request) => request.op === "static.sign").length;
const notFoundAnswer = () => ({ status: 404, body: { detail: "Not Found" } });

/* -------------------------------------------------------------- the fixtures */

const videoDocument = (overrides = {}) => ({
	id: "doc-video",
	title: "clip.mp4",
	path: "/Users/synthetic/Downloads/clip.mp4",
	content: "",
	readMtimeMs: 111,
	lastAgentModified: 222,
	...overrides,
});
const htmlDocument = (overrides = {}) => ({
	id: "doc-html",
	title: "report.html",
	path: "/Users/synthetic/Documents/report.html",
	content: "<html></html>",
	readMtimeMs: 333,
	lastAgentModified: 444,
	...overrides,
});

const versionOf = (document) =>
	`${document.readMtimeMs ?? 0}:${document.lastAgentModified ?? 0}`;

/* ---------------------------------------------------------------- the harness */

/**
 * Every client a mount created. React Query schedules cache-GC timers, so a
 * client left uncleared is a handle that keeps this FILE alive after its last
 * case - the suite runs files directly, with no force-exit.
 */
const liveClients = new Set();
/** Views a case has not unmounted yet, reaped after it either way. */
const openViews = [];

const mount = async (element) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	/*
	 * The HTML viewer keeps its editor MOUNTED (hidden), and the editor's
	 * selection controls read react-query. One client per mount, no retries:
	 * nothing here presses a query's control.
	 */
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	liveClients.add(queryClient);
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client: queryClient },
				element,
			),
		);
	});
	let unmounted = false;
	const view = {
		container,
		videoSrc: () => container.querySelector("video")?.getAttribute("src"),
		iframeSrc: () => container.querySelector("iframe")?.getAttribute("src"),
		rerender: async (next) => {
			await act(async () => {
				root.render(
					React.createElement(
						QueryClientProvider,
						{ client: queryClient },
						next,
					),
				);
			});
		},
		/* Idempotent: a case unmounts explicitly, and `afterEach` unmounts
		 * whatever a failed assertion walked away from. */
		unmount: async () => {
			if (unmounted) return;
			unmounted = true;
			await act(async () => root.unmount());
			container.remove();
			queryClient.clear();
			liveClients.delete(queryClient);
		},
	};
	openViews.push(view);
	return view;
};

/** Flush microtasks and effects until `predicate` holds, bounded. */
const settle = async (predicate, attempts = 200) => {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		await act(async () => {});
		await act(async () => frame());
		if (predicate()) return true;
	}
	return false;
};

/** Nothing this file created survives it, whatever a case left behind. */
after(async () => {
	for (const client of liveClients) client.clear();
	liveClients.clear();
});

/* A case that fails an assertion before its own `unmount` must not leave a
 * mounted tree (and its hooks' pending work) behind the next one. */
afterEach(async () => {
	for (const view of openViews.splice(0)) await view.unmount();
});

/* ------------------------------------------------------------------ the cases */

test("the helper returns an absolute signed URL and sends the typed request", async () => {
	installTransport(() =>
		signedAnswer("/v1/static/videos?path=%2Ftmp%2Fclip.mp4&exp=17&sig=abc"),
	);
	const signed = await fetchSignedStaticUrl(
		`${apiConfig.baseUrl}/`,
		"videos",
		"/tmp/clip.mp4",
		3600,
	);
	assert.deepEqual(signed, {
		// The trailing slash is normalized away and the origin-relative URL made
		// absolute: a `file:` renderer cannot resolve the latter on its own.
		url: `${apiConfig.baseUrl}/v1/static/videos?path=%2Ftmp%2Fclip.mp4&exp=17&sig=abc`,
		exp: 1_700_000_000,
	});
	assert.deepEqual(requests, [
		{ op: "static.sign", route: "videos", path: "/tmp/clip.mp4", ttlS: 3600 },
	]);
});

test("every non-2xx, malformed body or transport failure answers null", async () => {
	const cases = [
		["old core (404)", notFoundAnswer],
		["refused plane (401)", () => ({ status: 401, body: { detail: "no" } })],
		["server error (500)", () => ({ status: 500, body: null })],
		["malformed body", () => ({ status: 200, body: { url: 7 } })],
		["empty body", () => ({ status: 200, body: null })],
	];
	for (const [label, answer] of cases) {
		installTransport(answer);
		const signed = await fetchSignedStaticUrl(
			apiConfig.baseUrl,
			"videos",
			"/tmp/clip.mp4",
		);
		assert.equal(signed, null, label);
		// `ttlS` is omitted unless asked for, so the core's own default applies.
		assert.equal("ttlS" in requests[0], false, label);
	}
	installTransport(() => {
		throw new Error("transport down");
	});
	assert.equal(
		await fetchSignedStaticUrl(apiConfig.baseUrl, "videos", "/tmp/clip.mp4"),
		null,
		"rejected transport",
	);
});

test("the request path strips a file:// prefix, like the URL builders do", async () => {
	installTransport(() => signedAnswer("/v1/static/html?path=x&exp=1&sig=s"));
	await fetchSignedStaticUrl(
		apiConfig.baseUrl,
		"html",
		"file:///tmp/page.html",
	);
	assert.equal(requests[0].path, "/tmp/page.html");
});

test("video: the signed URL is what the element loads", async () => {
	const document_ = videoDocument();
	const signedUrl =
		"/v1/static/videos?path=%2FUsers%2Fsynthetic%2FDownloads%2Fclip.mp4&exp=17&sig=v1";
	installTransport(() => signedAnswer(signedUrl));
	const view = await mount(
		React.createElement(VideoPreview, { document: document_ }),
	);
	assert.ok(
		await settle(() => view.videoSrc() !== undefined),
		"the element appears once the URL resolves",
	);
	assert.equal(view.videoSrc(), `${apiConfig.baseUrl}${signedUrl}`);
	assert.deepEqual(requests, [
		{
			op: "static.sign",
			route: "videos",
			path: document_.path,
			// The maximum the core's cap allows: the element keeps issuing Range
			// requests against one URL, so the shortest-lived option (600) would
			// expire under a watching viewer on a core that enforces credentials.
			ttlS: 3600,
		},
	]);
	await view.unmount();
});

test("video: an old core's 404 lands on the plain URL, byte for byte", async () => {
	const document_ = videoDocument();
	installTransport(notFoundAnswer);
	const view = await mount(
		React.createElement(VideoPreview, { document: document_ }),
	);
	assert.ok(await settle(() => view.videoSrc() !== undefined));
	assert.equal(
		view.videoSrc(),
		`${getVideoUrl(apiConfig.baseUrl, document_.path)}&v=${versionOf(document_)}`,
	);
	await view.unmount();
});

test("video: a version change re-signs and loads the new URL", async () => {
	const document_ = videoDocument();
	installTransport(() =>
		signedAnswer(`/v1/static/videos?path=x&exp=${signCount()}&sig=v`),
	);
	const view = await mount(
		React.createElement(VideoPreview, { document: document_ }),
	);
	assert.ok(await settle(() => view.videoSrc() !== undefined));
	assert.equal(signCount(), 1);
	const first = view.videoSrc();

	await view.rerender(
		React.createElement(VideoPreview, {
			document: videoDocument({ readMtimeMs: 999 }),
		}),
	);
	assert.ok(
		await settle(() => signCount() === 2 && view.videoSrc() !== first),
		"a second sign request and a new URL",
	);
	assert.equal(
		view.videoSrc(),
		// The fixture stamps `exp` from the request count, so the SECOND sign
		// (after the version change) is the one this URL must carry.
		`${apiConfig.baseUrl}/v1/static/videos?path=x&exp=2&sig=v`,
	);
	await view.unmount();
});

test("video: a transport that never answers falls back within the bound", async () => {
	let release;
	const pending = new Promise((resolve) => {
		release = resolve;
	});
	installTransport(() => pending);
	const document_ = videoDocument();
	const view = await mount(
		React.createElement(VideoPreview, { document: document_ }),
	);
	// Nothing is mounted against a guess: the element is absent while the
	// attempt is in flight, so an enforcing core never sees a tokenless GET.
	assert.equal(view.videoSrc(), undefined);
	/*
	 * The bound is 3000 ms inside the hook; wait past it in one act so the
	 * fallback state write happens inside act's scope.
	 */
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 3_200));
	});
	assert.equal(
		view.videoSrc(),
		`${getVideoUrl(apiConfig.baseUrl, document_.path)}&v=${versionOf(document_)}`,
	);
	// Let the transport answer so the wrapper's own deadline timer is cleared.
	await act(async () => {
		release(signedAnswer("/v1/static/videos?path=late&exp=1&sig=late"));
	});
	await view.unmount();
});

test("html: the signed URL is what the iframe loads; its TTL asks for the default", async () => {
	const document_ = htmlDocument();
	const signedUrl =
		"/v1/static/html?path=%2FUsers%2Fsynthetic%2FDocuments%2Freport.html&exp=17&sig=h1";
	installTransport(() => signedAnswer(signedUrl));
	const view = await mount(
		React.createElement(HtmlPreview, { document: document_ }),
	);
	assert.ok(await settle(() => view.iframeSrc() !== undefined));
	assert.equal(view.iframeSrc(), `${apiConfig.baseUrl}${signedUrl}`);
	assert.deepEqual(
		requests.filter((request) => request.op === "static.sign"),
		[
			{
				op: "static.sign",
				route: "html",
				path: document_.path,
				// No `ttlS`: the frame loads once per version, so the core's 600 s
				// default is the right window and a longer one only lengthens replay.
			},
		],
	);
	await view.unmount();
});

test("html: an old core's 404 lands on the plain URL, byte for byte", async () => {
	const document_ = htmlDocument();
	installTransport(notFoundAnswer);
	const view = await mount(
		React.createElement(HtmlPreview, { document: document_ }),
	);
	assert.ok(await settle(() => view.iframeSrc() !== undefined));
	assert.equal(view.iframeSrc(), getHtmlUrl(apiConfig.baseUrl, document_.path));
	await view.unmount();
});

test("html: a version change re-signs the frame", async () => {
	const document_ = htmlDocument();
	installTransport(() =>
		signedAnswer(`/v1/static/html?exp=${signCount()}&sig=h`),
	);
	const view = await mount(
		React.createElement(HtmlPreview, { document: document_ }),
	);
	assert.ok(await settle(() => view.iframeSrc() !== undefined));
	assert.equal(signCount(), 1);
	const first = view.iframeSrc();

	await view.rerender(
		React.createElement(HtmlPreview, {
			document: htmlDocument({ lastAgentModified: 777 }),
		}),
	);
	assert.ok(
		await settle(() => signCount() === 2 && view.iframeSrc() !== first),
	);
	assert.equal(
		view.iframeSrc(),
		`${apiConfig.baseUrl}/v1/static/html?exp=2&sig=h`,
	);
	await view.unmount();
});
