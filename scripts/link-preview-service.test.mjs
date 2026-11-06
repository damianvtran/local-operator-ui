import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The link-preview proxy's DECISIONS, driven with a transport double.
 *
 * Why a bundle rather than a source import. The shipped TypeScript is the thing
 * under test, and these cases must run without a build step on a loaded machine
 * (the repo's other main-process tests bundle in memory for the same reason).
 * `service.ts` imports no Electron and no `fetch`, which is exactly what makes it
 * drivable here — and is also the property the last case asserts against the
 * source itself: nothing under `src/main/link-preview/` may reach a remote origin.
 */
const bundle = await build({
	stdin: {
		contents: "export * from './src/main/link-preview/service';",
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	createLinkPreviewService,
	isResolveRequest,
	isArtifactRequest,
	mapResolution,
} = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);

/*
 * Assembled rather than written out, so no case in this file carries a literal
 * origin: the redaction the app applies to its own diagnostics starts here, in
 * the fixtures, and a test that spells a URL would be the one place a reviewer
 * could not tell whether a refusal leaked one.
 */
const ORIGIN = ["ht", "tps", "://", "example", ".test"].join("");
const REQUEST_URL = `${ORIGIN}/article?q=preview`;

const FAVICON_ID = "0123456789abcdef0123456789abcdef";
const IMAGE_ID = "fedcba9876543210fedcba9876543210";
const ACCOUNT = "acc_01HZZZZZZZZZZZZZZZZZZZZZZZ";

/** A transport that records every call and answers from a queue. */
function transportFor(answers) {
	const calls = [];
	return {
		calls,
		transport: {
			async request(input) {
				calls.push({ kind: "request", input });
				const next = answers.request.shift();
				if (next instanceof Error) throw next;
				return next;
			},
			async media(input) {
				calls.push({ kind: "media", input });
				const next = answers.media.shift();
				if (next instanceof Error) throw next;
				return next;
			},
		},
	};
}

/** A cache double that records what the service asked it to forget. */
function cacheDouble(codes = {}) {
	const dropped = [];
	const stored = [];
	return {
		dropped,
		stored,
		cache: {
			async read() {
				return codes.hit ?? null;
			},
			async store(id, mime, bytes) {
				stored.push({ id, mime, size: bytes.byteLength });
			},
			async drop(ids) {
				dropped.push([...ids]);
			},
		},
	};
}

function serviceWith(answers, codes) {
	const { transport, calls } = transportFor(answers);
	const cache = cacheDouble(codes);
	return {
		calls,
		dropped: cache.dropped,
		stored: cache.stored,
		service: createLinkPreviewService({ transport, cache: cache.cache }),
	};
}

const READY_BODY = {
	status: 200,
	message: "ok",
	result: {
		kind: "ready",
		preview: {
			url: REQUEST_URL,
			title: "A title",
			siteName: "Example",
			favicon: { id: FAVICON_ID, mime: "image/png" },
			image: { id: IMAGE_ID, mime: "image/jpeg", width: 1200, height: 630 },
		},
	},
};

test("resolve refuses a malformed request before a socket is opened", async () => {
	const { service, calls } = serviceWith({ request: [], media: [] });
	const bad = [
		{ url: REQUEST_URL, index: 0 },
		{ url: "", index: 0, expectedAccountId: ACCOUNT },
		{ url: REQUEST_URL, index: -1, expectedAccountId: ACCOUNT },
		{ url: REQUEST_URL, index: 1.5, expectedAccountId: ACCOUNT },
		{ url: 12, index: 0, expectedAccountId: ACCOUNT },
		null,
	];
	for (const request of bad) {
		assert.deepEqual(await service.resolve(request), {
			kind: "absent",
			reason: "unsupported-scheme",
		});
	}
	assert.equal(
		calls.length,
		0,
		"no request may leave main for a refused input",
	);
});

test("a 429 is a retry state with the delay core asked for", async () => {
	const { service } = serviceWith({
		request: [
			{
				status: 429,
				body: {
					detail: {
						code: "rate_limited",
						message: "too many",
						retryable: true,
						retry_after_seconds: 2.5,
					},
				},
			},
			{
				status: 429,
				body: { detail: { code: "rate_limited", retryable: true } },
			},
		],
		media: [],
	});
	const request = { url: REQUEST_URL, index: 0, expectedAccountId: ACCOUNT };
	assert.deepEqual(await service.resolve(request), {
		kind: "error",
		retryable: true,
		retryAfterMs: 2500,
	});
	// A 429 with no usable number is still retryable, just without a delay.
	assert.deepEqual(await service.resolve(request), {
		kind: "error",
		retryable: true,
	});
});

test("a refusal a retry cannot change is not advertised as retryable", async () => {
	const { service } = serviceWith({
		request: [
			{ status: 409, body: { detail: { code: "account_mismatch" } } },
			{ status: 401, body: { detail: { code: "sign_in_required" } } },
			{ status: 503, body: null },
			new Error("transport exploded"),
		],
		media: [],
	});
	const request = { url: REQUEST_URL, index: 0, expectedAccountId: ACCOUNT };
	for (const expected of [
		{ kind: "error", retryable: false },
		{ kind: "error", retryable: false },
		{ kind: "error", retryable: true },
		{ kind: "error", retryable: true },
	]) {
		assert.deepEqual(await service.resolve(request), expected);
	}
});

test("a ready answer maps onto the renderer contract unchanged", async () => {
	const { service } = serviceWith({
		request: [{ status: 200, body: READY_BODY }],
		media: [],
	});
	const result = await service.resolve({
		url: REQUEST_URL,
		index: 0,
		expectedAccountId: ACCOUNT,
	});
	assert.deepEqual(result, {
		kind: "ready",
		preview: {
			url: REQUEST_URL,
			title: "A title",
			// Core omits an absent field; the contract declares one spelling of
			// absence, and it is `null`.
			description: null,
			siteName: "Example",
			favicon: { id: FAVICON_ID, mime: "image/png" },
			image: { id: IMAGE_ID, mime: "image/jpeg", width: 1200, height: 630 },
		},
	});
});

test("an absent, a disabled and an error answer become the union's states", () => {
	assert.deepEqual(mapResolution({ kind: "absent", reason: "disabled" }), {
		kind: "absent",
		reason: "disabled",
	});
	assert.deepEqual(mapResolution({ kind: "absent", reason: "not-html" }), {
		kind: "absent",
		reason: "not-html",
	});
	// A reason from a newer core draws nothing rather than inventing a remedy.
	assert.deepEqual(mapResolution({ kind: "absent", reason: "brand-new" }), {
		kind: "absent",
		reason: "no-metadata",
	});
	assert.deepEqual(mapResolution({ kind: "error", retryable: false }), {
		kind: "error",
		retryable: false,
	});
	assert.deepEqual(mapResolution(undefined), {
		kind: "error",
		retryable: true,
	});
	// A "ready" with no drawable card is a shape this build cannot use.
	assert.deepEqual(mapResolution({ kind: "ready", preview: {} }), {
		kind: "error",
		retryable: true,
	});
});

test("disabled drops the artifacts that preview was holding", async () => {
	const { service, dropped } = serviceWith({
		request: [
			{ status: 200, body: READY_BODY },
			{ status: 200, body: { result: { kind: "absent", reason: "disabled" } } },
		],
		media: [],
	});
	const request = { url: REQUEST_URL, index: 0, expectedAccountId: ACCOUNT };
	assert.equal((await service.resolve(request)).kind, "ready");
	assert.deepEqual(dropped, [], "a ready answer drops nothing");
	assert.deepEqual(await service.resolve(request), {
		kind: "absent",
		reason: "disabled",
	});
	assert.deepEqual(
		dropped,
		[[FAVICON_ID, IMAGE_ID]],
		"the operator's own kill switch must not leave drawable bytes behind",
	);
});

test("a plain absence drops that preview's artifacts too", async () => {
	const { service, dropped } = serviceWith({
		request: [
			{ status: 200, body: READY_BODY },
			{
				status: 200,
				body: { result: { kind: "absent", reason: "no-metadata" } },
			},
		],
		media: [],
	});
	const request = { url: REQUEST_URL, index: 0, expectedAccountId: ACCOUNT };
	await service.resolve(request);
	await service.resolve(request);
	assert.deepEqual(dropped, [[FAVICON_ID, IMAGE_ID]]);
});

test("an absence for a link that never resolved drops nothing", async () => {
	const { service, dropped } = serviceWith({
		request: [
			{ status: 200, body: { result: { kind: "absent", reason: "disabled" } } },
		],
		media: [],
	});
	await service.resolve({
		url: REQUEST_URL,
		index: 0,
		expectedAccountId: ACCOUNT,
	});
	assert.deepEqual(dropped, []);
});

test("a re-resolve after a drop records the fresh ids", async () => {
	const { service, dropped } = serviceWith({
		request: [
			{ status: 200, body: READY_BODY },
			{ status: 200, body: { result: { kind: "absent", reason: "disabled" } } },
			{ status: 200, body: READY_BODY },
			{ status: 200, body: { result: { kind: "absent", reason: "disabled" } } },
		],
		media: [],
	});
	const request = { url: REQUEST_URL, index: 0, expectedAccountId: ACCOUNT };
	await service.resolve(request);
	await service.resolve(request);
	await service.resolve(request);
	await service.resolve(request);
	assert.deepEqual(dropped, [
		[FAVICON_ID, IMAGE_ID],
		[FAVICON_ID, IMAGE_ID],
	]);
});

test("artifact refuses an id that could not be a path or a filename", async () => {
	const { service, calls } = serviceWith({ request: [], media: [] });
	for (const request of [
		{ id: "not-an-id", expectedAccountId: ACCOUNT },
		{ id: IMAGE_ID.toUpperCase(), expectedAccountId: ACCOUNT },
		{ id: `${IMAGE_ID}/../x`, expectedAccountId: ACCOUNT },
		{ id: IMAGE_ID },
		null,
	]) {
		assert.deepEqual(await service.artifact(request), {
			kind: "error",
			code: "invalid-request",
			status: 400,
		});
	}
	assert.equal(calls.length, 0);
});

test("artifact serves cached bytes without touching the transport", async () => {
	const bytes = new Uint8Array([1, 2, 3]);
	const { service, calls } = serviceWith(
		{ request: [], media: [] },
		{ hit: { mime: "image/png", bytes } },
	);
	const result = await service.artifact({
		id: IMAGE_ID,
		expectedAccountId: ACCOUNT,
	});
	assert.deepEqual(result, {
		kind: "bytes",
		data: bytes,
		mimeType: "image/png",
	});
	assert.equal(calls.length, 0);
});

test("artifact fetches on a miss, then stores what it was served", async () => {
	const bytes = new Uint8Array([9, 9]);
	const { service, calls, stored } = serviceWith({
		request: [],
		media: [
			{ status: 200, kind: "bytes", mimeType: "image/webp", data: bytes },
		],
	});
	const result = await service.artifact({
		id: IMAGE_ID,
		expectedAccountId: ACCOUNT,
	});
	assert.deepEqual(result, {
		kind: "bytes",
		data: bytes,
		mimeType: "image/webp",
	});
	assert.deepEqual(stored, [{ id: IMAGE_ID, mime: "image/webp", size: 2 }]);
	// The account receipt travels as the request's own field, which the media
	// transport turns into the `X-Link-Preview-Account` header.
	assert.deepEqual(calls[0].input, {
		op: "team_bridge.link_preview.artifact",
		id: IMAGE_ID,
		expectedAccountId: ACCOUNT,
	});
});

test("artifact maps core's 404 and 422 to the coded errors the card reads", async () => {
	const { service } = serviceWith({
		request: [],
		media: [
			{ status: 404, kind: "error", detail: "nope" },
			{ status: 422, kind: "error", detail: "malformed" },
			{ status: 503, kind: "error", detail: "no daemon" },
			new Error("transport exploded"),
		],
	});
	const request = { id: IMAGE_ID, expectedAccountId: ACCOUNT };
	assert.deepEqual(await service.artifact(request), {
		kind: "error",
		code: "not-found",
		status: 404,
	});
	assert.deepEqual(await service.artifact(request), {
		kind: "error",
		code: "invalid-request",
		status: 422,
	});
	assert.deepEqual(await service.artifact(request), {
		kind: "error",
		code: "io",
		status: 503,
	});
	assert.deepEqual(await service.artifact(request), {
		kind: "error",
		code: "io",
		status: 503,
	});
});

test("validation accepts exactly what the routes accept", () => {
	assert.equal(
		isResolveRequest({
			url: REQUEST_URL,
			index: 0,
			expectedAccountId: ACCOUNT,
		}),
		true,
	);
	// `index` has no upper bound on purpose: past the cap is the `cap` answer.
	assert.equal(
		isResolveRequest({
			url: REQUEST_URL,
			index: 4000,
			expectedAccountId: ACCOUNT,
		}),
		true,
	);
	assert.equal(
		isArtifactRequest({ id: IMAGE_ID, expectedAccountId: ACCOUNT }),
		true,
	);
	assert.equal(
		isArtifactRequest({ id: IMAGE_ID, expectedAccountId: "" }),
		false,
	);
});

test("no refusal or error this module emits carries the URL", async () => {
	const { service } = serviceWith({
		request: [
			{
				status: 200,
				body: { result: { kind: "absent", reason: "blocked-host" } },
			},
			{ status: 500, body: null },
			{ status: 429, body: { detail: { retry_after_seconds: 1 } } },
			{ status: 409, body: { detail: { code: "account_mismatch" } } },
		],
		media: [
			{ status: 404, kind: "error", detail: "nope" },
			{ status: 503, kind: "error", detail: "no daemon" },
		],
	});
	const request = { url: REQUEST_URL, index: 0, expectedAccountId: ACCOUNT };
	const answers = [
		await service.resolve(request),
		await service.resolve(request),
		await service.resolve(request),
		await service.resolve(request),
		await service.artifact({ id: IMAGE_ID, expectedAccountId: ACCOUNT }),
		await service.artifact({ id: IMAGE_ID, expectedAccountId: ACCOUNT }),
	];
	for (const answer of answers) {
		const serialized = JSON.stringify(answer);
		assert.ok(
			!serialized.includes("example") &&
				!serialized.includes("q=preview") &&
				!serialized.includes("://"),
			`a refusal must name no page: ${serialized}`,
		);
	}
});

test("nothing under src/main/link-preview fetches a third-party origin", async () => {
	const { readFile, readdir } = await import("node:fs/promises");
	const root = "src/main/link-preview";
	const names = await readdir(root);
	assert.ok(names.length >= 3);
	const scheme = ["ht", "tps?\\", ":"].join("");
	for (const name of names) {
		if (!name.endsWith(".ts")) continue;
		const source = (await readFile(`${root}/${name}`, "utf8"))
			// Strip comments: this directory's own docstrings talk ABOUT the fetch
			// path it removed, and a scan that read prose would fail on its own
			// documentation.
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "");
		// The only network call this directory may ever make is the app's own
		// desktop transport, which lives outside it. A `fetch(` here would be a
		// second egress path - the exact thing the rebuild removed.
		assert.ok(!/\bfetch\s*\(/.test(source), `${name} must not call fetch`);
		assert.ok(
			!new RegExp(`${scheme}//`).test(source),
			`${name} must not name a remote origin`,
		);
	}
});
