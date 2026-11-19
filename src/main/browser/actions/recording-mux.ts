/**
 * A minimal MP4 writer for ONE H.264 video track, for `quality: "high"` recordings
 * (design D18, `docs/design/browser-recording.md`).
 *
 * WHY OUR OWN WRITER. The encoder (WebCodecs, in a hidden renderer) hands back
 * length-prefixed H.264 samples and the `avcC` record; the only job left is to
 * box them. A muxer dependency would be the largest new thing in this feature
 * for ~200 lines of boxes: `mp4-muxer` is deprecated, `mediabunny` is MPL-2.0 and
 * ships daily, and fragmented MP4 is poorly supported by editors. The writer
 * extends the 43-line probe that proved the layout plays in AVFoundation and
 * Chromium.
 *
 * LAYOUT, AND WHY. `ftyp`, then `moov`, then `mdat` ("faststart"): a player can
 * start from the first byte of a file it has not finished reading, and a clip a
 * harness hands to a browser or an editor seeks without a second read of the tail.
 * The `moov` is built twice because its size decides the one `stco` offset it holds.
 *
 * WHAT IT ASSUMES, ASSERTED RATHER THAN HOPED:
 * - NO B-FRAMES. Presentation order is decode order, so there is no `ctts`, and a
 *   non-increasing timestamp is an encoder error, not something to reorder.
 * - 32-BIT OFFSETS. `stco` and the `mdat` size are 32 bits. The 64 MiB cap keeps a
 *   clip three orders of magnitude inside that; the writer still throws if a caller
 *   ever hands it more, because a wrapped offset is a corrupt file that LOOKS fine.
 * - ONE CHUNK. Every sample sits in a single `stco` entry; the file is written once,
 *   at stop, from memory (`HqSession` bounds that memory with the byte cap).
 *
 * `colr` carries BT.709 limited range: it is what the encoder's RGB-to-YUV step
 * assumes for sRGB sources, and without it a player has to guess for an untagged
 * stream (most guess BT.601 below 720p, which shifts every colour).
 */

/** The media timescale: 90 kHz is the MPEG convention and divides every frame
 * interval the host produces (10 fps = 9000 ticks) without rounding. */
const TIMESCALE = 90_000;

/** The movie timescale: milliseconds, which is what players display. */
const MOVIE_TIMESCALE = 1000;

/** Longest file the 32-bit fields can describe. */
const MAX_FILE_BYTES = 0xffff_ffff;

/** One coded sample, in decode order. `ts` is the presentation time in
 * microseconds from the clip's start. */
export interface Mp4Sample {
	data: Uint8Array;
	ts: number;
	key: boolean;
}

export interface Mp4Input {
	width: number;
	height: number;
	/** The `avcC` record, exactly as the encoder's decoder config carries it. */
	description: Uint8Array;
	samples: readonly Mp4Sample[];
	/** The clip's end, in microseconds from its start: the last sample is held until
	 * here. Absent means "one frame at `fallbackFrameUs`". */
	endTs?: number;
	/** The hold for the last sample when `endTs` is absent or not after it. */
	fallbackFrameUs?: number;
}

/** The finished file as parts, so a 64 MiB clip is written without a second
 * concatenated copy. `size` is the sum of the parts. */
export interface Mp4Output {
	parts: Buffer[];
	size: number;
	/** Media duration in milliseconds, as the container reports it. */
	durationMs: number;
}

const u32 = (value: number): Buffer => {
	const out = Buffer.alloc(4);
	out.writeUInt32BE(value >>> 0);
	return out;
};

const u16 = (value: number): Buffer => {
	const out = Buffer.alloc(2);
	out.writeUInt16BE(value);
	return out;
};

const box = (type: string, ...children: Buffer[]): Buffer => {
	const body = Buffer.concat(children);
	return Buffer.concat([
		u32(8 + body.length),
		Buffer.from(type, "latin1"),
		body,
	]);
};

const fullBox = (
	type: string,
	version: number,
	flags: number,
	...children: Buffer[]
): Buffer => box(type, u32((version << 24) | flags), ...children);

const IDENTITY_MATRIX = Buffer.concat(
	[0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].map(u32),
);

function assertOffset(value: number, what: string): void {
	if (!Number.isFinite(value) || value < 0 || value > MAX_FILE_BYTES) {
		throw new RangeError(
			`${what} does not fit a 32-bit MP4 field (${value}); the recording cap keeps clips far below this`,
		);
	}
}

/** Decode timestamps in media ticks: strictly increasing, or it throws. */
function decodeTimes(input: Mp4Input): number[] {
	const { samples } = input;
	const first = samples[0].ts;
	const out: number[] = [];
	for (const sample of samples) {
		const tick = Math.round(((sample.ts - first) * TIMESCALE) / 1e6);
		const previous = out[out.length - 1];
		if (previous !== undefined && tick <= previous) {
			// No B-frames means no reordering: a timestamp that does not advance is an
			// encoder fault (two frames at one instant), and absorbing it would write a
			// zero-length sample some players drop and others stall on.
			throw new RangeError(
				`sample timestamps must strictly increase (got tick ${tick} after ${previous})`,
			);
		}
		out.push(tick);
	}
	return out;
}

/** Box one clip. Throws `RangeError` on an empty sample list, a non-increasing
 * timestamp or a file the 32-bit fields cannot describe. */
