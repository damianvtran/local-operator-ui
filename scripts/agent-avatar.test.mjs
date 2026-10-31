/**
 * The agent profile picture, asserted in Node.
 *
 * WHAT IS REAL HERE. Three things, and they are the three a reviewer can read a
 * failure from without a browser:
 *
 *  1. the INPUT gate (`avatar-image.ts`) - what a picked file may be, and what
 *     the one-time migration is allowed to carry out of #1517's store;
 *  2. the CROP geometry (`crop-geometry.ts`) - the cover fit, the 1-4x clamp,
 *     the offset that never leaves a gap, and the zoom that keeps the subject
 *     where it was;
 *  3. the SEAM's address and record shape (`agent-avatar-meta.ts`) - the URL a
 *     picture is fetched by and which `avatar` records are usable at all.
 *
 * WHAT IS NOT HERE, and where it lives instead. The canvases (the decode, the
 * cropper's drawing, the 512px export) need a real compositor; the relay
 * (`agent.avatar` and its PUT/DELETE) needs a backend and its bearer, and its
 * schema is exercised where every media op's is - `desktop-contract.test.mjs`
 * refuses an op the schema does not know. Both are proven by driving the app:
 * the PR's testing evidence records the commands and their actual responses.
 */

import assert from "node:assert/strict";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * The bundle lands in `node_modules/.cache`, not in `scripts/`: a bare
 * specifier has to resolve from the bundle's own directory, which a scratchpad
 * outside the tree cannot do, and `node_modules` is the one place a generated
 * file is already excluded from the tree's gates. The name is unique per run so
 * two suites cannot clobber each other's file.
 */
const BUNDLE_DIR = "node_modules/.cache";
const RUN = `agent-avatar-${process.pid}`;
const PURE_BUNDLE = join(BUNDLE_DIR, `${RUN}-pure.mjs`);
const GEOMETRY_BUNDLE = join(BUNDLE_DIR, `${RUN}-geometry.mjs`);
const META_BUNDLE = join(BUNDLE_DIR, `${RUN}-meta.mjs`);

await mkdir(BUNDLE_DIR, { recursive: true });

const bundle = async (file, contents) => {
	const result = await build({
		stdin: { contents, resolveDir: process.cwd(), loader: "tsx" },
		bundle: true,
		format: "esm",
		platform: "node",
		packages: "external",
		jsx: "automatic",
		alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
		write: false,
	});
	await writeFile(file, result.outputFiles[0].text);
	return new URL(`../${file}`, import.meta.url).href;
};

const pureUrl = await bundle(
	PURE_BUNDLE,
	`export * from "./src/renderer/src/shared/agent-avatar/avatar-image";`,
);
const geometryUrl = await bundle(
	GEOMETRY_BUNDLE,
	`export * from "./src/renderer/src/shared/agent-avatar/crop-geometry";`,
);
const metaUrl = await bundle(
	META_BUNDLE,
	`export * from "./src/renderer/src/shared/agent-avatar/agent-avatar-meta";`,
);

const {
	AGENT_AVATAR_ACCEPT,
	AGENT_AVATAR_MAX_BYTES,
	AGENT_AVATAR_MAX_PIXELS,
	AGENT_AVATAR_MIME_TYPES,
	avatarFileRejection,
	avatarPixelRefusal,
	sanitizeAvatarImages,
} = await import(pureUrl);
const {
	CROP_MAX_ZOOM,
	CROP_MIN_ZOOM,
	CROP_OUTPUT_EDGE,
	centredOffset,
	clampOffset,
	clampZoom,
	coverScale,
	drawRect,
	zoomAround,
} = await import(geometryUrl);
const { agentAvatarPath, avatarMetaOf } = await import(metaUrl);

after(async () => {
	await Promise.all(
		[PURE_BUNDLE, GEOMETRY_BUNDLE, META_BUNDLE].map((file) =>
			unlink(file).catch(() => {}),
		),
	);
});

/** The contract's numbers, restated here so a silent drift fails. */
const MEBIBYTE = 1024 * 1024;

