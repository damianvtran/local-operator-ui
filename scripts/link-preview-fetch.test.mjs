/**
 * The resolve path under caps: redirects, sniffing, dedupe and the card cap.
 *
 * WHAT IS REAL HERE. The whole decision chain in `resolve.ts`, driven through a
 * stub transport that speaks the `Hop` contract (`http-transport.ts`): the redirect
 * guard, the sniff-over-header rule, the "too large" refusal, the in-flight
 * dedupe and the per-message cap. Every hop is counted, so "no fetch happened" is
 * an assertion.
 *
 * WHAT IS NOT HERE. The socket itself. `nodeHop` is exercised by driving the app,
 * and the byte/time caps it enforces are asserted here as the transport contract
 * (`truncated: true` is what the real transport sets when its counter crosses the
 * cap).
 */

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bundleMainModules } from "./link-preview-bundle.mjs";

const mod = await import(
	await bundleMainModules("link-preview-fetch", [
		"src/main/link-preview/resolve.ts",
		"src/main/link-preview/cache.ts",
	])
);

const utf8 = (text) => new TextEncoder().encode(text);

/** A PNG header, enough for the sniff and the IHDR dimension read. */
function pngHeader(width, height) {
	const bytes = new Uint8Array(29);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	bytes.set(
		[
			(width >>> 24) & 0xff,
			(width >>> 16) & 0xff,
			(width >>> 8) & 0xff,
			width & 0xff,
		],
		16,
	);
	bytes.set(
		[
			(height >>> 24) & 0xff,
			(height >>> 16) & 0xff,
			(height >>> 8) & 0xff,
			height & 0xff,
		],
		20,
	);
	bytes.set([0x08, 0x06, 0x00, 0x00, 0x00], 24);
	return bytes;
}

const PAGE = utf8(`<!doctype html><html><head>
	<title>Example article</title>
	<meta property="og:title" content="Example article">
	<meta property="og:description" content="A description">
	<meta property="og:site_name" content="Example">
</head><body>words</body></html>`);

/** A service whose transport answers from a `route` map keyed by pathname. */
async function service(route, options = {}) {
	const hops = [];
	const looks = [];
	const logs = [];
	const cache = mod.createLinkPreviewCache({
		directory: await mkdtemp(join(tmpdir(), "link-preview-fetch-")),
	});
	const instance = mod.createLinkPreviewService({
		cache,
		lookup: async (hostname) => {
			looks.push(hostname);
			return [{ address: "93.184.216.34", family: 4 }];
		},
		hop: async (request) => {
			hops.push(request.url.toString());
			const answer = route[request.url.pathname] ?? {
				status: 404,
				location: null,
				contentType: null,
				body: new Uint8Array(),
				truncated: false,
			};
			return options.delay === undefined
				? answer
				: new Promise((resolve) =>
						setTimeout(() => resolve(answer), options.delay),
					);
		},
		log: (line) => logs.push(line),
	});
	return { instance, hops, looks, logs, cache };
}

test("a JSON body labelled text/html is not-html, and a PDF labelled as itself is content-type", async () => {
	const json = await service({
		"/json": {
			status: 200,
			location: null,
			contentType: "text/html",
			body: utf8('{"a":1}'),
			truncated: false,
		},
	});
	const jsonResult = await json.instance.resolve({
		url: "https://example.com/json",
		index: 0,
	});
	assert.deepEqual(jsonResult, { kind: "absent", reason: "not-html" });

	const pdf = await service({
		"/pdf": {
			status: 200,
			location: null,
			contentType: "application/pdf",
			body: utf8("%PDF-1.7\n"),
			truncated: false,
		},
	});
	const pdfResult = await pdf.instance.resolve({
		url: "https://example.com/pdf",
		index: 0,
	});
	assert.deepEqual(pdfResult, { kind: "absent", reason: "content-type" });
});

