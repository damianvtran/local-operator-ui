import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// The writer is pure (Buffers in, Buffers out), so it is bundled and exercised
// directly. Its output is read back by an INDEPENDENT parser below, written from the
// ISO 14496-12 box definitions and sharing no code with the writer: a writer and a
// reader that agree only because they share a bug would prove nothing.
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/browser/actions/recording-mux";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** Every box in `buf[start..end)`: {type, start, end, body}. */
function boxes(buf, start = 0, end = buf.length) {
	const out = [];
	let at = start;
	while (at < end) {
		const size = buf.readUInt32BE(at);
		assert.ok(size >= 8, `box at ${at} has size ${size}`);
		assert.ok(at + size <= end, `box at ${at} overruns its parent`);
		out.push({
			type: buf.toString("latin1", at + 4, at + 8),
			start: at,
			end: at + size,
			body: at + 8,
		});
		at += size;
	}
	assert.equal(at, end, "boxes tile their parent exactly");
	return out;
}

const child = (buf, parent, type) => {
	const found = boxes(buf, parent.body, parent.end).filter(
		(b) => b.type === type,
	);
	assert.equal(found.length, 1, `exactly one ${type}`);
	return found[0];
};

/** Parse a one-track AVC file into plain facts. */
function read(file) {
	const top = boxes(file);
	const order = top.map((b) => b.type);
	const moov = top.find((b) => b.type === "moov");
	const mdat = top.find((b) => b.type === "mdat");
	const trak = child(file, moov, "trak");
	const mdia = child(file, trak, "mdia");
	const minf = child(file, mdia, "minf");
	const stbl = child(file, minf, "stbl");
	const stsd = child(file, stbl, "stsd");
	// stsd: fullbox header (4) + entry count (4), then the sample entry.
	const entry = boxes(file, stsd.body + 8, stsd.end)[0];
	// VisualSampleEntry: 6 reserved + 2 index + 16 predefined, then width/height.
	const width = file.readUInt16BE(entry.body + 24);
	const height = file.readUInt16BE(entry.body + 26);
	// ... 4+4 resolution, 4 reserved, 2 frame count, 32 name, 2 depth, 2 predefined.
	const kids = boxes(file, entry.body + 78, entry.end);
	const avcC = kids.find((b) => b.type === "avcC");
	const colr = kids.find((b) => b.type === "colr");
	const mdhd = child(file, mdia, "mdhd");
	const stts = child(file, stbl, "stts");
	const stss = child(file, stbl, "stss");
	const stsz = child(file, stbl, "stsz");
	const stco = child(file, stbl, "stco");
	const stsc = child(file, stbl, "stsc");
	const mvhd = child(file, moov, "mvhd");
	const sizes = [];
	const count = file.readUInt32BE(stsz.body + 8);
	for (let i = 0; i < count; i += 1) {
		sizes.push(file.readUInt32BE(stsz.body + 12 + i * 4));
	}
	const runs = [];
	const runCount = file.readUInt32BE(stts.body + 4);
	for (let i = 0; i < runCount; i += 1) {
		runs.push([
			file.readUInt32BE(stts.body + 8 + i * 8),
			file.readUInt32BE(stts.body + 12 + i * 8),
		]);
	}
	const keys = [];
	const keyCount = file.readUInt32BE(stss.body + 4);
	for (let i = 0; i < keyCount; i += 1) {
		keys.push(file.readUInt32BE(stss.body + 8 + i * 4));
	}
	const offset = file.readUInt32BE(stco.body + 8);
	const samples = [];
	let at = offset;
	for (const size of sizes) {
		samples.push(file.subarray(at, at + size));
		at += size;
	}
	return {
		order,
		moov,
		mdat,
		width,
		height,
		avcC: avcC ? file.subarray(avcC.body, avcC.end) : null,
		colr: colr ? file.subarray(colr.body, colr.end) : null,
		timescale: file.readUInt32BE(mdhd.body + 12),
		mediaDuration: file.readUInt32BE(mdhd.body + 16),
		movieTimescale: file.readUInt32BE(mvhd.body + 12),
		movieDuration: file.readUInt32BE(mvhd.body + 16),
		runs,
		keys,
		sizes,
		offset,
		chunkEntries: file.readUInt32BE(stco.body + 4),
		stscEntries: file.readUInt32BE(stsc.body + 4),
		samples,
		hasCtts: boxes(file, stbl.body, stbl.end).some((b) => b.type === "ctts"),
	};
}

