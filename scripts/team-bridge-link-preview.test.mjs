import assert from "node:assert/strict";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/*
 * The link-preview card: the wire rules that shape it, the states it can draw,
 * and the two IPC hops it makes.
 *
 * WHAT THIS SUITE IS FOR. Every rule the card enforces is a rule about an answer
 * core gave, so the fixtures here are the shapes core actually sends - fields
 * ABSENT rather than null, an image with no size whose bytes still answer, a 422
 * with no error body. A fixture that filled those in would pass while the card
 * drew `undefined` and a zero-pixel box in the real app.
 *
 * The harness is the sibling Team Bridge suites' (bundle the SHIPPED modules
 * with esbuild, render with this process's React, JSDOM for the hooked cases):
 * esbuild cannot read the renderer's tsconfig paths, so the aliases are spelled
 * out, and React stays external so the bundle and the renderer share one copy.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import {
				linkPreviewRequest,
				linkPreviewCard,
				linkPreviewCardView,
				linkPreviewSiteLabel,
				linkPreviewImageAlt,
				linkPreviewArtifactRefusal,
				linkPreviewRetry,
				linkPreviewDrawsCard,
			} from "./src/renderer/src/features/team-bridge/link-preview/link-preview-model";
			import {
				TeamBridgeLinkPreview,
				TeamBridgeLinkPreviewView,
			} from "./src/renderer/src/features/team-bridge/link-preview/team-bridge-link-preview";
			import { teamBridgeMessageLinks } from "./src/renderer/src/features/team-bridge/link-preview/message-links";
			import { TeamBridgeMessageLinkPreviews } from "./src/renderer/src/features/team-bridge/link-preview/team-bridge-message-link-previews";
			export {
				teamBridgeMessageLinks,
				TeamBridgeMessageLinkPreviews,
				createElement,
				linkPreviewRequest,
				linkPreviewCard,
				linkPreviewCardView,
				linkPreviewSiteLabel,
				linkPreviewImageAlt,
				linkPreviewArtifactRefusal,
				linkPreviewRetry,
				linkPreviewDrawsCard,
				TeamBridgeLinkPreview,
				TeamBridgeLinkPreviewView,
			};
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	mainFields: ["module", "main"],
	conditions: ["import"],
	external: ["react", "react/jsx-runtime", "react-dom", "react-dom/server"],
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45998" };',
	},
	loader: { ".css": "empty", ".png": "empty" },
	jsx: "automatic",
});
const bundlePath = join(HERE, "_link-preview-card.bundle.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const m = await import(bundlePath);
after(() => {
	// The bundle is a build artefact of this run, not a source file.
	unlinkSync(bundlePath);
});

/* ------------------------------------------------------------------------- */
/* Wire fixtures                                                              */
/* ------------------------------------------------------------------------- */

const FAVICON_ID = "0123456789abcdef0123456789abcdef";
const IMAGE_ID = "fedcba9876543210fedcba9876543210";
const URL_TEXT = "https://example.com/changelog";
const RETRY_COPY = /Retry/;

/** A `ready` answer as the wire sends it: unset fields are ABSENT, not null. */
const ready = (preview = {}) => ({
	kind: "ready",
	preview: {
		url: URL_TEXT,
		title: "What changed this week",
		description: "Three fixes.",
		...preview,
	},
});

const picture = (patch = {}) => ({
	id: IMAGE_ID,
	mime: "image/png",
	width: 640,
	height: 360,
	...patch,
});

/* ------------------------------------------------------------------------- */
/* Asking                                                                     */
/* ------------------------------------------------------------------------- */

test("no usable receipt refuses the request instead of sending a blank one", () => {
	for (const expectedAccountId of [undefined, null, "", 42]) {
		assert.deepEqual(
			m.linkPreviewRequest({ url: URL_TEXT, index: 0, expectedAccountId }),
			{ kind: "refuse", reason: "account" },
			"main holds no identity of its own, so there is nothing to default to",
		);
	}
	assert.deepEqual(
		m.linkPreviewRequest({
			url: URL_TEXT,
			index: 0,
			expectedAccountId: "acct_1",
		}),
		{
			kind: "ask",
			request: { url: URL_TEXT, index: 0, expectedAccountId: "acct_1" },
		},
	);
});

