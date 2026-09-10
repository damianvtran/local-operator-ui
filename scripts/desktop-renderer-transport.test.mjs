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
	// Models the two canvas behaviours that decide whether a transparent PNG
	// survives the JPEG rung, because a mock that omits them cannot see the
	// class of bug where it goes black:
	//
	//   1. A fresh backing store is rgba(0,0,0,0) - transparent BLACK, not white.
	//   2. JPEG has no alpha channel, so encoding flattens every pixel against
	//      whatever RGB sits underneath it.
	//
	// `fillStyle`/`fillRect` are therefore real here rather than no-ops: they are
	// what the JPEG rung uses to put white under the image, and a mock that
	// silently ignored them would report a passing flatten that never happened.
	globalThis.OffscreenCanvas = class {
		constructor(width, height) {
			this.width = width;
			this.height = height;
			this.__fill = null;
			this.__pendingFill = null;
		}
		getContext() {
			const canvas = this;
			return {
				set fillStyle(value) {
					canvas.__pendingFill = value;
				},
				get fillStyle() {
					return canvas.__pendingFill;
				},
				// Only a whole-canvas fill is modelled; that is all the ladder does.
				fillRect: () => {
					canvas.__fill = canvas.__pendingFill;
				},
				drawImage: (bitmap, _x, _y, width, height) => {
					canvas.__source = bitmap.__bytes;
					canvas.width = width;
					canvas.height = height;
				},
			};
		}
		async convertToBlob({ type, quality }) {
			let pipeline = sharp(this.__source).resize(this.width, this.height);
			if (type === "image/jpeg") {
				// Flatten onto the backing store: the fill when one was applied,
				// transparent black otherwise.
				pipeline = pipeline.flatten({ background: this.__fill ?? "#000000" });
				const bytes = await pipeline
					.jpeg({ quality: Math.round((quality ?? 0.85) * 100) })
					.toBuffer();
				return new Blob([bytes], { type });
			}
			if (this.__fill)
				pipeline = pipeline.flatten({ background: this.__fill });
			const bytes = await pipeline.png().toBuffer();
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

/**
 * A macOS window screenshot: opaque detailed content inside a margin that
 * stays transparent, the way Cmd-Shift-4 + Space captures rounded corners and
 * a drop shadow. RGBA, and the transparent margin is what the JPEG rung has to
 * flatten onto WHITE rather than the canvas's transparent black.
 */
async function windowShotPng(width, height, margin) {
	const pixels = Buffer.alloc(width * height * 4, 0);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const index = (y * width + x) * 4;
			const inside =
				x >= margin &&
				x < width - margin &&
				y >= margin &&
				y < height - margin;
			if (!inside) continue;
			// Detailed content so PNG cannot win the candidate race and the JPEG
			// rung is genuinely exercised.
			const noise = ((x * 7 + y * 13) % 61) - 30;
			pixels[index] = 200 + noise;
			pixels[index + 1] = 205 + noise;
			pixels[index + 2] = 212 + noise;
			pixels[index + 3] = 255;
		}
	}
	return sharp(pixels, { raw: { width, height, channels: 4 } })
		.png()
		.toBuffer();
}

test("a transparent screenshot re-encoded to JPEG flattens onto white, not black", async () => {
	const { boundImageForWire } = await loadImageBounding();
	// The macOS window paste this ladder exists to support. Forced onto the
	// JPEG rung the way the overflow ladder forces it.
	const png = await windowShotPng(1400, 1000, 40);
	const bounded = await boundImageForWire(
		{ data_b64: png.toString("base64"), mime_type: "image/png" },
		512,
		0.6,
	);
	assert.equal(
		bounded.mime_type,
		"image/jpeg",
		"fixture must reach the JPEG rung or this test proves nothing",
	);
	const { data, info } = await sharp(Buffer.from(bounded.data_b64, "base64"))
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const pixel = (x, y) => {
		const index = (y * info.width + x) * info.channels;
		return [data[index], data[index + 1], data[index + 2]];
	};
	// A fresh canvas is transparent BLACK, so an unflattened encode returns 0
	// here and the user's screenshot arrives with black corners.
	assert.ok(
		pixel(2, 2)[0] > 200,
		`the transparent margin must flatten to white, got ${pixel(2, 2)}`,
	);
	assert.ok(
		pixel(Math.floor(info.width / 2), Math.floor(info.height / 2))[0] > 140,
		"opaque content must survive the flatten",
	);
});

