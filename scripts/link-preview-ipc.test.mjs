/**
 * The IPC surface: the two channels, the sender gate, and what a malformed or
 * hostile message can and cannot reach.
 *
 * WHAT IS REAL HERE. The shipped `ipc-handlers.ts`, the real service
 * (`resolve.ts` + `cache.ts`) behind it, and a recording `ipcMain` double in place
 * of Electron's. Every hop is counted, so "no fetch happened" is an assertion
 * rather than a reading of the code.
 *
 * WHY THE GATE IS INJECTED. `isAdmittedSender` is the app-wide rule in
 * `desktop-ipc.ts`, shared with every other main-owned surface and covered where
 * it lives; what this module owes is that it CONSULTS it and refuses with the same
 * shape a refusal uses. `admitted: () => false` is what exercises that here.
 *
 * WHAT IS NOT HERE. Electron itself. Importing `ipc.ts` evaluates the app's
 * logger, which creates and writes the operator's log directory on import - the
 * reason the handlers live in their own module in the first place.
 */

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bundleMainModules } from "./link-preview-bundle.mjs";

const mod = await import(
	await bundleMainModules("link-preview-ipc", [
		"src/main/link-preview/ipc-handlers.ts",
		"src/main/link-preview/resolve.ts",
		"src/main/link-preview/cache.ts",
		"src/shared/link-preview.ts",
	])
);

const utf8 = (text) => new TextEncoder().encode(text);

/** A dotted-quad, so the stub resolver can echo an IP literal back the way
 * `dns.lookup` does instead of replacing it with a public address. */
const IPV4_LITERAL = /^\d+\.\d+\.\d+\.\d+$/;

const PAGE = utf8(
	'<!doctype html><html><head><title>IPC page</title><meta property="og:image" content="/pic.png"></head><body>words</body></html>',
);

/** A PNG header: enough for the sniff and the IHDR dimension read. */
function pngBytes() {
	const bytes = new Uint8Array(29);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	bytes.set([0x00, 0x00, 0x04, 0xb0], 16);
	bytes.set([0x00, 0x00, 0x02, 0x76], 20);
	bytes.set([0x08, 0x06, 0x00, 0x00, 0x00], 24);
	return bytes;
}

const NOT_FOUND = {
	status: 404,
	location: null,
	contentType: null,
	body: new Uint8Array(),
	truncated: false,
};

/**
 * An `ipcMain` that records what was registered and lets a test invoke a channel.
 *
 * It throws on a duplicate channel, exactly as Electron's `handle` does, because
 * that is the behaviour `registerLinkPreviewHandlers` has to survive.
 */
function ipcMainDouble() {
	const channels = new Map();
	return {
		channels,
		registered: () => [...channels.keys()],
		handle(channel, listener) {
			if (channels.has(channel)) {
				throw new Error(`duplicate handler for ${channel}`);
			}
			channels.set(channel, listener);
		},
		removeHandler(channel) {
			channels.delete(channel);
		},
		invoke(channel, request) {
			const listener = channels.get(channel);
			assert.ok(listener !== undefined, `${channel} has a handler`);
			return listener(
				{ sender: "renderer", senderFrame: { url: "app://local-operator" } },
				request,
			);
		},
	};
}

/**
 * The shipped service over a counting stub transport, with the shipped handlers on
 * top and a recording `ipcMain` beneath them.
 *
 * `admitted` defaults to yes; a test that wants the refusal passes
 * `admitted: () => false`, which is the only thing this module decides about the
 * gate.
 */