test("the receipt crosses the boundary unaltered", () => {
	// Not trimmed, not case-folded: an identity this app tidies up is one it
	// decided, and core's comparison is the only thing that makes it a receipt.
	const plan = m.linkPreviewRequest({
		url: URL_TEXT,
		index: 1,
		expectedAccountId: " acct_1 ",
	});
	assert.equal(plan.kind, "ask");
	assert.equal(plan.request.expectedAccountId, " acct_1 ");
});

test("an index past the per-message cap is refused before any round trip", () => {
	for (const index of [3, 4, 99, -1, 1.5, Number.NaN]) {
		assert.deepEqual(
			m.linkPreviewRequest({
				url: URL_TEXT,
				index,
				expectedAccountId: "acct_1",
			}),
			{ kind: "refuse", reason: "cap" },
		);
	}
	for (const index of [0, 1, 2]) {
		assert.equal(
			m.linkPreviewRequest({
				url: URL_TEXT,
				index,
				expectedAccountId: "acct_1",
			}).kind,
			"ask",
		);
	}
});

test("nobody asks about an empty url or one past core's own bound", () => {
	for (const url of [
		"",
		undefined,
		`https://example.com/${"a".repeat(4096)}`,
	]) {
		assert.deepEqual(
			m.linkPreviewRequest({ url, index: 0, expectedAccountId: "acct_1" }),
			{ kind: "refuse", reason: "url" },
		);
	}
});

/* ------------------------------------------------------------------------- */
/* The ready card                                                             */
/* ------------------------------------------------------------------------- */

test("omitted wire fields normalize to null, never to undefined", () => {
	const card = m.linkPreviewCard(ready().preview);
	assert.equal(card.siteName, null);
	assert.equal(card.favicon, null);
	assert.equal(card.image, null);
	assert.equal(card.imageBox, null);
	assert.equal(card.title, "What changed this week");
	// A card that painted `undefined` would be the same fault with a friendlier
	// face, so the whole shape is pinned rather than the fields a reader thought
	// to check.
	assert.deepEqual(Object.keys(card).sort(), [
		"description",
		"favicon",
		"image",
		"imageBox",
		"siteName",
		"title",
		"url",
	]);
});

test("a blank string is absent, not content", () => {
	const card = m.linkPreviewCard(
		ready({ siteName: "   ", title: "", description: null }).preview,
	);
	assert.equal(card.siteName, null);
	assert.equal(card.title, null);
	assert.equal(card.description, null);
});

test("image dimensions are a measurement or absent, never zero", () => {
	const boxed = (patch) =>
		m.linkPreviewCard(ready({ image: picture(patch) }).preview).imageBox;
	assert.deepEqual(boxed({}), { width: 640, height: 360 });
	// The live case: the header carried nothing, the bytes still answer 200.
	assert.equal(boxed({ width: null, height: null }), null);
	assert.equal(boxed({ width: undefined, height: undefined }), null);
	assert.equal(boxed({ width: null, height: 360 }), null);
	assert.equal(boxed({ width: 0, height: 0 }), null, "a zero is not a size");
	assert.equal(boxed({ width: 640, height: 0 }), null);
	assert.equal(boxed({ width: -640, height: 360 }), null);
	assert.equal(boxed({ width: 640.5, height: 360 }), null);
});

test("an artifact id that is not core's 32 hex chars is dropped, not asked for", () => {
	const card = m.linkPreviewCard(
		ready({
			favicon: { id: "not-an-id", mime: "image/png" },
			image: picture({ id: "../../etc/passwd" }),
		}).preview,
	);
	assert.equal(card.favicon, null);
	assert.equal(card.image, null);
});

test("a ready answer holding nothing worth drawing is no-metadata", () => {
	assert.deepEqual(
		m.linkPreviewCardView({
			kind: "ready",
			preview: { url: "", title: "", description: "", siteName: null },
		}),
		{ kind: "absent", reason: "no-metadata" },
	);
});