const sample = (n, ts, key = false) => ({
	data: Uint8Array.from({ length: n }, (_, i) => (i * 7 + n) & 0xff),
	ts,
	key,
});
const AVCC = Uint8Array.from([
	1, 0x64, 0, 0x33, 0xff, 0xe1, 0, 2, 0x67, 0x64, 1, 0, 1, 0x68,
]);

function clip(extra = {}) {
	const samples = [
		sample(900, 1_000_000, true),
		sample(120, 1_100_000),
		sample(130, 1_300_000),
		sample(5000, 2_000_000, true),
	];
	const out = mod.writeMp4({
		width: 1920,
		height: 1080,
		description: AVCC,
		samples,
		endTs: undefined,
		...extra,
	});
	return { samples, out, file: Buffer.concat(out.parts) };
}

test("the file is faststart: ftyp, then moov, then mdat", () => {
	const { file } = clip();
	assert.deepEqual(read(file).order, ["ftyp", "moov", "mdat"]);
});

test("the reader recovers every sample byte-for-byte at the offset stco names", () => {
	const { file, samples } = clip();
	const facts = read(file);
	assert.equal(facts.samples.length, samples.length);
	for (const [index, original] of samples.entries()) {
		assert.deepEqual(
			Uint8Array.from(facts.samples[index]),
			Uint8Array.from(original.data),
			`sample ${index}`,
		);
	}
	// The one chunk starts right after the mdat header, and the file ends with it.
	assert.equal(facts.offset, facts.mdat.body);
	assert.equal(facts.mdat.end, file.length);
	assert.equal(facts.chunkEntries, 1);
	assert.equal(facts.stscEntries, 1);
});

test("size, avcC and the BT.709 limited-range colr are in the sample entry", () => {
	const { file } = clip();
	const facts = read(file);
	assert.equal(facts.width, 1920);
	assert.equal(facts.height, 1080);
	assert.deepEqual(Uint8Array.from(facts.avcC), AVCC);
	// nclx, primaries 1, transfer 1, matrix 1, full-range bit clear.
	assert.deepEqual(
		[...facts.colr],
		[...Buffer.from("nclx"), 0, 1, 0, 1, 0, 1, 0],
	);
});

test("timestamps rebase to the first sample and every duration is the gap to the next", () => {
	const { file } = clip();
	const facts = read(file);
	assert.equal(facts.timescale, 90_000);
	// Gaps: 0.1 s, 0.2 s, 0.7 s, then the held last frame (default 0.1 s).
	assert.deepEqual(facts.runs, [
		[1, 9_000],
		[1, 18_000],
		[1, 63_000],
		[1, 9_000],
	]);
	assert.equal(facts.mediaDuration, 9_000 + 18_000 + 63_000 + 9_000);
	assert.equal(facts.movieTimescale, 1000);
	assert.equal(facts.movieDuration, 1100);
});

test("equal consecutive durations are run-length coded", () => {
	const samples = [0, 100_000, 200_000, 300_000].map((ts, i) =>
		sample(10 + i, ts, i === 0),
	);
	const facts = read(
		Buffer.concat(
			mod.writeMp4({ width: 640, height: 360, description: AVCC, samples })
				.parts,
		),
	);
	assert.deepEqual(facts.runs, [[4, 9_000]]);
});

test("the last sample is held until endTs when it is after it", () => {
	const { file } = clip({ endTs: 3_500_000 });
	const facts = read(file);
	// First ts 1.0 s, last sample at 2.0 s, end 3.5 s: held 1.5 s = 135000 ticks.
	assert.deepEqual(facts.runs.at(-1), [1, 135_000]);
	assert.equal(facts.movieDuration, 2500);
});