async function harness(options = {}) {
	const hops = [];
	const cache = mod.createLinkPreviewCache({
		directory: await mkdtemp(join(tmpdir(), "link-preview-ipc-")),
	});
	const service = mod.createLinkPreviewService({
		cache,
		// `dns.lookup` answers an IP literal with itself; the stub does the same, or
		// the SSRF table never sees the address the caller asked about.
		lookup: async (hostname) => [
			{
				address: IPV4_LITERAL.test(hostname) ? hostname : "93.184.216.34",
				family: 4,
			},
		],
		hop: async (request) => {
			hops.push(request.url.toString());
			if (request.url.pathname === "/page") {
				return {
					status: 200,
					location: null,
					contentType: "text/html",
					body: PAGE,
					truncated: false,
				};
			}
			if (request.url.pathname === "/pic.png") {
				return {
					status: 200,
					location: null,
					contentType: "image/png",
					body: pngBytes(),
					truncated: false,
				};
			}
			return NOT_FOUND;
		},
	});
	const ipc = ipcMainDouble();
	mod.registerLinkPreviewHandlers(
		ipc,
		mod.createLinkPreviewHandlers({
			service,
			admitted: options.admitted ?? (() => true),
		}),
	);
	return { ipc, cache, hops };
}

test("the channel names are the ones the preload invokes", () => {
	// The cross-lane contract: the preload imports these two and the UI lane reads
	// `window.api.linkPreview`. A rename that lands in one place and not the other
	// fails here rather than in a renderer.
	assert.equal(mod.LINK_PREVIEW_RESOLVE_CHANNEL, "link-preview:resolve");
	assert.equal(mod.LINK_PREVIEW_IMAGE_CHANNEL, "link-preview:image");
});

test("a refused sender is refused with the shape a refusal uses", async () => {
	const { ipc, hops } = await harness({ admitted: () => false });
	assert.deepEqual(
		await ipc.invoke(mod.LINK_PREVIEW_RESOLVE_CHANNEL, {
			url: "https://example.com/page",
			index: 0,
		}),
		{ kind: "absent", reason: "unsupported-scheme" },
	);
	assert.deepEqual(
		await ipc.invoke(mod.LINK_PREVIEW_IMAGE_CHANNEL, {
			previewId: "a".repeat(32),
			which: "image",
		}),
		{ kind: "error", code: "invalid-request", status: 400 },
	);
	assert.deepEqual(hops, [], "a refused sender costs no network");
});

test("a malformed request never reaches the service", async () => {
	const { ipc, hops } = await harness();
	for (const request of [
		undefined,
		null,
		{},
		{ url: 5, index: 0 },
		{ url: "https://example.com/page" },
		{ url: "https://example.com/page", index: "0" },
	]) {
		assert.deepEqual(
			await ipc.invoke(mod.LINK_PREVIEW_RESOLVE_CHANNEL, request),
			{ kind: "absent", reason: "unsupported-scheme" },
			`resolve ${JSON.stringify(request)}`,
		);
	}
	for (const request of [
		undefined,
		null,
		{},
		{ previewId: "a".repeat(32) },
		{ previewId: "a".repeat(32), which: "screenshot" },
		{ previewId: 42, which: "image" },
	]) {
		assert.deepEqual(
			await ipc.invoke(mod.LINK_PREVIEW_IMAGE_CHANNEL, request),
			{ kind: "error", code: "invalid-request", status: 400 },
			`image ${JSON.stringify(request)}`,
		);
	}
	assert.deepEqual(hops, []);
});

test("an index at or past the message cap is refused with no fetch", async () => {
	const { ipc, hops } = await harness();
	for (const index of [3, 4, 100, -1, 1.5, Number.NaN]) {
		assert.deepEqual(
			await ipc.invoke(mod.LINK_PREVIEW_RESOLVE_CHANNEL, {
				url: "https://example.com/page",
				index,
			}),
			{ kind: "absent", reason: "cap" },
			`index ${index}`,
		);
	}
	assert.deepEqual(hops, []);
});