test("the site line falls back to the host, so a card always has a name", () => {
	assert.equal(
		m.linkPreviewSiteLabel(
			m.linkPreviewCard(ready({ siteName: "Example" }).preview),
		),
		"Example",
	);
	assert.equal(
		m.linkPreviewSiteLabel(
			m.linkPreviewCard(ready({ siteName: null }).preview),
		),
		"example.com",
		"no site name means the host stands in, never an empty label",
	);
	// A blank URL is normalized to `""`, not `null` (R1-m1): nullish fallbacks
	// stop on it and leave the card with a globe and no name.
	assert.equal(
		m.linkPreviewSiteLabel(m.linkPreviewCard(ready({ url: "" }).preview)),
		"What changed this week",
		"a blank canonical URL falls through to the title",
	);
});

test("the picture is decoration beside a title and the whole card when there is none", () => {
	assert.equal(m.linkPreviewImageAlt(m.linkPreviewCard(ready().preview)), "");
	assert.equal(
		m.linkPreviewImageAlt(
			m.linkPreviewCard(ready({ title: null, siteName: "Example" }).preview),
		),
		"Example",
	);
});

/* ------------------------------------------------------------------------- */
/* Absent, disabled, and the retry states                                     */
/* ------------------------------------------------------------------------- */

test("disabled is its own state, not a generic absent", () => {
	const disabled = m.linkPreviewCardView({
		kind: "absent",
		reason: "disabled",
	});
	assert.deepEqual(disabled, { kind: "disabled" });
	assert.equal(
		m.linkPreviewDrawsCard(disabled),
		false,
		"the operator's switch being off draws plain text, never a cached card",
	);
	for (const reason of [
		"content-type",
		"unsupported-scheme",
		"cap",
		"local-or-private",
		"blocked-host",
		"no-metadata",
	]) {
		assert.deepEqual(m.linkPreviewCardView({ kind: "absent", reason }), {
			kind: "absent",
			reason,
		});
	}
});

test("a retryable error that names its delay waits instead of drawing a card", () => {
	const view = m.linkPreviewCardView({
		kind: "error",
		retryable: true,
		retryAfterMs: 4000,
	});
	assert.deepEqual(view, { kind: "waiting", retryInMs: 4000 });
	assert.equal(
		m.linkPreviewDrawsCard(view),
		false,
		"a 429 core said to wait on is not an error card",
	);
});

test("a retryable error with no delay is one quiet manual retry", () => {
	assert.deepEqual(m.linkPreviewCardView({ kind: "error", retryable: true }), {
		kind: "retry",
	});
	assert.deepEqual(m.linkPreviewRetry({ kind: "error", retryable: true }), {
		kind: "manual",
	});
});

test("a refusal a retry cannot change draws nothing", () => {
	assert.deepEqual(m.linkPreviewCardView({ kind: "error", retryable: false }), {
		kind: "silent",
	});
});

test("a delay beyond the longest timer this app holds draws nothing", () => {
	assert.deepEqual(
		m.linkPreviewCardView({
			kind: "error",
			retryable: true,
			retryAfterMs: 60 * 60 * 1000,
		}),
		{ kind: "silent" },
	);
});

test("the delayed-retry budget is spent, so a rate limiter cannot hold a timer forever", () => {
	const waiting = { kind: "error", retryable: true, retryAfterMs: 1000 };
	assert.deepEqual(m.linkPreviewCardView(waiting, 0), {
		kind: "waiting",
		retryInMs: 1000,
	});
	assert.deepEqual(m.linkPreviewCardView(waiting, 2), {
		kind: "waiting",
		retryInMs: 1000,
	});
	assert.deepEqual(m.linkPreviewCardView(waiting, 3), { kind: "silent" });
});

/* ------------------------------------------------------------------------- */
/* Artifact refusals                                                          */
/* ------------------------------------------------------------------------- */

