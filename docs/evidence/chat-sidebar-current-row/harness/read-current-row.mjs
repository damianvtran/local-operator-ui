#!/usr/bin/env node
/**
 * Reads a frame's current row out of the PIXELS, and measures the pair.
 *
 *     sips -s format png <frame>.webp --out /tmp/frame.png   # macOS decoder
 *     node docs/evidence/chat-sidebar-current-row/harness/read-current-row.mjs \
 *       /tmp/frame.png 180 265 380 560
 *
 * Why this exists as a separate instrument. `pnpm check-themes` measures the
 * PALETTE — it proves `highlight` is ΔE00 4.01-4.39 from `surface` and that every
 * ink clears its floor on it. It cannot prove the row is painted with that role,
 * whether the browser composited what the class string asked for, or whether the
 * row's BOX moved when the structural edge was added. All three are claims about
 * a rendered frame, so all three are read back from one: the column at `x` is
 * walked from `y0` to `y1`, the panel's own ground is sampled above the list, and
 * the contiguous run that differs from it is the current row.
 *
 * The extent is the reason the edge is in this harness at all: an `outline`
 * draws outside the box model, so the run's top and bottom MUST be the same
 * before and after. A run that grew is the row reflowing against its neighbours,
 * which is the defect an outline was chosen to avoid and the one a still image
 * makes obvious only if somebody measures it.
 *
 * The decoder is deliberately not in here: PNG is decoded with `zlib`, and the
 * frame is WebP, so a decoder step precedes it — `sips` on macOS, `dwebp`
 * anywhere. Keeping it out means this file has no image dependency and the
 * README can state which decoder produced the numbers.
 */

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { deltaE, r2 } from "../../../../scripts/color.mjs";

const [file, x0Arg, x1Arg, y0Arg, y1Arg] = process.argv.slice(2);
if (!file) {
	console.error(
		"usage: read-current-row.mjs <frame.png> <x0> <x1> <y0> <y1>\n" +
			"  decode the WebP first: sips -s format png <frame>.webp --out <frame>.png",
	);
	process.exit(2);
}
const x0 = Number(x0Arg ?? 180);
const x1 = Number(x1Arg ?? 265);
const y0 = Number(y0Arg ?? 380);
const y1 = Number(y1Arg ?? 560);

/** A PNG decoded to `{ width, height, at(x, y) }`, 8-bit RGB/RGBA, no interlace. */
const decodePng = (path) => {
	const buffer = readFileSync(path);
	let at = 8;
	let width = 0;
	let height = 0;
	let colourType = 0;
	const idat = [];
	while (at < buffer.length) {
		const length = buffer.readUInt32BE(at);
		const type = buffer.toString("ascii", at + 4, at + 8);
		const body = buffer.subarray(at + 8, at + 8 + length);
		if (type === "IHDR") {
			width = body.readUInt32BE(0);
			height = body.readUInt32BE(4);
			const depth = body[8];
			colourType = body[9];
			const interlace = body[12];
			if (depth !== 8 || interlace !== 0 || (colourType !== 2 && colourType !== 6)) {
				throw new Error(
					`unsupported PNG: depth ${depth}, colour type ${colourType}, interlace ${interlace}. Re-encode as 8-bit RGB/RGBA without interlacing.`,
				);
			}
		} else if (type === "IDAT") {
			idat.push(body);
		} else if (type === "IEND") {
			break;
		}
		at += 12 + length;
	}
	const channels = colourType === 6 ? 4 : 3;
	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * channels;
	const pixels = Buffer.alloc(height * stride);
	for (let row = 0; row < height; row += 1) {
		const filter = raw[row * (stride + 1)];
		const line = raw.subarray(
			row * (stride + 1) + 1,
			row * (stride + 1) + 1 + stride,
		);
		const out = pixels.subarray(row * stride, (row + 1) * stride);
		const above = row === 0 ? null : pixels.subarray((row - 1) * stride, row * stride);
		for (let i = 0; i < stride; i += 1) {
			const a = i >= channels ? out[i - channels] : 0;
			const b = above ? above[i] : 0;
			const c = above && i >= channels ? above[i - channels] : 0;
			let value = line[i];
			if (filter === 1) value += a;
			else if (filter === 2) value += b;
			else if (filter === 3) value += (a + b) >> 1;
			else if (filter === 4) {
				const p = a + b - c;
				const [pa, pb, pc] = [
					Math.abs(p - a),
					Math.abs(p - b),
					Math.abs(p - c),
				];
				value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			out[i] = value & 0xff;
		}
	}
	const hex = (r, g, b) =>
		`#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
	return {
		width,
		height,
		at: (px, py) => {
			const i = py * stride + px * channels;
			return hex(pixels[i], pixels[i + 1], pixels[i + 2]);
		},
	};
};

const image = decodePng(file);

/*
 * The row's ground is read as the MODE of a horizontal SPAN rather than as one
 * pixel, because one pixel in a row of text is a glyph's antialiased edge and
 * two of those are not the same colour before and after a palette change. The
 * span is the right-hand end of the row box, past every label in the fixture.
 */
const modeOf = (y) => {
	const tally = new Map();
	for (let x = x0; x <= Math.min(x1, image.width - 1); x += 1) {
		const hex = image.at(x, y);
		tally.set(hex, (tally.get(hex) ?? 0) + 1);
	}
	return [...tally].sort((a, b) => b[1] - a[1])[0][0];
};
const column = [];
for (let y = y0; y < Math.min(y1, image.height); y += 1) {
	column.push({ y, hex: modeOf(y) });
}
/* The panel's own ground: the span two pixels above the window's first row. */
const panel = modeOf(Math.max(0, y0 - 2));

/*
 * The LONGEST run that differs from the panel, not the first one. A group
 * heading, a divider or a section label above the row is a short run of its own,
 * and taking the first one measured those instead on the light palettes — where
 * the row's ground and the panel's are closest, a heading's text is the more
 * obvious difference. The row is the longest such run in the window by
 * construction; anything longer is the window being wrong.
 */
const runs = [];
let current = null;
for (const entry of column) {
	if (entry.hex === panel) {
		current = null;
		continue;
	}
	if (current === null) {
		current = { top: entry.y, bottom: entry.y };
		runs.push(current);
	} else {
		current.bottom = entry.y;
	}
}
const longest = runs.sort(
	(a, b) => b.bottom - b.top - (a.bottom - a.top),
)[0];
const top = longest?.top ?? null;
const bottom = longest?.bottom ?? null;
/*
 * The row's GROUND is read at the CENTRE of the run, not at its first pixel:
 * since the structural edge is drawn inside the box (`-outline-offset-1`), the
 * run's first and last rows are the ring, and a reader asking "what ground is
 * this row painted on" wants the middle. The ring is reported separately, and
 * its presence is what the extent difference between the halves measures.
 */
const row = top === null ? null : modeOf(Math.round((top + bottom) / 2));
const edge = top === null ? null : modeOf(top);
console.log(
	JSON.stringify(
		{
			frame: file,
			size: `${image.width}x${image.height}`,
			span: `x=${x0}-${x1}, y=${y0}-${y1}`,
			panel,
			row,
			edge,
			runs: runs.map((run) => run.bottom - run.top + 1),
			extent: top === null ? null : { top, bottom, height: bottom - top + 1 },
			deltaE00: row === null ? null : r2(deltaE(row, panel)),
		},
		null,
		1,
	),
);
