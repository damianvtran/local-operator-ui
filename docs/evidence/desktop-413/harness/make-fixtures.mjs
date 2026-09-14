/**
 * Generate the synthetic attachments the desktop-413 evidence harness attaches.
 *
 * Why this is committed rather than described: the README's reproduce steps and
 * `chat-413.vite.mjs` both name a generator that did not exist in the tree, so
 * the documented sequence could not be run by anyone who had not already built
 * the fixtures by hand (review round 1, Q-5). Evidence whose reproduction steps
 * do not execute is a claim, not evidence.
 *
 * Synthetic, never a real screenshot: these frames are committed to nothing and
 * regenerated on demand, and a real capture of this machine would put whatever
 * was on screen into the repository.
 *
 * Usage:
 *   node docs/evidence/desktop-413/harness/make-fixtures.mjs [out-dir]
 *
 * The default out-dir matches the `DESKTOP_413_FIXTURES` default in
 * `chat-413.vite.mjs`, so the harness finds the output with no further wiring.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const OUT = process.argv[2] ?? "/tmp/desktop-413-fixtures";

/**
 * A PNG shaped like an app screenshot: flat sidebar/titlebar panels, a light
 * canvas, dense antialiased text rows and a low-amplitude dither.
 *
 * The shape is load-bearing. Random noise GROWS when resampled and would make
 * the ladder look broken; a flat fill compresses to nothing and would make the
 * size numbers vacuous. This mirrors `screenshotPng` in
 * `scripts/desktop-renderer-transport.test.mjs` so the harness and the test
 * exercise the ladder on the same class of image.
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

/**
 * A GIF large enough that two of them overflow the message budget.
 *
 * GIF is the genuine-overflow case because it is exempt from every rung of the
 * ladder: `RE_ENCODABLE` in `bound-image.ts` excludes `image/gif`, so a GIF is
 * returned verbatim no matter how large and the refusal copy is the only thing
 * standing between it and the wire. The exemption exists because a canvas draws
 * ONE frame, so re-encoding an animation would silently destroy it.
 *
 * Single-frame, deliberately: the exemption keys on the MIME type, not on the
 * frame count, so one frame exercises exactly the same branch. Encoding a
 * multi-frame GIF would need `sharp`'s `join` input, which arrived in 0.34 and
 * this repository is pinned to 0.33.5 - a fixture that cannot be generated from
 * the committed dependency tree is the Q-5 defect again, one file over.
 *
 * The pixel pattern is high-frequency on purpose: a gradient or a flat fill
 * compresses to a few KB and would not overflow anything. `seed` decorrelates
 * the two files so the pair does not compress as one.
 */
async function overflowGif(width, height, seed) {
	const pixels = Buffer.alloc(width * height * 3);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const index = (y * width + x) * 3;
			pixels[index] = (x * 7 + y * 13 + seed * 29) % 256;
			pixels[index + 1] = (x * 17 + y * 5 + seed * 61) % 256;
			pixels[index + 2] = (x * 3 + y * 23 + seed * 11) % 256;
		}
	}
	return sharp(pixels, { raw: { width, height, channels: 3 } })
		.gif()
		.toBuffer();
}

mkdirSync(OUT, { recursive: true });
for (let n = 1; n <= 5; n += 1) {
	const file = join(OUT, `screenshot-${n}.png`);
	// 2880x1800 is a Retina capture's real geometry, which is the size that made
	// one attachment refuse a whole message before the ladder existed.
	writeFileSync(file, await screenshotPng(2880, 1800));
	console.log(file);
}
for (let n = 1; n <= 2; n += 1) {
	const file = join(OUT, `anim-${n}.gif`);
	writeFileSync(file, await overflowGif(900, 700, n));
	console.log(file);
}