test("every artifact refusal keeps its own state", () => {
	const refusal = m.linkPreviewArtifactRefusal;
	assert.deepEqual(
		refusal({
			kind: "bytes",
			data: new Uint8Array([1]),
			mimeType: "image/png",
		}),
		{ kind: "served" },
	);
	// The code decides: main has already turned Core's statuses into these.
	assert.deepEqual(refusal({ kind: "error", code: "not-found", status: 404 }), {
		kind: "gone",
		status: 404,
	});
	assert.deepEqual(
		refusal({ kind: "error", code: "invalid-request", status: 422 }),
		{ kind: "receipt", status: 422 },
	);
	assert.deepEqual(
		refusal({ kind: "error", code: "account-mismatch", status: 409 }),
		{ kind: "account", status: 409 },
	);
	assert.deepEqual(
		refusal({ kind: "error", code: "unauthorized", status: 401 }),
		{ kind: "unauthorized", status: 401 },
	);
	// A 404 WITHOUT Core's `artifact_not_found` is a desktop backend that predates
	// the route, not bytes that are gone: the card keeps asking rather than
	// treating a stale backend as a dead picture.
	assert.deepEqual(refusal({ kind: "error", code: "io", status: 404 }), {
		kind: "transient",
		status: 404,
	});
	assert.deepEqual(refusal({ kind: "error", code: "io", status: 503 }), {
		kind: "transient",
		status: 503,
	});
	// The pre-split preload reported the account fence as `io` + 409.
	assert.deepEqual(refusal({ kind: "error", code: "io", status: 409 }), {
		kind: "account",
		status: 409,
	});
});

/* ------------------------------------------------------------------------- */
/* Markup                                                                     */
/* ------------------------------------------------------------------------- */

const renderView = (view, props = {}) =>
	renderToStaticMarkup(
		React.createElement(m.TeamBridgeLinkPreviewView, { view, ...props }),
	);

test("a ready card draws the site, the title, the description and links out", () => {
	const view = m.linkPreviewCardView(
		ready({
			siteName: "Example",
			favicon: { id: FAVICON_ID, mime: "image/png" },
			image: picture(),
		}),
	);
	const html = renderView(view, {
		imageUrl: "blob:card/picture",
		faviconUrl: "blob:card/favicon",
	});
	assert.match(html, /Example/);
	assert.match(html, /What changed this week/);
	assert.match(html, /Three fixes\./);
	assert.match(html, /src="blob:card\/picture"/);
	assert.match(html, /blob:card\/favicon/);
	// The destination is the page's own canonical URL, handed to the browser -
	// never a window this app navigates.
	assert.match(html, /href="https:\/\/example\.com\/changelog"/);
	assert.match(html, /target="_blank"/);
	assert.match(html, /rel="noopener noreferrer"|rel="noreferrer"/);
});

test("a measured picture reserves its ratio and an unmeasured one reserves a strip", () => {
	const measured = renderView(
		m.linkPreviewCardView(ready({ image: picture() })),
		{ imageUrl: "blob:card/picture" },
	);
	assert.match(measured, /aspect-ratio:640 \/ 360/);
	assert.doesNotMatch(measured, /height:128px/, "a ratio needs no strip");

	const unmeasured = renderView(
		m.linkPreviewCardView(
			ready({ image: picture({ width: null, height: null }) }),
		),
		{ imageUrl: "blob:card/picture" },
	);
	assert.match(unmeasured, /height:128px/);
	assert.doesNotMatch(
		unmeasured,
		/aspect-ratio/,
		"absent dimensions are UNKNOWN, so the card claims no ratio",
	);
	assert.doesNotMatch(
		`${measured}${unmeasured}`,
		/0px|0 \/ 0|width:0/,
		"no zero-sized box, in either case",
	);
});

test("a picture that never arrived leaves the text alone", () => {
	const html = renderView(m.linkPreviewCardView(ready()), { imageUrl: null });
	assert.doesNotMatch(html, /<img/, "no empty framed box where a picture was");
	assert.match(html, /What changed this week/);
});

test("a canonical URL that is not http(s) is drawn but never linked", () => {
	const html = renderView(
		m.linkPreviewCardView(ready({ url: "javascript:alert(1)" })),
	);
	assert.doesNotMatch(html, /<a /);
	assert.match(html, /What changed this week/);
});

test("absent, disabled, waiting and silent draw nothing at all", () => {
	for (const view of [
		{ kind: "absent", reason: "local-or-private" },
		{ kind: "absent", reason: "content-type" },
		{ kind: "disabled" },
		{ kind: "waiting", retryInMs: 4000 },
		{ kind: "silent" },
	]) {
		assert.equal(renderView(view), "", `nothing for ${view.kind}`);
	}
});

test("a manual retry is one quiet control", () => {
	const html = renderView({ kind: "retry" }, { onRetry: () => {} });
	assert.match(html, /<button/);
	assert.match(html, RETRY_COPY);
});

/* ------------------------------------------------------------------------- */
/* The IPC hops, through the connected component                              */
/* ------------------------------------------------------------------------- */