/* ------------------------------------------------------------------ *
 * THE INPUT GATE
 * ------------------------------------------------------------------ */

test("the picker's filter and the gate name the same formats", () => {
	assert.equal(AGENT_AVATAR_ACCEPT, AGENT_AVATAR_MIME_TYPES.join(","));
	assert.ok(AGENT_AVATAR_MIME_TYPES.includes("image/webp"));
	/* SVG is a document that can carry external references and script-capable
	 * content, so it is refused by the gate rather than decoded. */
	assert.ok(!AGENT_AVATAR_MIME_TYPES.includes("image/svg+xml"));
	/* The contract's input set: PNG, JPEG, WebP, GIF (HEIC needs an extra that
	 * this build does not ship, so it is not offered). */
	for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
		assert.ok(
			AGENT_AVATAR_MIME_TYPES.includes(type),
			`${type} is in the contract's input gate`,
		);
	}
});

test("a file is refused before it is decoded", () => {
	assert.equal(avatarFileRejection({ type: "image/png", size: 1024 }), null);
	for (const type of ["image/svg+xml", "application/pdf", "", "image"]) {
		assert.equal(
			avatarFileRejection({ type, size: 1024 }),
			"type",
			`${type} must be refused as a type`,
		);
	}
	assert.equal(
		avatarFileRejection({ type: "image/png", size: 0 }),
		"decode",
		"an empty file is unreadable, not oversized",
	);
});

test("the byte ceiling is the contract's 10 MiB, inclusive", () => {
	assert.equal(AGENT_AVATAR_MAX_BYTES, 10 * MEBIBYTE);
	assert.equal(
		avatarFileRejection({ type: "image/png", size: AGENT_AVATAR_MAX_BYTES }),
		null,
		"exactly at the cap is allowed",
	);
	assert.equal(
		avatarFileRejection({
			type: "image/png",
			size: AGENT_AVATAR_MAX_BYTES + 1,
		}),
		"size",
	);
});

test("the pixel gate refuses a source past the megapixel bound", () => {
	assert.equal(AGENT_AVATAR_MAX_PIXELS, 40_000_000);
	// 40 MP exactly is at the bound, which the contract allows.
	assert.equal(avatarPixelRefusal(8000, 5000), null);
	assert.equal(avatarPixelRefusal(8000, 5001), "decode");
	/* A flat-colour PNG of extreme dimensions compresses into a few hundred
	 * kilobytes, so the byte gate alone would let it through and the decode
	 * would allocate it in the renderer. */
	assert.equal(avatarPixelRefusal(40_000, 40_000), "decode");
	for (const [width, height] of [
		[0, 10],
		[-1, 10],
		[Number.NaN, 10],
		[Number.POSITIVE_INFINITY, 10],
	]) {
		assert.equal(avatarPixelRefusal(width, height), "decode");
	}
});

test("the type refusal copy names exactly the formats the gate accepts", async () => {
	const catalogue = JSON.parse(
		await readFile("src/i18n/catalogues/en/ui.agents.avatar.json", "utf8"),
	);
	const sentence = catalogue["ui.agents.avatar.editor.error_type"];
	/*
	 * The sentence spells the accepted formats out, so it can drift from the gate
	 * that decides. The table is the only place a MIME type gets a display name;
	 * every name it maps must appear in the sentence, and SVG (which no branch
	 * accepts) must not.
	 */
	const names = {
		"image/jpeg": "JPEG",
		"image/png": "PNG",
		"image/webp": "WebP",
		"image/gif": "GIF",
	};
	for (const type of AGENT_AVATAR_MIME_TYPES) {
		const name = names[type];
		assert.ok(name !== undefined, `${type} needs a display name in this test`);
		assert.ok(
			sentence.includes(name),
			`the refusal must name ${name} for ${type}: ${sentence}`,
		);
	}
	assert.ok(!sentence.includes("SVG"), "SVG is refused, so it is not offered");
});

/* ------------------------------------------------------------------ *
 * THE MIGRATION'S FILTER
 * ------------------------------------------------------------------ */