export function writeMp4(input: Mp4Input): Mp4Output {
	const { samples, width, height, description } = input;
	if (samples.length === 0) {
		throw new RangeError("an MP4 needs at least one sample");
	}
	if (!samples[0].key) {
		throw new RangeError("the first sample must be a key frame");
	}
	const count = samples.length;
	const dts = decodeTimes(input);
	const lastHold = (() => {
		const fallback = Math.max(
			1,
			Math.round(((input.fallbackFrameUs ?? 100_000) * TIMESCALE) / 1e6),
		);
		if (input.endTs === undefined) return fallback;
		const endTick = Math.round(
			((input.endTs - samples[0].ts) * TIMESCALE) / 1e6,
		);
		return endTick > dts[count - 1] ? endTick - dts[count - 1] : fallback;
	})();
	const durations = dts.map((tick, index) =>
		index + 1 < count ? dts[index + 1] - tick : lastHold,
	);
	const totalTicks = durations.reduce((sum, value) => sum + value, 0);
	const movieDuration = Math.round((totalTicks * MOVIE_TIMESCALE) / TIMESCALE);

	let payload = 0;
	for (const sample of samples) payload += sample.data.length;
	assertOffset(payload + 8, "the media data size");

	const stts = (() => {
		const runs: Array<[number, number]> = [];
		for (const duration of durations) {
			const last = runs[runs.length - 1];
			if (last && last[1] === duration) last[0] += 1;
			else runs.push([1, duration]);
		}
		return fullBox(
			"stts",
			0,
			0,
			u32(runs.length),
			...runs.flatMap(([run, duration]) => [u32(run), u32(duration)]),
		);
	})();
	const keyIndexes = samples.flatMap((sample, index) =>
		sample.key ? [u32(index + 1)] : [],
	);
	const stss = fullBox("stss", 0, 0, u32(keyIndexes.length), ...keyIndexes);
	// One chunk holds every sample (see the header).
	const stsc = fullBox("stsc", 0, 0, u32(1), u32(1), u32(count), u32(1));
	const stsz = fullBox(
		"stsz",
		0,
		0,
		u32(0),
		u32(count),
		...samples.map((sample) => u32(sample.data.length)),
	);

	const sampleEntry = box(
		"avc1",
		Buffer.alloc(6),
		u16(1),
		Buffer.alloc(16),
		u16(width),
		u16(height),
		u32(0x480000),
		u32(0x480000),
		u32(0),
		u16(1),
		Buffer.alloc(32),
		u16(0x18),
		u16(0xffff),
		box("avcC", Buffer.from(description)),
		// nclx: primaries 1, transfer 1, matrix 1 (BT.709), then the full-range bit
		// in the top bit of a byte: 0 = limited.
		box(
			"colr",
			Buffer.from("nclx", "latin1"),
			u16(1),
			u16(1),
			u16(1),
			Buffer.from([0]),
		),
	);
	const stsd = fullBox("stsd", 0, 0, u32(1), sampleEntry);
	const dinf = box(
		"dinf",
		fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1)),
	);
	const mdhd = fullBox(
		"mdhd",
		0,
		0,
		u32(0),
		u32(0),
		u32(TIMESCALE),
		u32(totalTicks),
		u16(0x55c4),
		u16(0),
	);
	const hdlr = fullBox(
		"hdlr",
		0,
		0,
		u32(0),
		Buffer.from("vide", "latin1"),
		Buffer.alloc(12),
		Buffer.from("VideoHandler\0", "latin1"),
	);
	const tkhd = fullBox(
		"tkhd",
		0,
		3,
		u32(0),
		u32(0),
		u32(1),
		u32(0),
		u32(movieDuration),
		Buffer.alloc(8),
		u16(0),
		u16(0),
		u16(0),
		u16(0),
		IDENTITY_MATRIX,
		u32(width << 16),
		u32(height << 16),
	);
	const mvhd = fullBox(
		"mvhd",
		0,
		0,
		u32(0),
		u32(0),
		u32(MOVIE_TIMESCALE),
		u32(movieDuration),
		u32(0x10000),
		u16(0x100),
		Buffer.alloc(10),
		IDENTITY_MATRIX,
		Buffer.alloc(24),
		u32(2),
	);
	const ftyp = box(
		"ftyp",
		Buffer.from("isom", "latin1"),
		u32(512),
		Buffer.from("isomiso2avc1mp41", "latin1"),
	);
	const moovWith = (chunkOffset: number): Buffer => {
		const stco = fullBox("stco", 0, 0, u32(1), u32(chunkOffset));
		const stbl = box("stbl", stsd, stts, stss, stsc, stsz, stco);
		const minf = box(
			"minf",
			fullBox("vmhd", 0, 1, Buffer.alloc(8)),
			dinf,
			stbl,
		);
		const trak = box("trak", tkhd, box("mdia", mdhd, hdlr, minf));
		return box("moov", mvhd, trak);
	};
	// The offset field is fixed-width, so the size is the same for any value.
	const moovSize = moovWith(0).length;
	const mdatHeader = Buffer.concat([u32(8 + payload), Buffer.from("mdat")]);
	const dataStart = ftyp.length + moovSize + mdatHeader.length;
	assertOffset(dataStart + payload, "the file size");
	const moov = moovWith(dataStart);
	const parts = [
		Buffer.concat([ftyp, moov, mdatHeader]),
		...samples.map((sample) =>
			Buffer.from(
				sample.data.buffer,
				sample.data.byteOffset,
				sample.data.length,
			),
		),
	];
	return {
		parts,
		size: ftyp.length + moov.length + mdatHeader.length + payload,
		durationMs: movieDuration,
	};
}

/**
 * An UPPER BOUND on the bytes a clip of `samples` samples adds around its payload:
 * `ftyp`, the fixed `moov` boxes, the `avcC` record, and 16 bytes of per-sample
 * tables (`stsz` 4, `stts` at most 8, `stss` 4). The cap is enforced against
 * payload plus this, so a clip that stops at the cap is at or under it once boxed.
 */
export function muxOverheadBound(
	samples: number,
	descriptionBytes: number,
): number {
	return 4096 + descriptionBytes + 16 * samples;
}