/*
 * JSDOM for the hooked cases, set up AFTER the static markup tests so the
 * document a server render sees is not replaced under it. Object URLs are
 * stubbed because JSDOM has none and the artifact hook builds one; the stub
 * counts revokes so a leaked picture URL is visible rather than asserted by eye.
 */
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;

globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let objectUrls = 0;
let revokedUrls = 0;
globalThis.URL.createObjectURL = () => {
	objectUrls += 1;
	return `blob:card/${objectUrls}`;
};
globalThis.URL.revokeObjectURL = () => {
	revokedUrls += 1;
};

const { createRoot } = await import("react-dom/client");
const settle = () =>
	act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

/** Mount the connected card and return what it rendered plus the calls it made. */
async function mountConnected(props) {
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	await act(async () =>
		root.render(React.createElement(m.TeamBridgeLinkPreview, props)),
	);
	await settle();
	await settle();
	return {
		html: () => element.innerHTML,
		/* Rerender the SAME root so hook state survives the props change — the only
		 * way to reach a reused instance's reset paths (R1-m2). A fresh mount would
		 * reset every hook by construction and prove nothing. */
		rerender: async (next) => {
			await act(async () =>
				root.render(React.createElement(m.TeamBridgeLinkPreview, next)),
			);
			await settle();
			await settle();
		},
		close: async () => {
			await act(async () => root.unmount());
			element.remove();
		},
	};
}

const recordingBridge = (answers = []) => {
	const resolves = [];
	const artifacts = [];
	let index = 0;
	return {
		resolves,
		artifacts,
		bridge: {
			resolve: async (request) => {
				resolves.push(request);
				const answer = answers[Math.min(index, answers.length - 1)] ?? {
					kind: "absent",
					reason: "no-metadata",
				};
				index += 1;
				return answer;
			},
			artifact: async (request) => {
				artifacts.push(request);
				return {
					kind: "bytes",
					data: new Uint8Array([137, 80, 78, 71]),
					mimeType: "image/png",
				};
			},
		},
	};
};

test("without a receipt the card never asks, and draws nothing", async () => {
	const record = recordingBridge([ready()]);
	const mounted = await mountConnected({
		url: URL_TEXT,
		index: 0,
		expectedAccountId: null,
		bridge: record.bridge,
	});
	assert.equal(record.resolves.length, 0);
	assert.equal(record.artifacts.length, 0);
	assert.equal(mounted.html(), "");
	await mounted.close();
});

test("one resolve per link, carrying the receipt main cannot invent", async () => {
	const record = recordingBridge([ready()]);
	const mounted = await mountConnected({
		url: URL_TEXT,
		index: 2,
		expectedAccountId: "acct_self",
		bridge: record.bridge,
	});
	assert.deepEqual(record.resolves, [
		{ url: URL_TEXT, index: 2, expectedAccountId: "acct_self" },
	]);
	assert.match(mounted.html(), /What changed this week/);
	await mounted.close();
});

test("the picture's bytes are asked for with the SAME receipt, by id", async () => {
	const record = recordingBridge([
		ready({
			favicon: { id: FAVICON_ID, mime: "image/png" },
			image: picture(),
		}),
	]);
	const mounted = await mountConnected({
		url: URL_TEXT,
		index: 0,
		expectedAccountId: "acct_self",
		bridge: record.bridge,
	});
	assert.deepEqual(
		record.artifacts.map((request) => request.id).sort(),
		[FAVICON_ID, IMAGE_ID].sort(),
	);
	for (const request of record.artifacts) {
		assert.equal(request.expectedAccountId, "acct_self");
	}
	assert.match(mounted.html(), /src="blob:card\/1"/);
	await mounted.close();
	assert.ok(revokedUrls >= 1, "the picture URL is revoked when the card goes");
});