test("a stored blob is filtered rather than trusted before it is uploaded", () => {
	const kept = sanitizeAvatarImages({
		"agent-good": "data:image/webp;base64,AAAA",
		"agent-png": "data:image/png;base64,AAAA",
		"agent-bad-scheme": "javascript:alert(1)",
		"agent-bad-type": "data:text/html;base64,AAAA",
		"agent-not-a-string": 42,
		"": "data:image/png;base64,AAAA",
		[`x${"y".repeat(220)}`]: "data:image/png;base64,AAAA",
	});
	assert.deepEqual(
		Object.keys(kept).sort(),
		["agent-good", "agent-png"],
		"only an image data URL with a sane key survives to be uploaded",
	);
	for (const bad of [null, undefined, 42, "string", []]) {
		assert.deepEqual(sanitizeAvatarImages(bad), {});
	}
});

/* ------------------------------------------------------------------ *
 * THE CROP GEOMETRY
 * ------------------------------------------------------------------ */

const VIEWPORT = 288;

test("the cover fit is the short side filling the square", () => {
	// A landscape photo: the height is the short side, so it sets the scale.
	assert.equal(
		coverScale({ width: 800, height: 600 }, VIEWPORT),
		VIEWPORT / 600,
	);
	// And the reverse for a portrait one.
	assert.equal(
		coverScale({ width: 600, height: 800 }, VIEWPORT),
		VIEWPORT / 600,
	);
});

test("the offset never leaves a gap in the square, at any zoom", () => {
	const image = { width: 800, height: 600 };
	for (const zoom of [1, 1.5, 2, 3, CROP_MAX_ZOOM]) {
		const scale = coverScale(image, VIEWPORT) * clampZoom(zoom);
		const drawnWidth = image.width * scale;
		const drawnHeight = image.height * scale;
		for (const offset of [
			{ x: 0, y: 0 },
			{ x: 999, y: 999 },
			{ x: -999, y: -999 },
			{ x: 12, y: -3 },
		]) {
			const clamped = clampOffset(image, VIEWPORT, zoom, offset);
			assert.ok(
				clamped.x <= 0 && clamped.x >= VIEWPORT - drawnWidth - 1e-9,
				`x ${clamped.x} keeps the image over the left and right edges at ${zoom}x`,
			);
			assert.ok(
				clamped.y <= 0 && clamped.y >= VIEWPORT - drawnHeight - 1e-9,
				`y ${clamped.y} keeps the image over the top and bottom edges at ${zoom}x`,
			);
		}
	}
});

test("a centred offset really centres, and a square fills exactly", () => {
	const square = { width: 512, height: 512 };
	const centred = centredOffset(square, VIEWPORT);
	assert.deepEqual(centred, { x: 0, y: 0 }, "a square at 1x covers the square");
	const wide = centredOffset({ width: 1024, height: 512 }, VIEWPORT);
	assert.equal(wide.y, 0, "the short axis is exact");
	assert.equal(wide.x, (VIEWPORT - 1024 * (VIEWPORT / 512)) / 2);
});

test("zoom is clamped to the console's 1-4x range", () => {
	assert.equal(clampZoom(0.1), CROP_MIN_ZOOM);
	assert.equal(clampZoom(1), CROP_MIN_ZOOM);
	assert.equal(clampZoom(2.5), 2.5);
	assert.equal(clampZoom(9), CROP_MAX_ZOOM);
	assert.equal(clampZoom(Number.NaN), CROP_MIN_ZOOM);
});

test("zooming keeps the point under the centre where it was", () => {
	const image = { width: 1000, height: 700 };
	const start = centredOffset(image, VIEWPORT);
	const zoomed = zoomAround(image, VIEWPORT, 1, 2, start);
	assert.equal(zoomed.zoom, 2);
	/*
	 * The image's centre maps to the viewport's centre at both zooms, which is the
	 * property that stops a face sliding out of frame as it grows: centre of the
	 * drawn image = offset + drawn/2.
	 */
	const centreAt = (zoom, offset) => {
		const scale = coverScale(image, VIEWPORT) * zoom;
		return {
			x: offset.x + (image.width * scale) / 2,
			y: offset.y + (image.height * scale) / 2,
		};
	};
	const before = centreAt(1, start);
	const after = centreAt(2, zoomed.offset);
	assert.ok(Math.abs(before.x - after.x) < 1e-6, "the horizontal centre held");
	assert.ok(Math.abs(before.y - after.y) < 1e-6, "the vertical centre held");
});