test("a PNG that stays on the PNG rung keeps its transparency", async () => {
	const { boundImageForWire } = await loadImageBounding();
	// The flatten must be confined to the JPEG rung: PNG carries alpha, and
	// flattening it there would destroy transparency the wire can represent.
	const png = await windowShotPng(300, 200, 20);
	const bounded = await boundImageForWire({
		data_b64: png.toString("base64"),
		mime_type: "image/png",
	});
	if (bounded.mime_type !== "image/png") return;
	const meta = await sharp(Buffer.from(bounded.data_b64, "base64")).metadata();
	assert.ok(meta.hasAlpha, "the PNG rung must not flatten alpha away");
});

test("bounding never returns an image larger than the one it was given", async () => {
	const { boundImageForWire, base64ByteLength } = await loadImageBounding();
	// An already-compressed photo over the edge limit: the downscaled PNG
	// re-encode routinely exceeds the source JPEG, and a larger payload can push
	// an otherwise-sendable message into refusal.
	for (const [width, height, quality] of [
		[1400, 1000, 55],
		[1200, 1024, 40],
		[1300, 980, 50],
	]) {
		const source = await sharp(await screenshotPng(width, height))
			.jpeg({ quality })
			.toBuffer();
		const bounded = await boundImageForWire({
			data_b64: source.toString("base64"),
			mime_type: "image/jpeg",
		});
		assert.ok(
			base64ByteLength(bounded.data_b64) <= source.byteLength,
			`${width}x${height} q${quality} grew: ${source.byteLength} -> ${base64ByteLength(bounded.data_b64)}`,
		);
	}
});

test("a set of images that already fits is never made larger by the ladder", async () => {
	const { boundImagesForBudget, messageBodyBytes } = await loadImageBounding();
	// Modest photos that fit as pasted. An exhausted ladder used to return its
	// LAST rung rather than the smallest set seen, which could hand back
	// something bigger than the input - and so refuse a message that would have
	// sent.
	const images = [];
	for (let index = 0; index < 6; index += 1) {
		const source = await sharp(await screenshotPng(1100 + index * 40, 900))
			.jpeg({ quality: 50 })
			.toBuffer();
		images.push({
			data_b64: source.toString("base64"),
			mime_type: "image/jpeg",
		});
	}
	const text = "word ".repeat(50);
	const measure = (candidate) => messageBodyBytes(text, candidate);
	const budget = Math.floor(measure(images) * 1.05);
	const fitted = await boundImagesForBudget(images, budget, measure);
	assert.ok(
		measure(fitted) <= measure(images),
		`the ladder returned a larger set: ${measure(images)} -> ${measure(fitted)}`,
	);
	assert.ok(
		measure(fitted) <= budget,
		"a set that already fit must still fit afterwards",
	);
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

	// A BYTE-budget text overflow, which is a different fact from a character-cap
	// overflow and gets a different sentence. Reaching it needs text that is
	// heavy in bytes while still legal by character count: a C0 control escapes
	// to a 6-byte `\uXXXX` sequence, so 200,000 NULs is ~1.2 MB of body inside a
	// 200,000-character cap. (Text that is merely LONG hits the character cap
	// first - see the next test - which is why "x".repeat(1_100_000) no longer
	// reaches this branch.)
	const overText = messageBudgetRefusal("\u0000".repeat(200_000), []);
	assert.match(
		overText,
		/^This message is 1\.2 MB of text, more than the 880 KB one message can carry\. Split it across two messages\.$/,
	);
	// The two sentences differ because the remedies differ: images can go in a
	// second message, text has to be split.
	assert.ok(!overImages.includes("Split it"));
	assert.ok(!overText.includes("Remove an image"));
});