test("an endTs that is not after the last sample falls back to one frame", () => {
	const { file } = clip({ endTs: 2_000_000, fallbackFrameUs: 200_000 });
	assert.deepEqual(read(file).runs.at(-1), [1, 18_000]);
});

test("stss lists exactly the key frames, 1-based, and there is no ctts", () => {
	const { file } = clip();
	const facts = read(file);
	assert.deepEqual(facts.keys, [1, 4]);
	assert.equal(
		facts.hasCtts,
		false,
		"no B-frames means no composition offsets",
	);
});

test("a non-increasing timestamp is refused, not absorbed", () => {
	assert.throws(
		() =>
			mod.writeMp4({
				width: 640,
				height: 360,
				description: AVCC,
				samples: [
					sample(10, 0, true),
					sample(10, 100_000),
					sample(10, 100_000),
				],
			}),
		/strictly increase/,
	);
	assert.throws(
		() =>
			mod.writeMp4({
				width: 640,
				height: 360,
				description: AVCC,
				samples: [sample(10, 0, true), sample(10, 50_000), sample(10, 40_000)],
			}),
		/strictly increase/,
	);
});

test("two timestamps that round to one 90 kHz tick are refused too", () => {
	assert.throws(
		() =>
			mod.writeMp4({
				width: 640,
				height: 360,
				description: AVCC,
				samples: [sample(10, 0, true), sample(10, 5)],
			}),
		/strictly increase/,
	);
});

test("an empty clip, and a clip that does not start on a key frame, are refused", () => {
	assert.throws(
		() => mod.writeMp4({ width: 2, height: 2, description: AVCC, samples: [] }),
		/at least one sample/,
	);
	assert.throws(
		() =>
			mod.writeMp4({
				width: 640,
				height: 360,
				description: AVCC,
				samples: [sample(10, 0, false)],
			}),
		/key frame/,
	);
});

test("32-bit offsets are asserted: a payload the fields cannot describe is refused", () => {
	// A 4 GiB buffer is not worth allocating to prove a comparison, so the sample is
	// a stand-in with the length and nothing behind it; the writer must throw before
	// it touches a byte.
	const huge = {
		data: { length: 0xffff_ffff, buffer: null, byteOffset: 0 },
		ts: 0,
		key: true,
	};
	assert.throws(
		() =>
			mod.writeMp4({
				width: 640,
				height: 360,
				description: AVCC,
				samples: [huge],
			}),
		/32-bit/,
	);
});

test("the parts are the file: their sizes sum to `size`, which is the byte length", () => {
	const { out, file } = clip();
	assert.equal(
		out.parts.reduce((sum, part) => sum + part.length, 0),
		out.size,
	);
	assert.equal(out.size, file.length);
	assert.equal(out.durationMs, 1100);
});

test("a large clip keeps its parts separate: no second concatenated copy is built", () => {
	const samples = Array.from({ length: 600 }, (_, i) =>
		sample(40_000, i * 100_000, i % 20 === 0),
	);
	const out = mod.writeMp4({
		width: 3840,
		height: 2160,
		description: AVCC,
		samples,
	});
	// One header part plus one part per sample.
	assert.equal(out.parts.length, 601);
	const facts = read(Buffer.concat(out.parts));
	assert.equal(facts.samples.length, 600);
	assert.equal(facts.keys.length, 30);
});

test("the overhead bound covers the boxes around the payload", () => {
	for (const count of [1, 10, 600, 6000]) {
		const samples = Array.from({ length: count }, (_, i) =>
			sample(8, i * 100_000, i === 0),
		);
		const out = mod.writeMp4({
			width: 1920,
			height: 1080,
			description: AVCC,
			samples,
		});
		const overhead =
			out.size - samples.reduce((sum, s) => sum + s.data.length, 0);
		assert.ok(
			overhead <= mod.muxOverheadBound(count, AVCC.length),
			`${count} samples: ${overhead} > bound ${mod.muxOverheadBound(count, AVCC.length)}`,
		);
	}
});