test("a zoom past the range is clamped, not applied", () => {
	const image = { width: 800, height: 600 };
	const tooFar = zoomAround(
		image,
		VIEWPORT,
		1,
		99,
		centredOffset(image, VIEWPORT),
	);
	assert.equal(tooFar.zoom, CROP_MAX_ZOOM);
	const tooClose = zoomAround(
		image,
		VIEWPORT,
		2,
		0.01,
		centredOffset(image, VIEWPORT),
	);
	assert.equal(tooClose.zoom, CROP_MIN_ZOOM);
});

test("one draw rectangle serves the square, the previews and the output", () => {
	const image = { width: 1000, height: 500 };
	const offset = centredOffset(image, VIEWPORT);
	const rect = drawRect(image, VIEWPORT, 1, offset, VIEWPORT);
	assert.equal(rect.dy, 0, "the short axis is exact at the viewport's scale");
	// The 512px export is the same crop scaled up; every preview is the same crop
	// scaled down. That is what makes a preview honest.
	const output = drawRect(image, VIEWPORT, 1, offset, CROP_OUTPUT_EDGE);
	const ratio = CROP_OUTPUT_EDGE / VIEWPORT;
	assert.ok(Math.abs(output.dx - rect.dx * ratio) < 1e-9);
	assert.ok(Math.abs(output.dw - rect.dw * ratio) < 1e-9);
	for (const preview of [16, 20, 32]) {
		const small = drawRect(image, VIEWPORT, 1, offset, preview);
		const k = preview / VIEWPORT;
		assert.ok(Math.abs(small.dw - rect.dw * k) < 1e-9);
		assert.ok(Math.abs(small.dh - rect.dh * k) < 1e-9);
	}
	assert.equal(CROP_OUTPUT_EDGE, 512, "the stored edge is the contract's 512");
});

/* ------------------------------------------------------------------ *
 * THE SEAM'S ADDRESS AND RECORD SHAPE
 * ------------------------------------------------------------------ */

test("a picture is addressed by agent id and content digest", () => {
	assert.equal(
		agentAvatarPath("agent-coder", "b".repeat(64)),
		`/v1/agents/agent-coder/avatar?v=${"b".repeat(64)}`,
	);
	// An id is escaped rather than pasted into a path.
	assert.equal(
		agentAvatarPath("a/b c", "b".repeat(64)),
		`/v1/agents/a%2Fb%20c/avatar?v=${"b".repeat(64)}`,
	);
});

test("an unusable avatar record reads as no picture, never as a broken one", () => {
	const good = {
		sha256: "c".repeat(64),
		mime: "image/png",
		bytes: 12_345,
		updated_at: "2026-10-30T00:00:00Z",
	};
	assert.deepEqual(avatarMetaOf(good), good);
	/* An older backend sends no field at all; that is a glyph, not an error. */
	assert.equal(avatarMetaOf(null), null);
	assert.equal(avatarMetaOf(undefined), null);
	assert.equal(avatarMetaOf({}), null);
	/* A malformed digest would become a relay request main refuses on every
	 * render, so the record is refused here instead. */
	for (const sha256 of ["", "abc", "C".repeat(64), "c".repeat(63), 42]) {
		assert.equal(avatarMetaOf({ sha256 }), null, `${sha256} is not a digest`);
	}
	/* A usable digest with missing neighbours still draws: the digest is the
	 * authority and the rest is metadata. */
	assert.deepEqual(avatarMetaOf({ sha256: "d".repeat(64) }), {
		sha256: "d".repeat(64),
		mime: "image/png",
		bytes: 0,
		updated_at: "",
	});
});
