import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Bundle the renderer transport in memory, the same way the main-process
// contract test does, so this guard runs the shipped TS rather than a copy.
// The module is renderer code, so `window` is the only global it needs.
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/api/local-operator/desktop-api";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	write: false,
});
const source = bundle.outputFiles[0].text;

/**
 * Import a fresh copy of the transport with `window.api.desktop.request` bound
 * to `request`. A fresh copy per test keeps the module-level deadline constant
 * from leaking timer state between cases.
 */
async function loadTransport(request) {
	globalThis.window = { api: { desktop: { request } } };
	return import(
		`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Math.random()}`
	);
}

// Issue 89: `/v1/config` was accepted and never answered, so the IPC promise
// never settled. React Query's `retry` cannot help -- retry needs a settled
// rejection -- so `isConfigLoading` stayed true and Settings showed a spinner
// with no recovery. The contract this pins is that a desktop control which
// never settles becomes a REJECTION within the deadline, because only a
// rejection can reach an error state a user can act on.
test("a desktop control that never settles rejects instead of pending forever", async () => {
	const { desktopRequest, DesktopControlError } = await loadTransport(
		// The exact issue-89 fault: accepted, never answered, never rejected.
		() => new Promise(() => {}),
	);

	const started = Date.now();
	const outcome = await Promise.race([
		desktopRequest({ op: "config.get" }).then(
			(value) => ({ settled: value }),
			(error) => ({ error }),
		),
		// Longer than the transport's own 30s deadline, so a transport that
		// never bounds the request fails this test by timing out here instead
		// of hanging the run.
		new Promise((resolve) =>
			setTimeout(() => resolve({ pending: true }), 45000),
		),
	]);

	assert.ok(
		!outcome.pending,
		"desktopRequest never settled: the request is unbounded and Settings would spin forever",
	);
	assert.ok(
		outcome.error instanceof DesktopControlError,
		"a stalled control must reject as DesktopControlError so callers reach an error state",
	);
	// `null` is the transport's stated "no backend was reached" status. The
	// compatibility banner and the providers grid both read exactly this field
	// to say "not answering" rather than "needs an update".
	assert.equal(outcome.error.status, null);
	assert.ok(Date.now() - started < 45000);
});

// The deadline must not truncate a slow-but-working backend into a false
// failure, so a control that answers is passed through untouched.
test("a desktop control that answers is returned unchanged", async () => {
	const { desktopRequest } = await loadTransport(async () => ({
		status: 200,
		body: { result: { hosting: "openai" } },
	}));

	assert.deepEqual(await desktopRequest({ op: "config.get" }), {
		status: 200,
		body: { result: { hosting: "openai" } },
	});
});

test("structured profile repair conflict retains its category and actionable text", async () => {
	const message = "Choose an available profile or detach it before sending.";
	const { desktopResult, DesktopControlError } = await loadTransport(
		async () => ({
			status: 409,
			body: { detail: { code: "unresolved_attachment", message } },
		}),
	);
	await assert.rejects(
		desktopResult({
			op: "sessions.message",
			sessionId: "111111111111",
			requestId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
			text: "retained draft",
		}),
		(error) =>
			error instanceof DesktopControlError &&
			error.status === 409 &&
			error.code === "unresolved_attachment" &&
			error.message === message,
	);
});

// The image ladder is renderer code with no transport of its own, but it is the
// reason a message fits: without it, an 8.5 MB Retina screenshot fails at any
// budget this pipe can offer. It is bundled and driven here rather than mocked,
// with `createImageBitmap`/`OffscreenCanvas` backed by a REAL codec (sharp, an
// existing dependency) so the scaling arithmetic, the codec choice and the
// keep-only-if-smaller rule are measured against actual encoded bytes.
//
// What this does NOT prove: Chromium's own canvas. sharp and Chromium are
// different encoders and will not produce byte-identical output, so the sizes
// below are the app's DECISIONS about real images, not a promise about the
// exact bytes a browser emits. The rendered evidence covers that surface.
const sharp = (await import("sharp")).default;
const imageBundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/utils/bound-image"; export * from "./src/renderer/src/features/chat/utils/message-budget";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	write: false,
});

/**
 * A real PNG shaped like an app screenshot: flat sidebar and titlebar panels, a
 * light canvas, dense antialiased text rows, and a low-amplitude dither.
 *
 * The shape matters. Synthetic noise compresses nothing like a screenshot and
 * GROWS when resampled, which would make the ladder look broken; a flat fill
 * compresses to nothing and would make every size assertion vacuous. This
 * fixture reproduces the property the ladder exists for - most of the bytes are
 * in high-frequency detail that survives a 2.8x downscale only in proportion.
 */
async function screenshotPng(width, height) {
	const pixels = Buffer.alloc(width * height * 3);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const index = (y * width + x) * 3;
			let value = x < width * 0.18 ? 38 : y < height * 0.06 ? 26 : 247;
			if (x >= width * 0.2 && x < width * 0.94 && y > height * 0.08) {
				const row = ((y - height * 0.08) / 22) | 0;
				const inRow = (y - height * 0.08) % 22;
				if (inRow < 13 && (x * 7919 + row * 104729) % 11 < 6)
					value = 40 + ((x * 31 + y * 17) % 90);
			}
			value = Math.max(0, Math.min(255, value + ((x * 13 + y * 7) % 5) - 2));
			pixels[index] = value;
			pixels[index + 1] = value;
			pixels[index + 2] = Math.min(255, value + 3);
		}
	}
	return sharp(pixels, { raw: { width, height, channels: 3 } })
		.png()
		.toBuffer();
}