test("a reused card drops the previous link's picture, never a revoked blob", async () => {
	// R1-m2 reproduction. One instance, two links: the cleanup revokes link A's
	// blob URL, so a hook that keeps its state across the props change hands the
	// card a dead `url` and the plate paints an <img> at a revoked address until
	// `onError` hides it.
	const second = "https://second.example/page";
	const record = recordingBridge([
		ready({ image: picture() }),
		ready({ url: second, title: "Second page", description: null }),
	]);
	const mounted = await mountConnected({
		url: URL_TEXT,
		index: 0,
		expectedAccountId: "acct_self",
		bridge: record.bridge,
	});
	// `finally`, so a failing assertion still unmounts this root: left mounted, it
	// fails the NEXT test too and one regression reads as two (#1722 R2-n2).
	try {
		assert.match(
			mounted.html(),
			/<img src="blob:/,
			"link A's picture is drawn",
		);
		await mounted.rerender({
			url: second,
			index: 0,
			expectedAccountId: "acct_self",
			bridge: record.bridge,
		});
		assert.match(mounted.html(), /Second page/, "the second link is drawn");
		assert.doesNotMatch(
			mounted.html(),
			/src="blob:/,
			"a pictureless link paints no picture, revoked URL included",
		);
	} finally {
		await mounted.close();
	}
});

/* Q-1 (#1722 QA round 1). The only other hook-level delayed-retry case lets the
 * wait run out; these two end it early. The link change is the one that catches
 * a missing `clearTimeout` (measured: deleting it fails that test alone): the
 * stale timer bumps the retry count and re-asks for the NEW link. The unmount
 * case pins the observable a reader cares about - nobody asks for a card that
 * left - which React's own refusal to update an unmounted hook also holds, so it
 * is not a `clearTimeout` detector on its own. The delay is long enough that a loaded runner
 * cannot reach it during the mount's own settles, and the wait after it is
 * several times longer still. */
const RATE_LIMITED = { kind: "error", retryable: true, retryAfterMs: 150 };

test("a delayed retry WAITS and then asks again, drawing no error card", async () => {
	// `RATE_LIMITED`'s 150 ms, not the 20 ms this case first used: the mount's two
	// settles could outlast 20 ms on a loaded runner, so the retry had already
	// fired at the first assertion (measured: 2 of 8 local runs on a shared host read 2 resolves).
	const record = recordingBridge([RATE_LIMITED, ready()]);
	const mounted = await mountConnected({
		url: URL_TEXT,
		index: 0,
		expectedAccountId: "acct_self",
		bridge: record.bridge,
	});
	assert.equal(record.resolves.length, 1);
	assert.equal(mounted.html(), "", "nothing is drawn while the retry waits");
	await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
	await settle();
	assert.equal(record.resolves.length, 2, "core's delay was honoured");
	assert.match(mounted.html(), /What changed this week/);
	await mounted.close();
});

test("changing the link during a 429 wait cancels the old link's retry", async () => {
	const second = "https://second.example/page";
	const resolves = [];
	const bridge = {
		resolve: async (request) => {
			resolves.push(request);
			return request.url === URL_TEXT
				? RATE_LIMITED
				: ready({ url: second, title: "Second page" });
		},
		artifact: async () => ({ kind: "error", code: "not-found", status: 404 }),
	};
	const mounted = await mountConnected({
		url: URL_TEXT,
		index: 0,
		expectedAccountId: "acct_self",
		bridge,
	});
	try {
		assert.equal(resolves.length, 1, "the first link is asked about once");
		await mounted.rerender({
			url: second,
			index: 0,
			expectedAccountId: "acct_self",
			bridge,
		});
		await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
		await settle();
		assert.deepEqual(
			resolves.map((request) => request.url),
			[URL_TEXT, second],
			"one resolve for the new link, and no retry of the old one",
		);
		assert.match(mounted.html(), /Second page/);
	} finally {
		await mounted.close();
	}
});

test("unmounting during a 429 wait cancels the retry", async () => {
	const record = recordingBridge([RATE_LIMITED, ready()]);
	const mounted = await mountConnected({
		url: URL_TEXT,
		index: 0,
		expectedAccountId: "acct_self",
		bridge: record.bridge,
	});
	let closed = false;
	try {
		assert.equal(record.resolves.length, 1);
		await mounted.close();
		closed = true;
		await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
		assert.equal(record.resolves.length, 1, "nobody asks for a card that left");
	} finally {
		if (!closed) await mounted.close();
	}
});

