import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
 * The shared contract itself, for the copy that is chosen per op.
 *
 * Bundled separately from `imageBundle` because it is main-process/shared code
 * with no renderer canvas involved, and driving it through the image bundle
 * would tie an assertion about a sentence to whether sharp is installed.
 */
let contractBundle;
async function loadDesktopContract() {
	contractBundle ??= await build({
		stdin: {
			contents: 'export * from "./src/shared/desktop-contract";',
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "neutral",
		mainFields: ["module", "main"],
		conditions: ["import"],
		write: false,
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(contractBundle.outputFiles[0].text).toString("base64")}#${Math.random()}`
	);
}

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
			if (this.__fill) pipeline = pipeline.flatten({ background: this.__fill });
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

/**
 * A real animated GIF89a with `frames` frames, hand-encoded.
 *
 * Hand-encoded because sharp 0.33.5 cannot JOIN frames, so the repo's own
 * generator emits a single-frame GIF - against which "the ladder does not
 * flatten an animation" is not a property any test could observe. A refactor of
 * the `RE_ENCODABLE` exemption would have destroyed every animation and passed
 * CI (round 2). Each frame is a flat 2-colour square, alternating, which is all
 * the property needs: what matters is that N frames go in and N come out.
 *
 * The LZW stream is the trivial one - clear code, one literal per pixel, EOI -
 * at a 3-bit code width, which is legal for a 2-entry palette and avoids
 * needing a real compressor here.
 */
function animatedGif(frames, size = 4) {
	const bytes = [];
	const push = (...values) => bytes.push(...values);
	push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // "GIF89a"
	push(size, 0x00, size, 0x00); // logical screen size
	push(0xf0, 0x00, 0x00); // global colour table, 2 entries
	push(0x00, 0x00, 0x00, 0xff, 0xff, 0xff); // black, white
	// NETSCAPE2.0 application extension: loop forever. Present because it is
	// what makes decoders report this as an ANIMATION rather than a still.
	push(
		0x21,
		0xff,
		0x0b,
		0x4e,
		0x45,
		0x54,
		0x53,
		0x43,
		0x41,
		0x50,
		0x45,
		0x32,
		0x2e,
		0x30,
		0x03,
		0x01,
		0x00,
		0x00,
		0x00,
	);
	for (let frame = 0; frame < frames; frame += 1) {
		push(0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00); // 100 ms delay
		push(0x2c, 0x00, 0x00, 0x00, 0x00, size, 0x00, size, 0x00, 0x00);
		const colour = frame % 2;
		push(0x02); // LZW minimum code size
		const clearCode = 4;
		const endCode = 5;
		const width = 3;
		let register = 0;
		let held = 0;
		const stream = [];
		const emit = (code) => {
			register |= code << held;
			held += width;
			while (held >= 8) {
				stream.push(register & 0xff);
				register >>= 8;
				held -= 8;
			}
		};
		emit(clearCode);
		for (let pixel = 0; pixel < size * size; pixel += 1) emit(colour);
		emit(endCode);
		if (held) stream.push(register & 0xff);
		for (let at = 0; at < stream.length; at += 255) {
			const chunk = stream.slice(at, at + 255);
			push(chunk.length, ...chunk);
		}
		push(0x00); // block terminator
	}
	push(0x3b); // trailer
	return Buffer.from(bytes);
}

test("an animated GIF is exempt, because a canvas re-encode would flatten it", async () => {
	const { boundImageForWire } = await loadImageBounding();
	const gif = { data_b64: "R0lGODlhAQABAAAAACw=", mime_type: "image/gif" };
	assert.deepEqual(await boundImageForWire(gif), gif);
});

test("a multi-frame GIF keeps every frame, at the tightest rung", async () => {
	const { boundImageForWire } = await loadImageBounding();
	// The exemption is only worth having if it preserves the ANIMATION, and the
	// test above cannot see that: its fixture is a single 1x1 frame, so a
	// refactor that dropped GIF from `RE_ENCODABLE` would flatten every
	// animation to one frame and still pass. This asserts the property itself.
	// What makes this test able to FAIL is the explicit `(64, 0.5)` tightest-rung
	// arguments below, NOT the fixture's pixel size. Measured across all four
	// cells under a mutant that drops GIF from `RE_ENCODABLE`: at DEFAULT
	// parameters it survives at both 4px and 320px (the re-encode is bigger than
	// the original, so the never-grow guard hands the original back and the
	// animation survives for a reason unrelated to the exemption); at `(64, 0.5)`
	// it dies at both, collapsing 8 frames into a single still - 112 bytes at
	// 320px, 90 bytes at 4px. The larger fixture is kept because it is a more
	// honest stand-in for a real animation, but do not read it as load-bearing:
	// shrinking it while keeping the arguments would NOT break this test, and a
	// reader who removed the arguments instead would silently lose the kill
	// (round 3, Q-3).
	const gif = animatedGif(8, 320);
	const before = await sharp(gif, { animated: true }).metadata();
	assert.equal(before.pages, 8, "the fixture itself must be an animation");
	// The tightest rung, so no argument can be made that the ladder was simply
	// not reached: a re-encode here would return a single 64px still.
	const bounded = await boundImageForWire(
		{ data_b64: gif.toString("base64"), mime_type: "image/gif" },
		64,
		0.5,
	);
	assert.equal(bounded.mime_type, "image/gif");
	const after = await sharp(Buffer.from(bounded.data_b64, "base64"), {
		animated: true,
	}).metadata();
	assert.equal(after.pages, 8, "every frame must survive the ladder");
	assert.deepEqual(after.delay, before.delay, "frame timing must survive too");
});

/**
 * A macOS window screenshot: opaque detailed content inside a margin that
 * stays transparent, the way Cmd-Shift-4 + Space captures rounded corners and
 * a drop shadow. RGBA, and the transparent margin is what the JPEG rung has to
 * flatten onto WHITE rather than the canvas's transparent black.
 *
 * The interior carries the same dense antialiased text rows as `screenshotPng`
 * and sits at a MID-TONE, and both properties are load-bearing rather than
 * decoration:
 *
 *   - Dense detail is what makes a downscaled PNG genuinely SMALLER than the
 *     source. A smooth interior compresses so well that the re-encode grows,
 *     the never-grow guard hands the original straight back, and a test on the
 *     result is then asserting on its own input (round 2, M1).
 *   - A mid-tone interior is what makes "the content survived" distinguishable
 *     from "everything was flattened to white". A near-white interior passes a
 *     brightness assertion whether the flatten was correctly confined to the
 *     transparent margin or wrongly applied to the whole image.
 */
async function windowShotPng(width, height, margin) {
	const pixels = Buffer.alloc(width * height * 4, 0);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const index = (y * width + x) * 4;
			const inside =
				x >= margin && x < width - margin && y >= margin && y < height - margin;
			if (!inside) continue;
			// Detailed content so PNG cannot win the candidate race and the JPEG
			// rung is genuinely exercised.
			let value = 140 + (((x * 7 + y * 13) % 61) - 30);
			const row = ((y - margin) / 22) | 0;
			const inRow = (y - margin) % 22;
			if (inRow < 13 && (x * 7919 + row * 104729) % 11 < 6)
				value = 60 + ((x * 31 + y * 17) % 90);
			pixels[index] = Math.max(0, Math.min(255, value));
			pixels[index + 1] = Math.max(0, Math.min(255, value + 5));
			pixels[index + 2] = Math.max(0, Math.min(255, value + 12));
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
	// Compared against the SOURCE centre rather than against a brightness floor.
	// A floor cannot tell "the opaque content survived" from "the whole image was
	// flattened to white", because white passes any floor - so a mutant that
	// filled the shared canvas, destroying the image, would satisfy it. The
	// fixture's interior is a mid-tone precisely so the two answers are far apart.
	const source = await sharp(png)
		.resize(info.width, info.height)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const centre = (buffer, meta) => {
		const index =
			(Math.floor(meta.height / 2) * meta.width + Math.floor(meta.width / 2)) *
			meta.channels;
		return [buffer[index], buffer[index + 1], buffer[index + 2]];
	};
	const got = centre(data, info);
	const want = centre(source.data, source.info);
	// 40/255 absorbs JPEG q0.6 plus a 2.7x downscale; a white flatten would put
	// this channel at 255, more than 100 away from the mid-tone source.
	assert.ok(
		Math.abs(got[0] - want[0]) < 40,
		`opaque content must survive the flatten: got ${got}, source ${want}`,
	);
});