test("an over-long paste is refused in characters, the unit the schema caps", async () => {
	const { messageBudgetRefusal } = await loadImageBounding();
	// The gap this closes: the schema caps `text` at 200,000 CHARACTERS while the
	// pre-flight weighed only bytes, so an ASCII paste between 200,001 chars and
	// the byte budget passed pre-flight and died in main's `safeParse` as a 422
	// "Invalid desktop operation." - which then latched the draft, because the
	// un-latch was keyed on 413 alone (round 1, Q-2 / R1).
	assert.equal(messageBudgetRefusal("x".repeat(200_000), []), null);
	const refusal = messageBudgetRefusal("x".repeat(200_001), []);
	assert.ok(refusal, "one character past the schema cap must be refused locally");
	// Characters, because that is the ceiling that binds - naming bytes here
	// would tell the user to shed 0 KB from a message that is only 200 KB.
	assert.match(
		refusal,
		/^This message is 200,001 characters, more than the 200,000 one message can carry\. Split it across two messages\.$/,
	);
	// A plain long paste is the reachable case: a pasted log is well under the
	// byte budget and still over the character cap.
	assert.match(
		messageBudgetRefusal("x".repeat(400_000), []),
		/^This message is 400,000 characters, more than the 200,000 one message can carry\. Split it across two messages\.$/,
	);
});

test("a text-dominant overflow says to split the text even when an image is attached", async () => {
	const { messageBudgetRefusal } = await loadImageBounding();
	// Attributing every overflow to the images because there is at least one
	// produced advice that cannot work: "These images total 0 KB ... Remove an
	// image" saves nothing when the text is what does not fit.
	const thumbnail = [{ data_b64: "A".repeat(120), mime_type: "image/png" }];
	const refusal = messageBudgetRefusal("x".repeat(950_000), thumbnail);
	assert.ok(
		refusal.includes("Split it across two messages"),
		`text-dominant overflow must advise splitting, got: ${refusal}`,
	);
	assert.ok(!refusal.includes("Remove an image"));
	assert.ok(!refusal.includes("0 KB"), "never advise removing 0 KB of images");
});

test("formatByteSize never prints a KB value that should have rounded to 1 MB", async () => {
	const { formatByteSize } = await loadImageBounding();
	// `Math.round(999500 / 1000)` is 1000, so the KB branch used to print
	// "1000 KB" - a unit that appears nowhere else, in the refusal sentence's
	// only number.
	assert.equal(formatByteSize(999_499), "999 KB");
	assert.equal(formatByteSize(999_500), "1.0 MB");
	assert.equal(formatByteSize(1_000_000), "1.0 MB");
	for (let bytes = 990_000; bytes < 1_010_000; bytes += 137)
		assert.ok(
			!formatByteSize(bytes).startsWith("1000 "),
			`${bytes} rendered as ${formatByteSize(bytes)}`,
		);
});

test("an oversize slash command is refused before admission, like a message", async () => {
	const { commandBudgetRefusal } = await loadImageBounding();
	// `sessions.command` shares the message budget and its `args` field accepts
	// 200,000 characters, but nothing weighed it before admission.
	assert.equal(commandBudgetRefusal("login", "openai"), null);
	const refusal = commandBudgetRefusal("login", "x".repeat(900_000));
	assert.ok(refusal, "an over-budget command must be refused locally");
	assert.ok(
		!/\b(413|error|exception)\b/i.test(refusal),
		`the sentence must name no status code: ${refusal}`,
	);
	assert.ok(
		refusal.includes("one command can carry"),
		`the sentence must be about a command: ${refusal}`,
	);
});