test("disabled asks once, draws nothing, and never fetches bytes", async () => {
	const record = recordingBridge([
		// A cached card the renderer could have drawn: the whole point of the
		// stop being here is that nothing upstream will withhold it.
		{
			kind: "ready",
			preview: {
				url: URL_TEXT,
				title: "Cached",
				image: picture(),
				favicon: { id: FAVICON_ID, mime: "image/png" },
			},
		},
	]);
	const disabled = {
		resolve: async (request) => {
			record.resolves.push(request);
			return { kind: "absent", reason: "disabled" };
		},
		artifact: async (request) => {
			record.artifacts.push(request);
			return { kind: "error", code: "not-found", status: 404 };
		},
	};
	const mounted = await mountConnected({
		url: URL_TEXT,
		index: 0,
		expectedAccountId: "acct_self",
		bridge: disabled,
	});
	assert.equal(record.resolves.length, 1, "the switch is asked about once");
	assert.equal(record.artifacts.length, 0, "and no artifact is ever asked for");
	assert.equal(mounted.html(), "", "plain text at the caller, no card here");
	await mounted.close();
});

test("the card module carries no fetch path of its own", () => {
	const cardDir = join(
		ROOT,
		"src/renderer/src/features/team-bridge/link-preview",
	);
	for (const file of [
		"link-preview-model.ts",
		"message-links.ts",
		"team-bridge-link-preview.tsx",
		"team-bridge-message-link-previews.tsx",
		"use-link-preview.ts",
	]) {
		const source = readFileSync(join(cardDir, file), "utf8");
		// The renderer's only ways out are IPC: a `fetch`, an XHR, a
		// `new Image()` or a beacon/stream here would be this app telling the
		// linked site who read the message. The comment names the class, so the
		// assertion covers the class (R1-m4).
		assert.doesNotMatch(source, /\bfetch\s*\(/, `${file} fetches`);
		assert.doesNotMatch(source, /XMLHttpRequest/, `${file} opens an XHR`);
		assert.doesNotMatch(source, /new Image\s*\(/, `${file} decodes an image`);
		assert.doesNotMatch(
			source,
			/sendBeacon|EventSource/,
			`${file} opens a side channel`,
		);
	}
});

/* ------------------------------------------------------------------------- */
/* The mount: which links of a message get a card                             */
/* ------------------------------------------------------------------------- */

test("a link's index is its position among the message's links, unfiltered", () => {
	assert.deepEqual(m.teamBridgeMessageLinks(""), []);
	assert.deepEqual(m.teamBridgeMessageLinks("no links here, just words"), []);
	assert.deepEqual(
		m.teamBridgeMessageLinks(
			[
				"Mail [me](mailto:a@example.com) first,",
				"then https://one.example/a and <https://two.example/b>,",
				"a [named](https://three.example/c), a [ref][r] and https://one.example/a again.",
				"",
				"[r]: https://ref.example/d",
			].join("\n"),
		),
		[
			// A mailto spends a position: core, not this renderer, refuses it.
			"mailto:a@example.com",
			"https://one.example/a",
			"https://two.example/b",
			"https://three.example/c",
			"https://ref.example/d",
			// A duplicate keeps its own position too.
			"https://one.example/a",
		],
	);
});

test("only what the message draws as a link takes a position", () => {
	assert.deepEqual(
		m.teamBridgeMessageLinks(
			[
				"`https://code.example/inline`",
				"",
				"```",
				"https://code.example/block",
				"```",
				"",
				"![alt](https://image.example/pic.png) [dangling][nowhere]",
				"and finally https://real.example/x",
			].join("\n"),
		),
		["https://real.example/x"],
	);
});

test("a legacy inline-data region is not parsed for links", () => {
	const blob = `data:image/png;base64,${"A".repeat(256)}`;
	assert.deepEqual(
		m.teamBridgeMessageLinks(
			`before https://a.example/1 ![x](${blob}) after https://b.example/2`,
		),
		["https://a.example/1", "https://b.example/2"],
	);
});

/** A bridge that answers per URL, so a message's links can each get their own
 * refusal. Unlisted URLs are `ready` with their own title. */
const perUrlBridge = (answers = {}) => {
	const resolves = [];
	const artifacts = [];
	return {
		resolves,
		artifacts,
		bridge: {
			resolve: async (request) => {
				resolves.push(request);
				return (
					answers[request.url] ??
					ready({ url: request.url, title: `Card for ${request.url}` })
				);
			},
			artifact: async (request) => {
				artifacts.push(request);
				return { kind: "error", code: "not-found", status: 404 };
			},
		},
	};
};

async function mountMessage(props) {
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	await act(async () =>
		root.render(React.createElement(m.TeamBridgeMessageLinkPreviews, props)),
	);
	await settle();
	await settle();
	return {
		element,
		cards: () => [...element.querySelectorAll("a[title]")].map((a) => a.title),
		close: async () => {
			await act(async () => root.unmount());
			element.remove();
		},
	};
}

const linksBody = (count) =>
	Array.from({ length: count }, (_, i) => `https://site${i}.example/p`).join(
		" and ",
	);

test("a message with no links mounts nothing and asks nothing", async () => {
	const record = perUrlBridge();
	const mounted = await mountMessage({
		body: "just words",
		expectedAccountId: "acct_self",
		bridge: record.bridge,
	});
	try {
		assert.equal(mounted.element.innerHTML, "");
		assert.equal(record.resolves.length, 0);
	} finally {
		await mounted.close();
	}
});

test("one link and three links each get their own card, indexed in order", async () => {
	for (const count of [1, 3]) {
		const record = perUrlBridge();
		const mounted = await mountMessage({
			body: linksBody(count),
			expectedAccountId: "acct_self",
			bridge: record.bridge,
		});
		try {
			assert.deepEqual(
				record.resolves.map(({ url, index, expectedAccountId }) => [
					url,
					index,
					expectedAccountId,
				]),
				Array.from({ length: count }, (_, i) => [
					`https://site${i}.example/p`,
					i,
					"acct_self",
				]),
			);
			assert.equal(mounted.cards().length, count);
		} finally {
			await mounted.close();
		}
	}
});

test("more than three links draws three cards and never asks about the fourth", async () => {
	const record = perUrlBridge();
	const mounted = await mountMessage({
		body: linksBody(5),
		expectedAccountId: "acct_self",
		bridge: record.bridge,
	});
	try {
		assert.deepEqual(
			record.resolves.map((request) => request.index),
			[0, 1, 2],
		);
		assert.deepEqual(mounted.cards(), [
			"https://site0.example/p",
			"https://site1.example/p",
			"https://site2.example/p",
		]);
	} finally {
		await mounted.close();
	}
});

test("disabled previews leave the plain link: no card, no bytes, an empty list", async () => {
	const disabled = { kind: "absent", reason: "disabled" };
	const record = perUrlBridge({
		"https://site0.example/p": disabled,
		"https://site1.example/p": disabled,
	});
	const mounted = await mountMessage({
		body: linksBody(2),
		expectedAccountId: "acct_self",
		bridge: record.bridge,
	});
	try {
		assert.equal(record.resolves.length, 2);
		assert.equal(record.artifacts.length, 0);
		const list = mounted.element.querySelector("[data-link-previews]");
		assert.ok(list, "the list is mounted");
		assert.equal(list.children.length, 0, "and holds no card");
		assert.match(list.className, /empty:hidden/, "so it takes no space");
	} finally {
		await mounted.close();
	}
});

test("mixed refusals draw only the links core resolved, in core's positions", async () => {
	const record = perUrlBridge({
		"https://site0.example/p": { kind: "absent", reason: "local-or-private" },
		"https://site2.example/p": { kind: "error", retryable: false },
	});
	const mounted = await mountMessage({
		// Four links: the refused first one still spends position 0, so the
		// fourth is past the cap and is never asked about.
		body: linksBody(4),
		expectedAccountId: "acct_self",
		bridge: record.bridge,
	});
	try {
		assert.deepEqual(
			record.resolves.map((request) => [request.url, request.index]),
			[
				["https://site0.example/p", 0],
				["https://site1.example/p", 1],
				["https://site2.example/p", 2],
			],
		);
		assert.deepEqual(mounted.cards(), ["https://site1.example/p"]);
	} finally {
		await mounted.close();
	}
});

test("a message rendered with no account asks nothing for any of its links", async () => {
	const record = perUrlBridge();
	const mounted = await mountMessage({
		body: linksBody(3),
		expectedAccountId: undefined,
		bridge: record.bridge,
	});
	try {
		assert.equal(record.resolves.length, 0);
		assert.deepEqual(mounted.cards(), []);
	} finally {
		await mounted.close();
	}
});