test("a hostile payload cannot reach a path on disk or a port on this machine", async () => {
	const { ipc, hops } = await harness();

	// A traversal that would name a file if any handler joined it to a directory.
	for (const previewId of [
		"../../../../etc/passwd",
		"..%2f..%2fetc%2fpasswd",
		"a".repeat(31),
		"a".repeat(33),
		"A".repeat(32),
	]) {
		assert.deepEqual(
			await ipc.invoke(mod.LINK_PREVIEW_IMAGE_CHANNEL, {
				previewId,
				which: "image",
			}),
			{ kind: "error", code: "invalid-request", status: 400 },
			`previewId ${previewId}`,
		);
	}
	// A well-formed id that names nothing is a refusal, not a read.
	assert.deepEqual(
		await ipc.invoke(mod.LINK_PREVIEW_IMAGE_CHANNEL, {
			previewId: "0123456789abcdef0123456789abcdef",
			which: "image",
		}),
		{ kind: "error", code: "not-found", status: 404 },
	);

	// A URL that is not a public http(s) page is refused before any socket.
	for (const [url, reason] of [
		["file:///etc/passwd", "unsupported-scheme"],
		["javascript:alert(1)", "unsupported-scheme"],
		["http://127.0.0.1:9222/json", "local-or-private"],
		["http://169.254.169.254/latest/meta-data/", "local-or-private"],
		["http://10.0.0.1/admin", "local-or-private"],
		["http://someone:pw@example.com/", "blocked-host"],
	]) {
		assert.deepEqual(
			await ipc.invoke(mod.LINK_PREVIEW_RESOLVE_CHANNEL, { url, index: 0 }),
			{ kind: "absent", reason },
			url,
		);
	}
	assert.deepEqual(hops, [], "none of these reached the transport");
});

test("the handler answers a real resolve and serves its artifact", async () => {
	const { ipc, hops } = await harness();
	const result = await ipc.invoke(mod.LINK_PREVIEW_RESOLVE_CHANNEL, {
		url: "https://example.com/page",
		index: 0,
	});
	assert.equal(result.kind, "ready");
	assert.equal(result.preview.title, "IPC page");
	assert.ok(result.preview.image !== null, "the card carries an image id");
	assert.ok(hops.includes("https://example.com/page"));

	const served = await ipc.invoke(mod.LINK_PREVIEW_IMAGE_CHANNEL, {
		previewId: result.preview.image.id,
		which: "image",
	});
	assert.equal(served.kind, "bytes");
	assert.equal(served.mimeType, "image/png");
});

test("a service that throws still answers a state, never a rejection", async () => {
	const ipc = ipcMainDouble();
	mod.registerLinkPreviewHandlers(
		ipc,
		mod.createLinkPreviewHandlers({
			service: {
				resolve: async () => {
					throw new Error("boom");
				},
				image: async () => {
					throw new Error("boom");
				},
			},
			admitted: () => true,
		}),
	);
	assert.deepEqual(
		await ipc.invoke(mod.LINK_PREVIEW_RESOLVE_CHANNEL, {
			url: "https://example.com/page",
			index: 0,
		}),
		{ kind: "error", retryable: true },
	);
	assert.deepEqual(
		await ipc.invoke(mod.LINK_PREVIEW_IMAGE_CHANNEL, {
			previewId: "a".repeat(32),
			which: "image",
		}),
		{ kind: "error", code: "io", status: 500 },
	);
});

test("registering twice leaves one handler per channel", async () => {
	const { ipc } = await harness();
	const handlers = mod.createLinkPreviewHandlers({
		service: {
			resolve: async () => ({ kind: "absent", reason: "cap" }),
			image: async () => ({ kind: "error", code: "not-found", status: 404 }),
		},
		admitted: () => true,
	});
	// `ipcMain.handle` throws for a channel that already has a handler, so this is
	// only possible because the registration removes first.
	mod.registerLinkPreviewHandlers(ipc, handlers);
	assert.deepEqual(ipc.registered(), [
		mod.LINK_PREVIEW_RESOLVE_CHANNEL,
		mod.LINK_PREVIEW_IMAGE_CHANNEL,
	]);
	assert.deepEqual(
		await ipc.invoke(mod.LINK_PREVIEW_RESOLVE_CHANNEL, {
			url: "https://example.com/page",
			index: 0,
		}),
		{ kind: "absent", reason: "cap" },
	);
});