test("a PNG that stays on the PNG rung keeps its transparency", async () => {
	const { boundImageForWire } = await loadImageBounding();
	// The flatten must be confined to the JPEG rung: PNG carries alpha, and
	// flattening it there would destroy transparency the wire can represent.
	//
	// The fixture is OVERSIZE and the assertions below check that it was actually
	// RE-ENCODED, because this test previously used a 300x200 image that took the
	// verbatim passthrough - no canvas was ever constructed and the output was
	// byte-identical to the input, so it asserted `hasAlpha` on its own fixture.
	// A mutant that filled the SHARED canvas white, destroying alpha on every
	// rung, survived it silently (round 2, M1).
	const png = await windowShotPng(2000, 1400, 60);
	const input = { data_b64: png.toString("base64"), mime_type: "image/png" };
	const bounded = await boundImageForWire(input, 512);
	assert.equal(
		bounded.mime_type,
		"image/png",
		"fixture must stay on the PNG rung or this test proves nothing",
	);
	assert.notEqual(
		bounded.data_b64,
		input.data_b64,
		"fixture must be re-encoded, not passed through: asserting on the input proves nothing",
	);
	const decoded = Buffer.from(bounded.data_b64, "base64");
	const meta = await sharp(decoded).metadata();
	assert.ok(meta.hasAlpha, "the PNG rung must not flatten alpha away");
	assert.ok(
		meta.width <= 512 && meta.height <= 512,
		`re-encode must have gone through the resize, got ${meta.width}x${meta.height}`,
	);
	// `hasAlpha` only says a channel exists; a white fill would keep the channel
	// and set every pixel opaque. The transparent margin must still be
	// TRANSPARENT for the flatten to have been confined to the JPEG rung.
	const { data, info } = await sharp(decoded)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
	assert.equal(
		alphaAt(2, 2),
		0,
		"the transparent margin must stay transparent on the PNG rung",
	);
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

test("the ladder returns the smallest set BY THE MEASURE IT WAS GIVEN, not the last rung", async () => {
	const { boundImagesForBudget } = await loadImageBounding();
	// `best`-as-minimum is a DEFENSIVE invariant, and testing it needs a rung
	// that actually inflates. Against real bytes none does - the rungs descend in
	// both edge and quality and the per-image never-grow guard caps each one at
	// its original - so `best = stepped` per rung is behaviourally EQUIVALENT to
	// the shipped code on every real image, and no fixture of real photographs
	// can distinguish them (measured: 150 randomised trials, 0 differences,
	// against a positive control that differed in 44).
	//
	// The contract is nonetheless "the smallest set by the caller's measure",
	// because `measure` is supplied by the caller - only it knows the true wire
	// cost, and a future envelope could price a smaller image higher (a rung that
	// switches PNG to JPEG changes the mime string's length too). So the
	// condition is injected through the one seam that admits it, which is what
	// makes the invariant testable rather than merely asserted in a comment.
	const images = [
		{
			data_b64: (await screenshotPng(1600, 1200)).toString("base64"),
			mime_type: "image/png",
		},
	];
	const seen = [];
	// Non-monotonic in raw size: the SMALLEST candidates are priced highest, so
	// the tightest rung the ladder ends on is the worst answer by this measure
	// and an earlier one is the true minimum.
	// The threshold must sit ABOVE the tightest rung's real output or the pricing
	// never fires and the measure stays monotonic - at which point this test
	// passes against the mutant too, which is the exact vacuity being repaired.
	// The assertion below fails loudly if that ever stops holding.
	const measure = (candidate) => {
		const raw = candidate.reduce((n, i) => n + i.data_b64.length, 0);
		const priced = raw < 100_000 ? 5_000_000 + raw : raw;
		seen.push(priced);
		return priced;
	};
	// Unreachable, so the ladder exhausts and must fall back to `best`.
	const fitted = await boundImagesForBudget(images, 1_000, measure);
	const best = Math.min(...seen);
	// The pricing must actually have inverted the ordering, or the measure is
	// monotonic and this test cannot tell the minimum from the last rung.
	assert.ok(
		seen.at(-1) > best,
		`the fixture must price the LAST rung above the minimum, got last=${seen.at(-1)} min=${best}`,
	);
	assert.equal(
		measure(fitted),
		best,
		`an exhausted ladder must return the minimum it saw (${best}), not the last rung`,
	);
});

test("the overflow ladder returns the smallest set it saw, never the last rung", async () => {
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
	// BELOW the originals, so the overflow ladder is entered and the
	// `best`-as-minimum logic this test names actually runs. With a budget ABOVE
	// the originals `boundImagesForBudget` returned at its first fit check before
	// the ladder loop, and a mutant that assigned `best = stepped` per rung -
	// the exact F3 regression - survived silently (round 2, M1).
	const budget = Math.floor(measure(images) * 0.5);
	const fitted = await boundImagesForBudget(images, budget, measure);
	assert.ok(
		measure(fitted) <= measure(images),
		`the ladder returned a larger set: ${measure(images)} -> ${measure(fitted)}`,
	);
	// The other half of the property, which moving the budget to 0.5 above left
	// uncovered: a set that ALREADY FITS must be handed back no larger. Every
	// other set-level test now enters the ladder, so the early-fit return at
	// `bound-image.ts:354` had no test at all and a regression that re-encoded
	// (and inflated) a fitting set would have passed (round 3, R3).
	//
	// The fixture is NOT the photos above, and that is the whole point: they
	// shrink on re-encode whatever the guard does, so the same assertion over
	// them passes with `bestBytes >= originalBytes` mutated to `false` -
	// measured, vacuous. Already-compressed JPEGs over the edge limit are the
	// shape whose PNG/JPEG re-encode is BIGGER than the source (the same reason
	// the per-image B3 test uses them), so here the guard is the only thing
	// standing between the caller and a larger set. Verified red: with the guard
	// disabled this fixture goes 984,031 -> 1,020,047 bytes.
	const compressed = [];
	for (const [width, height, quality] of [
		[1400, 1000, 55],
		[1200, 1024, 40],
		[1300, 980, 50],
	]) {
		const source = await sharp(await screenshotPng(width, height))
			.jpeg({ quality })
			.toBuffer();
		compressed.push({
			data_b64: source.toString("base64"),
			mime_type: "image/jpeg",
		});
	}
	// ABOVE the originals, so the first fit check answers and the ladder loop is
	// never entered - this is the early-fit return under test, not the ladder.
	const roomy = Math.ceil(measure(compressed) * 1.05);
	const untouched = await boundImagesForBudget(compressed, roomy, measure);
	assert.ok(
		measure(untouched) <= measure(compressed),
		`a set that already fits was made larger: ${measure(compressed)} -> ${measure(untouched)}`,
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
	assert.ok(
		refusal,
		"one character past the schema cap must be refused locally",
	);
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

test("a refusal never states the overflow and the budget as the same number", async () => {
	const {
		systemPromptBudgetRefusal,
		messageBudgetRefusal,
		commandBudgetRefusal,
		forkBudgetRefusal,
	} = await loadImageBounding();
	// A sentence whose two numbers render identically says the prompt both fits
	// and is refused, and leaves no way to know how much to cut. Because
	// `formatByteSize` rounds to one decimal, EVERY system-prompt overflow in
	// [1,100,001 ... 1,150,000] printed "is 1.1 MB, more than the 1.1 MB" - a
	// 50,000-byte window (4.55% over) that ordinary CJK prose reaches at ~370,000
	// characters (design round 1, D1).
	//
	// The payload is CJK rather than ASCII on purpose: at 3 UTF-8 bytes per
	// character, BYTES bind well before the 1,000,000-character cap. Padded with
	// ASCII to land on an exact byte count. An all-ASCII payload of this size
	// would be answered by the CHARACTER branch instead, and would pass this test
	// while proving nothing about the branch it guards.
	const cjk = "这是一个用于测试的中文系统提示词内容片段";
	const promptOfBytes = (target) => {
		const body = target - 20; // the {"system_prompt":"..."} envelope
		const chars = Math.floor((body - 250_000) / 3);
		return (
			cjk.repeat(Math.ceil(chars / cjk.length)).slice(0, chars) +
			"x".repeat(body - 3 * chars)
		);
	};
	// Canary the payload builder before trusting a single row below: it must land
	// on the exact byte count AND stay under the character cap, or this test
	// measures the wrong branch.
	const bytesOf = (s) =>
		new TextEncoder().encode(JSON.stringify({ system_prompt: s })).length;
	const atBudget = promptOfBytes(1_100_000);
	assert.equal(bytesOf(atBudget), 1_100_000);
	assert.ok(atBudget.length < 1_000_000, "payload must not reach the char cap");
	assert.equal(
		systemPromptBudgetRefusal(atBudget),
		null,
		"exactly at budget must still save, or the sweep below starts inside the refusal",
	);

	const pairOf = (sentence) => {
		const match = sentence.match(
			/is ([\d.,]+ (?:[KM]B|bytes))(?: of text)?, more than the ([\d.,]+ (?:[KM]B|bytes))/,
		);
		assert.ok(match, `refusal did not state a size pair: ${sentence}`);
		return match;
	};
	// The whole former collision window, byte by byte rather than at samples.
	for (let over = 1; over <= 60_000; over += 7) {
		const sentence = systemPromptBudgetRefusal(promptOfBytes(1_100_000 + over));
		assert.ok(sentence, `${over} bytes over budget must be refused`);
		assert.ok(
			!sentence.includes("characters"),
			`the BYTE branch must answer at +${over}, not the character cap`,
		);
		const [, size, limit] = pairOf(sentence);
		assert.notEqual(
			size,
			limit,
			`self-refuting at +${over} bytes: ${sentence}`,
		);
	}
	// The 370,000-character CJK case the designer reproduced, verbatim.
	assert.match(
		systemPromptBudgetRefusal(cjk.repeat(18_500)),
		/^This system prompt is 1\.11 MB, more than the 1\.10 MB one agent can carry\. Shorten it\.$/,
	);
	// Precision escalates one rung at a time, and exact bytes are the LAST
	// resort. Pinned because "never equal" alone is also satisfied by jumping
	// straight to raw bytes: dropping the 3-decimal rung left this test green
	// while making a 1 KB overflow read as "1,101,000 bytes" instead of
	// "1.101 MB", which is the less readable of two correct answers.
	assert.match(
		systemPromptBudgetRefusal(promptOfBytes(1_101_000)),
		/^This system prompt is 1\.101 MB, more than the 1\.100 MB one agent can carry\./,
	);
	// One byte over, where no decimal precision can separate the two values and
	// the sentence must fall back to exact bytes rather than shrink the window.
	assert.match(
		systemPromptBudgetRefusal(promptOfBytes(1_100_001)),
		/^This system prompt is 1,100,001 bytes, more than the 1,100,000 bytes one agent can carry\./,
	);
	// The siblings share the mechanism on an 880,000-byte budget, where the
	// window is only 499 bytes - narrow, but the sentence is wrong there too.
	// A NUL escapes to six bytes, so this is legal by character count.
	const nuls = "\u0000".repeat(146_667);
	for (const [surface, sentence] of [
		["message", messageBudgetRefusal(nuls, [])],
		["command", commandBudgetRefusal("login", nuls)],
		["fork", forkBudgetRefusal(nuls)],
	]) {
		assert.ok(sentence, `${surface} must refuse an over-budget payload`);
		const [, size, limit] = pairOf(sentence);
		assert.notEqual(size, limit, `${surface} self-refuting: ${sentence}`);
		// Pin the RUNG here too, for the reason the MB side pins it above: a
		// wrong KB divisor can never separate these two operands, so it falls
		// through to exact bytes - "880,093 bytes ... 880,000 bytes" - which is
		// still distinct and still satisfies `notEqual` while being the less
		// readable of two correct answers. Inequality alone cannot see that.
		// The budget operand is the one term all three surfaces share.
		assert.equal(
			limit,
			"880.00 KB",
			`${surface} must separate at the 2-decimal KB rung rather than fall back to exact bytes: ${sentence}`,
		);
	}
	// Away from the boundary the sentence keeps its one-decimal shape: the extra
	// precision is a collision remedy, not a new default.
	assert.match(
		systemPromptBudgetRefusal(promptOfBytes(1_400_000)),
		/^This system prompt is 1\.4 MB, more than the 1\.1 MB /,
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

test("a slash command over the CHARACTER cap is refused with the sized sentence", async () => {
	const { commandBudgetRefusal } = await loadImageBounding();
	// The character cap binds on inputs the byte budget admits: 400,000 ASCII
	// characters is ~400 KB against an 880,000-byte budget. The message path was
	// given both ceilings and the command path only the byte one, so the same
	// paste after a slash still died in `requestDesktop`'s schema parse as
	// "Invalid desktop operation." - R1's failure mode, one op over (round 2,
	// Q-7 / N1).
	assert.equal(
		commandBudgetRefusal("theme", "x".repeat(200_000)),
		null,
		"exactly the schema cap must be admitted",
	);
	const refusal = commandBudgetRefusal("theme", "x".repeat(200_001));
	assert.match(
		refusal,
		/^This command is 200,001 characters, more than the 200,000 one command can carry\. Shorten it, or put the text in a message instead\.$/,
	);
	// Characters are counted BEFORE bytes, so the sentence names the ceiling that
	// actually binds. 200,001 kanji is legal by characters and ~600 KB, well
	// inside the byte budget; the same count of NULs escapes to ~1.2 MB and is
	// the byte branch. Getting the order wrong tells a user to shorten prose that
	// is not what the transport refused.
	assert.match(
		commandBudgetRefusal("theme", "\u3042".repeat(200_001)),
		/200,001 characters/,
	);
	assert.match(
		commandBudgetRefusal("theme", "\u0000".repeat(150_000)),
		/^This command is [\d.]+ (KB|MB), more than the 880 KB one command can carry\./,
	);
});

test("a refused slash command reports RETAINED, so the composer keeps the draft", async () => {
	// The other half of Q-7, and the half that lost user data: the character cap
	// was missing AND the failure path discarded the paste. `dispatch` used to
	// answer a boolean, in which `true` meant "consumed" - the same answer a
	// SUCCESSFUL command gives - so a command refused before it ran retired the
	// draft exactly like one that had run. `use-message-input.ts:172` clears the
	// composer on anything but `false`, so 200,001 characters went to nothing.
	//
	// Asserted against the shipped source rather than a rendered hook, because
	// what broke was which VALUE each branch returns; React adds nothing to that.
	// The mapping this pins is the contract `chat-page.tsx` switches on.
	const source = await readFile(
		"src/renderer/src/features/chat/components/slash-dispatch.ts",
		"utf8",
	);
	const outcomes = [
		...source.matchAll(/return "(consumed|retained|not-a-command)";/g),
	].map((match) => match[1]);
	assert.ok(
		outcomes.includes("retained"),
		"a refused command must have an outcome distinct from a consumed one",
	);
	// The budget refusal and the transport failure are the two branches where the
	// command did NOT run. Both must retain; anything else is the data loss.
	const refusalBranch = source.slice(
		source.indexOf("const refusal = commandBudgetRefusal("),
	);
	assert.match(
		refusalBranch.slice(0, refusalBranch.indexOf("}")),
		/return "retained";/s,
	);
	const catchBranch = source.slice(source.lastIndexOf("} catch (error) {"));
	assert.match(catchBranch, /return "retained";/);

	// And the consumer must translate `retained` into the `false` that keeps the
	// text. A dispatch that reports honestly into a caller that ignores it is the
	// same bug one file over.
	const page = await readFile(
		"src/renderer/src/features/chat/components/chat-page.tsx",
		"utf8",
	);
	assert.match(page, /if \(dispatched === "retained"\) return false;/);
	assert.match(page, /if \(dispatched === "consumed"\) return true;/);
});

test("an oversize fork message is refused before the request, in the fork's own words", async () => {
	const { forkBudgetRefusal } = await loadImageBounding();
	// `sessions.fork` was moved onto the message budget in round 1 but never
	// given a pre-flight, so its own 200,000-character cap still surfaced through
	// the picker as "The fork was not created: Invalid desktop operation."
	// (round 2, N2).
	assert.equal(forkBudgetRefusal("continue from here"), null);
	const refusal = forkBudgetRefusal("x".repeat(200_001));
	assert.match(refusal, /^This first message is 200,001 characters,/);
	// The fork picker has no images and no second message to split across, so
	// the message copy would name two remedies that do not exist there.
	assert.ok(!refusal.includes("Remove an image"));
	assert.ok(!refusal.includes("Split it across two messages"));
	assert.ok(refusal.includes("send it in the new conversation instead"));
});

test("an oversize agent system prompt is refused in the editor's own words", async () => {
	const { systemPromptBudgetRefusal } = await loadImageBounding();
	// Round 1 sized this op's budget to its schema but added no pre-flight, so an
	// oversize prompt hit main's untargeted backstop and read "Remove an image,
	// or split the text across two messages" inside the agent system-prompt
	// editor - three claims all false there (round 2, N4).
	assert.equal(systemPromptBudgetRefusal("You are a helpful agent."), null);
	assert.equal(
		systemPromptBudgetRefusal("x".repeat(900_000)),
		null,
		"a long but legal prompt must still save",
	);
	const refusal = systemPromptBudgetRefusal("\u0000".repeat(200_000));
	assert.ok(refusal, "a prompt past the byte budget must be refused locally");
	assert.match(
		refusal,
		/^This system prompt is [\d.]+ MB, more than the 1\.1 MB/,
	);
	assert.ok(!refusal.includes("message"));
	assert.ok(!refusal.includes("Remove an image"));
	// The CHARACTER branch, which had no coverage at all until round 3: the
	// docstring claimed it could never fire, and a reviewer's `if (false)` mutant
	// on it passed 23/23. It is in fact the branch that fires on ORDINARY PROSE -
	// 1,000,001 ASCII characters is only ~1,000,021 bytes, under the 1,100,000
	// byte budget, so bytes never bind and only this check stands between the
	// paste and the bare "Invalid desktop operation." from `safeParse` (N4).
	assert.equal(
		systemPromptBudgetRefusal("x".repeat(1_000_000)),
		null,
		"a prompt exactly at the character cap must still save",
	);
	const overChars = systemPromptBudgetRefusal("x".repeat(1_000_001));
	assert.ok(
		overChars,
		"one character past the cap must be refused locally, not by safeParse",
	);
	assert.match(
		overChars,
		/^This system prompt is 1,000,001 characters, more than the 1,000,000 one agent can carry\./,
		"the character refusal must name the count, not the byte size",
	);
	// Names characters, not bytes - proving the CHARACTER branch answered. Were
	// the byte branch reached instead the sentence would read "1 MB".
	assert.ok(!overChars.includes("MB"));
});

test("the backstop 413 speaks the language of the surface it fired on", async () => {
	// The pre-flights above are the sized checks; this is the sentence for the
	// paths they do not cover. One string for every op meant the system-prompt
	// editor and the fork picker both showed message-and-image copy.
	const { desktopRequestTooLargeDetail } = await loadDesktopContract();
	assert.match(
		desktopRequestTooLargeDetail("sessions.message"),
		/Remove an image, or split the text across two messages\.$/,
	);
	const prompt = desktopRequestTooLargeDetail(
		"legacy.agent.systemPrompt.update",
	);
	assert.match(prompt, /^This system prompt is too large to save/);
	assert.ok(!prompt.includes("image"));
	assert.ok(!prompt.includes("message"));
	assert.match(
		desktopRequestTooLargeDetail("sessions.fork"),
		/^This first message is too large to send with the fork\./,
	);
	assert.match(
		desktopRequestTooLargeDetail("sessions.command"),
		/^This command is too large to send in one request\./,
	);
	// A control op names the form, not prose it does not carry.
	assert.match(
		desktopRequestTooLargeDetail("settings.edit"),
		/^This request is too large to send\. Shorten the text in this form\.$/,
	);
});