test("the sniff decides the image artifact, not the declared type", async () => {
	const accepted = await service({
		"/page": {
			status: 200,
			location: null,
			contentType: "text/html",
			body: utf8(
				`<!doctype html><html><head><title>t</title><meta property="og:image" content="/card.png"></head></html>`,
			),
			truncated: false,
		},
		// A PNG served as text/plain is still a picture: the bytes say so.
		"/card.png": {
			status: 200,
			location: null,
			contentType: "text/plain",
			body: pngHeader(1200, 630),
			truncated: false,
		},
		"/favicon.ico": {
			status: 404,
			location: null,
			contentType: null,
			body: new Uint8Array(),
			truncated: false,
		},
	});
	const result = await accepted.instance.resolve({
		url: "https://example.com/page",
		index: 0,
	});
	assert.equal(result.kind, "ready");
	assert.equal(result.preview.image?.mime, "image/png");
	assert.equal(result.preview.image?.width, 1200);
	assert.equal(result.preview.image?.height, 630);

	const refused = await service({
		"/page": {
			status: 200,
			location: null,
			contentType: "text/html",
			body: utf8(
				`<!doctype html><html><head><title>t</title><meta property="og:image" content="/fake.png"></head></html>`,
			),
			truncated: false,
		},
		// An HTML document served as image/png is NOT a picture.
		"/fake.png": {
			status: 200,
			location: null,
			contentType: "image/png",
			body: utf8("<!doctype html><html><body>not an image</body></html>"),
			truncated: false,
		},
		"/favicon.ico": {
			status: 404,
			location: null,
			contentType: null,
			body: new Uint8Array(),
			truncated: false,
		},
	});
	const refusedResult = await refused.instance.resolve({
		url: "https://example.com/page",
		index: 0,
	});
	assert.equal(refusedResult.kind, "ready");
	assert.equal(refusedResult.preview.image, null);
});

test("a page with nothing to say is no-metadata; an over-cap body is too-large", async () => {
	const quiet = await service({
		"/quiet": {
			status: 200,
			location: null,
			contentType: "text/html",
			body: utf8("<!doctype html><html><head></head><body>x</body></html>"),
			truncated: false,
		},
	});
	assert.deepEqual(
		await quiet.instance.resolve({
			url: "https://example.com/quiet",
			index: 0,
		}),
		{
			kind: "absent",
			reason: "no-metadata",
		},
	);

	const big = await service({
		"/big": {
			status: 200,
			location: null,
			contentType: "text/html",
			body: PAGE,
			truncated: true,
		},
	});
	assert.deepEqual(
		await big.instance.resolve({ url: "https://example.com/big", index: 0 }),
		{
			kind: "absent",
			reason: "too-large",
		},
	);
});

test("the per-message cap refuses index 3 with no fetch and no lookup", async () => {
	const { instance, hops, looks } = await service({});
	for (const index of [3, 4, 99]) {
		const result = await instance.resolve({
			url: "https://example.com/",
			index,
		});
		assert.deepEqual(
			result,
			{ kind: "absent", reason: "cap" },
			`index ${index}`,
		);
	}
	assert.deepEqual(hops, []);
	assert.deepEqual(looks, []);
});

test("N concurrent resolves of one page share one exchange", async () => {
	const { instance, hops } = await service(
		{
			"/shared": {
				status: 200,
				location: null,
				contentType: "text/html",
				body: PAGE,
				truncated: false,
			},
			"/favicon.ico": {
				status: 404,
				location: null,
				contentType: null,
				body: new Uint8Array(),
				truncated: false,
			},
		},
		{ delay: 25 },
	);
	const results = await Promise.all([
		instance.resolve({ url: "https://example.com/shared", index: 0 }),
		instance.resolve({ url: "https://example.com/shared", index: 1 }),
		instance.resolve({
			url: "https://example.com/shared?utm_source=x",
			index: 2,
		}),
	]);
	for (const result of results) assert.equal(result.kind, "ready");
	const pageHops = hops.filter((hop) => hop.endsWith("/shared"));
	assert.equal(
		pageHops.length,
		1,
		`one page fetch for three cards, saw ${JSON.stringify(hops)}`,
	);
});