async function loadImageBounding() {
	globalThis.createImageBitmap = async (blob) => {
		const bytes = Buffer.from(await blob.arrayBuffer());
		const meta = await sharp(bytes).metadata();
		return {
			width: meta.width,
			height: meta.height,
			__bytes: bytes,
			close() {},
		};
	};
	globalThis.OffscreenCanvas = class {
		constructor(width, height) {
			this.width = width;
			this.height = height;
		}
		getContext() {
			return {
				drawImage: (bitmap, _x, _y, width, height) => {
					this.__source = bitmap.__bytes;
					this.width = width;
					this.height = height;
				},
			};
		}
		async convertToBlob({ type, quality }) {
			const pipeline = sharp(this.__source).resize(this.width, this.height);
			const bytes =
				type === "image/jpeg"
					? await pipeline
							.jpeg({ quality: Math.round((quality ?? 0.85) * 100) })
							.toBuffer()
					: await pipeline.png().toBuffer();
			return new Blob([bytes], { type });
		}
	};
	return import(
		`data:text/javascript;base64,${Buffer.from(imageBundle.outputFiles[0].text).toString("base64")}#${Math.random()}`
	);
}

test("an oversize screenshot is bounded to the TUI's edge and shrinks enough to send", async () => {
	const { boundImageForWire, base64ByteLength, IMAGE_MAX_EDGE } =
		await loadImageBounding();
	// A Retina screenshot's shape. Before this ladder existed these bytes went to
	// the wire verbatim, which is why one attachment refused a whole message.
	const original = {
		data_b64: (await screenshotPng(2880, 1800)).toString("base64"),
		mime_type: "image/png",
	};
	const before = base64ByteLength(original.data_b64);
	const bounded = await boundImageForWire(original);
	const after = base64ByteLength(bounded.data_b64);

	assert.ok(after < before, `bounding must shrink: ${before} -> ${after}`);
	// 1024 is IMAGE_INGEST_MAX_EDGE at local_operator/imaging.py:154. The two
	// surfaces feed the same session, so they bound to the same number.
	assert.equal(IMAGE_MAX_EDGE, 1024);
	const meta = await sharp(Buffer.from(bounded.data_b64, "base64")).metadata();
	assert.equal(Math.max(meta.width, meta.height), IMAGE_MAX_EDGE);
});

test("an image already within bounds is forwarded byte-for-byte, never re-encoded", async () => {
	const { boundImageForWire } = await loadImageBounding();
	// Re-encoding is lossy and PNG round-tripping routinely GROWS a file, so an
	// in-bounds image must come back identical rather than merely similar.
	const original = {
		data_b64: (await screenshotPng(800, 600)).toString("base64"),
		mime_type: "image/png",
	};
	assert.deepEqual(await boundImageForWire(original), original);
});

test("an animated GIF is exempt, because a canvas re-encode would flatten it", async () => {
	const { boundImageForWire } = await loadImageBounding();
	const gif = { data_b64: "R0lGODlhAQABAAAAACw=", mime_type: "image/gif" };
	assert.deepEqual(await boundImageForWire(gif), gif);
});

test("several bounded screenshots that still overflow step the whole set down until the message fits", async () => {
	const { boundImagesForBudget, messageBodyBytes } = await loadImageBounding();
	// Five screenshots and a long message - the operator's actual failing send.
	// Each is legal on its own after bounding; collectively they are not, which
	// is a case no per-image rule can see.
	const source = (await screenshotPng(2880, 1800)).toString("base64");
	const images = Array.from({ length: 5 }, () => ({
		data_b64: source,
		mime_type: "image/png",
	}));
	const text = "word ".repeat(1500);
	const budget = 880000;
	const measure = (candidate) => messageBodyBytes(text, candidate);

	assert.ok(
		measure(images) > budget,
		"the unbounded payload must be over budget or this test proves nothing",
	);
	const fitted = await boundImagesForBudget(images, budget, measure);
	assert.equal(fitted.length, images.length, "no attachment is silently shed");
	assert.ok(
		measure(fitted) <= budget,
		`the ladder must land under budget, got ${measure(fitted)}`,
	);
});

test("the refusal copy names the real sizes and the remedy that matches the overflow", async () => {
	const { messageBudgetRefusal, formatByteSize } = await loadImageBounding();
	// Sizes a person reads, per docs/branding.md: whole KB below 1 MB, one
	// decimal above. No exception text, no status code, sentence case.
	assert.equal(formatByteSize(880000), "880 KB");
	assert.equal(formatByteSize(2400000), "2.4 MB");

	assert.equal(messageBudgetRefusal("a short message", []), null);

	// Three schema-legal attachments, because the sentence has to be true of a
	// payload the schema would actually accept.
	const images = Array.from({ length: 3 }, () => ({
		data_b64: "A".repeat(800000),
		mime_type: "image/png",
	}));
	const overImages = messageBudgetRefusal("a short message", images);
	assert.match(
		overImages,
		/^These images total 2\.4 MB, more than the 880 KB one message can carry\. Remove an image, or send them in a second message\.$/,
	);

	const overText = messageBudgetRefusal("x".repeat(1100000), []);
	assert.match(
		overText,
		/^This message is 1\.1 MB of text, more than the 880 KB one message can carry\. Split it across two messages\.$/,
	);
	// The two sentences differ because the remedies differ: images can go in a
	// second message, text has to be split.
	assert.ok(!overImages.includes("Split it"));
	assert.ok(!overText.includes("Remove an image"));
});
