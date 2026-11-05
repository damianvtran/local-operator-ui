/**
 * The resolve path under caps: redirects, sniffing, dedupe and the card cap.
 *
 * WHAT IS REAL HERE. The whole decision chain in `resolve.ts`, driven through a
 * stub transport that speaks the `Hop` contract (`http-transport.ts`): the redirect
 * guard, the sniff-over-header rule, the "too large" refusal, the in-flight
 * dedupe, the per-message cap and the fetch queue. Every hop is counted, so "no
 * fetch happened" is an assertion.
 *
 * THE SOCKET IS HERE TOO, in one test: the wall clock is a property of the REAL
 * transport (an idle timer is exactly what it replaced), so the drip it has to
 * refuse is driven against `nodeHop` and a local server that drips a byte at a
 * time. Everything else about the socket is exercised by driving the app.
 */

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import * as http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bundleMainModules } from "./link-preview-bundle.mjs";

const mod = await import(
	await bundleMainModules("link-preview-fetch", [
		"src/main/link-preview/resolve.ts",
		"src/main/link-preview/cache.ts",
		"src/main/link-preview/http-transport.ts",
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
		now: options.now,
	});
	const instance = mod.createLinkPreviewService({
		cache,
		now: options.now,
		maxConcurrent: options.maxConcurrent,
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

const NOT_FOUND = {
	status: 404,
	location: null,
	contentType: null,
	body: new Uint8Array(),
	truncated: false,
};

const OK = (body) => ({
	status: 200,
	contentType: "text/html",
	location: null,
	body,
	truncated: false,
});

/** A clock the test moves by hand, so a TTL can be crossed without waiting. */
function clock() {
	let now = 1_000_000;
	return {
		now: () => now,
		advance: (ms) => {
			now += ms;
		},
	};
}

test("a retryable error is re-fetched once its short TTL expires", async () => {
	const clocked = clock();
	const flapping = await service(
		{
			"/flap": {
				status: 503,
				location: null,
				contentType: null,
				body: new Uint8Array(),
				truncated: false,
			},
		},
		{ now: clocked.now },
	);

	// A 503 is retryable: the contract says so.
	assert.deepEqual(
		await flapping.instance.resolve({
			url: "https://example.com/flap",
			index: 0,
		}),
		{ kind: "error", retryable: true },
	);
	assert.equal(flapping.hops.length, 1);

	// Inside the short TTL the negative cache still holds, so a scrolling transcript
	// does not re-fetch a flapping network once per card.
	clocked.advance(30 * 1000);
	assert.deepEqual(
		await flapping.instance.resolve({
			url: "https://example.com/flap",
			index: 0,
		}),
		{ kind: "error", retryable: true },
	);
	assert.equal(flapping.hops.length, 1, "thirty seconds is still cached");

	// Past it, the retry the contract advertises actually reaches the network.
	clocked.advance(31 * 1000);
	assert.deepEqual(
		await flapping.instance.resolve({
			url: "https://example.com/flap",
			index: 0,
		}),
		{ kind: "error", retryable: true },
	);
	assert.equal(
		flapping.hops.length,
		2,
		"the retry was not answered from the cache",
	);
});

test("concurrent resolves are capped, and the queue drains", async () => {
	const cache = mod.createLinkPreviewCache({
		directory: await mkdtemp(join(tmpdir(), "link-preview-cap-")),
	});
	let inFlight = 0;
	let peak = 0;
	const instance = mod.createLinkPreviewService({
		cache,
		maxConcurrent: 2,
		lookup: async () => [{ address: "93.184.216.34", family: 4 }],
		hop: async (request) => {
			if (!request.url.pathname.startsWith("/p")) return NOT_FOUND;
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 20));
			inFlight -= 1;
			return OK(PAGE);
		},
	});

	const results = await Promise.all(
		[1, 2, 3, 4, 5, 6].map((n) =>
			instance.resolve({ url: `https://example.com/p${n}`, index: 0 }),
		),
	);
	for (const result of results) assert.equal(result.kind, "ready");
	assert.ok(peak <= 2, `at most two page fetches at once, saw ${peak}`);
	assert.equal(peak, 2, "the queue still ran two at a time");
});

test("a resolve that waits past its budget is refused without fetching", async () => {
	const clocked = clock();
	let release = () => {};
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const hops = [];
	const instance = mod.createLinkPreviewService({
		cache: mod.createLinkPreviewCache({
			directory: await mkdtemp(join(tmpdir(), "link-preview-queue-")),
			now: clocked.now,
		}),
		now: clocked.now,
		maxConcurrent: 1,
		lookup: async () => [{ address: "93.184.216.34", family: 4 }],
		hop: async (request) => {
			hops.push(request.url.pathname);
			if (request.url.pathname === "/slow") {
				await gate;
				return OK(PAGE);
			}
			return NOT_FOUND;
		},
	});

	const first = instance.resolve({ url: "https://example.com/slow", index: 0 });
	// Let the first resolve reach its hop, so the second really is queued.
	await new Promise((resolve) => setTimeout(resolve, 20));
	const second = instance.resolve({
		url: "https://example.com/queued",
		index: 1,
	});
	clocked.advance(5000);
	release();

	const [served, refused] = await Promise.all([first, second]);
	assert.equal(served.kind, "ready");
	assert.deepEqual(refused, { kind: "error", retryable: true });
	assert.ok(
		!hops.includes("/queued"),
		`the queued resolve must not fetch after its budget: ${JSON.stringify(hops)}`,
	);
});

test("a redirect that drops TLS is refused, for the page and for an artifact", async () => {
	const page = await service({
		"/secure": {
			status: 302,
			location: "http://example.com/plain",
			contentType: null,
			body: new Uint8Array(),
			truncated: false,
		},
		"/plain": OK(PAGE),
	});
	assert.deepEqual(
		await page.instance.resolve({
			url: "https://example.com/secure",
			index: 0,
		}),
		{ kind: "error", retryable: false },
	);
	assert.deepEqual(
		page.hops,
		["https://example.com/secure"],
		"no plaintext hop",
	);

	const artifact = await service({
		"/card": OK(
			utf8(
				`<!doctype html><html><head><title>t</title><meta property="og:image" content="https://example.com/pic.png"></head></html>`,
			),
		),
		"/pic.png": {
			status: 302,
			location: "http://example.com/pic.png",
			contentType: null,
			body: new Uint8Array(),
			truncated: false,
		},
		"/favicon.ico": NOT_FOUND,
	});
	const card = await artifact.instance.resolve({
		url: "http://example.com/card",
		index: 0,
	});
	assert.equal(card.kind, "ready");
	assert.equal(
		card.preview.image,
		null,
		"the downgraded artifact is simply absent",
	);
	assert.ok(
		!artifact.hops.includes("http://example.com/pic.png"),
		`the downgraded hop was never attempted: ${JSON.stringify(artifact.hops)}`,
	);
});

test("image serves only the artifact kind that was asked for", async () => {
	const { instance } = await service({
		"/card": OK(
			utf8(
				`<!doctype html><html><head><title>t</title>
				<meta property="og:image" content="/pic.png">
				<link rel="icon" href="/fav.ico"></head></html>`,
			),
		),
		"/pic.png": {
			status: 200,
			location: null,
			contentType: "image/png",
			body: pngHeader(1200, 630),
			truncated: false,
		},
		"/fav.ico": {
			status: 200,
			location: null,
			contentType: "image/x-icon",
			body: new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]),
			truncated: false,
		},
	});
	const card = await instance.resolve({
		url: "https://example.com/card",
		index: 0,
	});
	assert.equal(card.kind, "ready");
	const image = card.preview.image;
	const favicon = card.preview.favicon;
	assert.ok(image !== null && favicon !== null);

	const served = await instance.image({ previewId: image.id, which: "image" });
	assert.equal(served.kind, "bytes");
	assert.equal(served.mimeType, "image/png");
	const servedIcon = await instance.image({
		previewId: favicon.id,
		which: "favicon",
	});
	assert.equal(servedIcon.kind, "bytes");
	assert.equal(servedIcon.mimeType, "image/x-icon");

	// The kind is not decoration: the wrong one is a stated 404, not the wrong bytes.
	assert.deepEqual(
		await instance.image({ previewId: image.id, which: "favicon" }),
		{ kind: "error", code: "not-found", status: 404 },
	);
	assert.deepEqual(
		await instance.image({ previewId: favicon.id, which: "image" }),
		{ kind: "error", code: "not-found", status: 404 },
	);
});

test(
	"a server that drips one byte at a time cannot outlive the hop's wall clock",
	{ timeout: 8000 },
	async () => {
		// The finding this pins: `outgoing.setTimeout` is an IDLE timer, so a server
		// sending one byte every 39 ms reset it for ever and the resolve never settled.
		let sent = 0;
		const server = http.createServer((_request, response) => {
			response.writeHead(200, { "content-type": "text/html" });
			response.write("<");
			sent += 1;
			const drip = setInterval(() => {
				response.write("x");
				sent += 1;
			}, 40);
			response.on("close", () => clearInterval(drip));
		});
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		assert.ok(address !== null && typeof address === "object");

		const started = Date.now();
		let settledWith = null;
		try {
			await mod.nodeHop({
				url: new URL(`http://127.0.0.1:${address.port}/drip`),
				address: "127.0.0.1",
				family: 4,
				timeoutMs: 250,
				maxBytes: 1024 * 1024,
			});
			settledWith = "a body";
		} catch (error) {
			settledWith = error instanceof Error ? error.message : String(error);
		} finally {
			const elapsed = Date.now() - started;
			server.closeAllConnections?.();
			await new Promise((resolve) => server.close(resolve));

			assert.equal(
				settledWith,
				"timeout",
				`refused by the clock, not ${settledWith}`,
			);
			assert.ok(
				elapsed >= 200,
				`settled in ${elapsed}ms, before the 250 ms budget it was given`,
			);
			assert.ok(
				elapsed < 2000,
				`settled in ${elapsed}ms after ${sent} dripped bytes, not the ~250 ms its budget allowed`,
			);
		}
	},
);
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

test(
	"the whole resolve is bounded by the wall clock even if the transport never answers",
	{ timeout: 15000 },
	async () => {
		// The transport enforces the wall clock itself, but the budget belongs to the
		// resolve: a hop that never settles must not leave the card (and the renderer's
		// promise) open for ever. This drives the real service with a stuck transport.
		let hopsSeen = 0;
		const instance = mod.createLinkPreviewService({
			cache: mod.createLinkPreviewCache({
				directory: await mkdtemp(join(tmpdir(), "link-preview-stuck-")),
			}),
			lookup: async () => [{ address: "93.184.216.34", family: 4 }],
			hop: () => {
				hopsSeen += 1;
				return new Promise(() => {});
			},
		});

		const started = Date.now();
		const result = await instance.resolve({
			url: "https://example.com/stuck",
			index: 0,
		});
		const elapsed = Date.now() - started;

		assert.equal(hopsSeen, 1);
		assert.deepEqual(result, { kind: "error", retryable: true });
		assert.ok(
			elapsed < 6000,
			`settled after ${elapsed}ms, not the preview's ~4s budget`,
		);
	},
);
