import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SOUNDS_SESSION = "50a0facade01";

/**
 * HOW MANY SOUNDS THE HIGHLIGHTS ROW CARRIES. Fourteen is the number the
 * operator reported as an unreadable wall under the old one-row-per-sound
 * column, and it is past the producer's retired three-sound cap — the fixture
 * must seed what the fixed producer sends, or the scene would prove the layout
 * on a list the product no longer emits.
 */
export const SOUNDS_COUNT = 14;
/** A one-sound turn, for the single-sound collage frame. */
export const SOUNDS_SINGLE_SESSION = "50a0facade02";
/** A turn whose highlights row carries no sounds at all: the empty arm. */
export const SOUNDS_EMPTY_SESSION = "50a0facade03";
/**
 * The title the long-title frame reads. One of the fourteen carries it so the
 * truncation is shot on the real collage, not on a made-up one-cell fixture.
 */
export const SOUNDS_LONG_TITLE =
	"Storm swell with a deliberately long descriptive title that must truncate";

/**
 * Non-silent PCM proves that graph silence is routing, not a silent fixture.
 * `tone` shifts the frequency so every synthesized sound has DISTINCT bytes
 * (and therefore a distinct digest): the collage keys on the digest, and
 * fourteen copies of one file would collapse into one identity.
 */
export function soundSample(tone = 0) {
	const rate = 8000;
	const seconds = 12;
	const samples = rate * seconds;
	const frequency = 220 + tone * 40;
	const wav = Buffer.alloc(44 + samples * 2);
	wav.write("RIFF", 0);
	wav.writeUInt32LE(wav.length - 8, 4);
	wav.write("WAVEfmt ", 8);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(rate, 24);
	wav.writeUInt32LE(rate * 2, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write("data", 36);
	wav.writeUInt32LE(samples * 2, 40);
	for (let i = 0; i < samples; i++)
		wav.writeInt16LE(
			Math.round(8000 * Math.sin((2 * Math.PI * frequency * i) / rate)),
			44 + i * 2,
		);
	return wav;
}

/** The uniform 240-bar envelope the player draws, one per sound. */
const peaksFor = (tone) =>
	Array.from(
		{ length: 240 },
		(_, index) => 0.2 + 0.7 * Math.abs(Math.sin(index / (9 + (tone % 3)))),
	);

export function writeSoundsFixture(
	root,
	expiredUrl = "http://127.0.0.1:9/expired-signed-audio?expired=1",
) {
	const attachments = join(root, "attachments");
	mkdirSync(attachments, { recursive: true });
	const sounds = Array.from({ length: SOUNDS_COUNT }, (_, tone) => {
		const bytes = soundSample(tone);
		const digest = createHash("sha256")
			.update(bytes)
			.digest("hex")
			.slice(0, 32);
		const peaks = peaksFor(tone);
		writeFileSync(join(attachments, `${digest}.bin`), bytes);
		writeFileSync(
			join(attachments, `${digest}.json`),
			JSON.stringify({
				digest,
				mime_type: "audio/wav",
				bytes: bytes.length,
				duration_s: 12,
				peaks,
			}),
		);
		writeFileSync(
			join(attachments, `${digest}.peaks.json`),
			JSON.stringify({ version: 1, bars: 240, peaks }),
		);
		return {
			attachment: digest,
			mime: "audio/wav",
			title: tone === 5 ? SOUNDS_LONG_TITLE : `Storm swell ${tone + 1}`,
			duration_s: 12,
			bytes,
			peaks,
		};
	});
	const first = sounds[0];
	/*
	 * ONE PICTURE, FOR THE LIBRARY GRID'S NEGATIVE CONTROL. The grid must show
	 * that an image card mounts no sound player; a catalog of one audio asset
	 * cannot state that. The bytes are a real 1x1 PNG so the thumbnail route has
	 * something to serve, and the tool result names a material the transcript
	 * already knows (`generate_image`), so the same session carries both cards.
	 */
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
		"base64",
	);
	const imageDigest = createHash("sha256")
		.update(png)
		.digest("hex")
		.slice(0, 32);
	writeFileSync(join(attachments, `${imageDigest}.bin`), png);
	writeFileSync(
		join(attachments, `${imageDigest}.json`),
		JSON.stringify({
			digest: imageDigest,
			mime_type: "image/png",
			bytes: png.length,
			width: 1,
			height: 1,
		}),
	);
	const message = (id, role, content, extra = {}) => ({
		id,
		ts: 1792260000,
		type: "message",
		payload: { kind: "message", role, content, ...extra },
	});
	const rows = [
		message("sounds-user", "user", [{ text: "Make a short storm sound." }]),
		message("sounds-call", "assistant", [], {
			tool_calls: [
				{
					tool_call_id: "sounds-call-1",
					tool_name: "generate_sound_effect",
					arguments: { prompt: "Storm swell" },
				},
			],
		}),
		message(
			"sounds-result",
			"tool",
			[
				{ text: "Storm swell" },
				{
					kind: "audio",
					content_type: "audio/wav",
					attachment: first.attachment,
					mime_type: "audio/wav",
					name: "Storm swell.wav",
					duration_s: 12,
					source_url: expiredUrl,
				},
			],
			{
				tool_call_id: "sounds-call-1",
				tool_name: "generate_sound_effect",
				provider_payload: { duration_s: 1 },
			},
		),
		message("sounds-image-call", "assistant", [], {
			tool_calls: [
				{
					tool_call_id: "sounds-image-1",
					tool_name: "generate_image",
					arguments: { prompt: "Storm cover" },
				},
			],
		}),
		message(
			"sounds-image-result",
			"tool",
			[
				{ text: "Storm cover" },
				{
					kind: "image",
					content_type: "image/png",
					attachment: imageDigest,
					mime_type: "image/png",
					name: "Storm cover.png",
				},
			],
			{
				tool_call_id: "sounds-image-1",
				tool_name: "generate_image",
			},
		),
		message("sounds-answer", "assistant", [
			{ text: "Here is the storm swell." },
		]),
		{
			id: "sounds-highlights",
			ts: 1792260001,
			type: "custom",
			payload: {
				custom_type: "supplement_v1",
				details: {
					anchor: "sounds-answer",
					state: "done",
					rev: 1,
					// ONE row listing ALL of them, in the producer's own order:
					// the row is the unit the UI renders, and a page of separate
					// rows would not exercise the collage at all.
					sounds: sounds.map((sound) => ({
						attachment: sound.attachment,
						mime: sound.mime,
						title: sound.title,
						duration_s: sound.duration_s,
					})),
				},
			},
		},
	];
	const writeSession = (sessionId, sessionRows) => {
		const dir = join(root, "sessions", sessionId);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "transcript.jsonl"),
			`${sessionRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
		);
	};
	writeSession(SOUNDS_SESSION, rows);
	/*
	 * THE SINGLE-SOUND ARM: one call, one sound, one supplement row - the shape
	 * the collage must NOT put in a multi-column template.
	 */
	const singleRows = [
		message("single-user", "user", [{ text: "One thunderclap." }]),
		message("single-call", "assistant", [], {
			tool_calls: [
				{
					tool_call_id: "single-call-1",
					tool_name: "generate_sound_effect",
					arguments: { prompt: "Thunderclap" },
				},
			],
		}),
		message(
			"single-result",
			"tool",
			[
				{ text: "Thunderclap" },
				{
					kind: "audio",
					content_type: "audio/wav",
					attachment: first.attachment,
					mime_type: "audio/wav",
					name: "Thunderclap.wav",
					duration_s: 12,
				},
			],
			{
				tool_call_id: "single-call-1",
				tool_name: "generate_sound_effect",
			},
		),
		message("single-answer", "assistant", [{ text: "One thunderclap." }]),
		{
			id: "single-highlights",
			ts: 1792260001,
			type: "custom",
			payload: {
				custom_type: "supplement_v1",
				details: {
					anchor: "single-answer",
					state: "done",
					rev: 1,
					sounds: [
						{
							attachment: first.attachment,
							mime: first.mime,
							title: "Thunderclap",
							duration_s: 12,
						},
					],
				},
			},
		},
	];
	writeSession(SOUNDS_SINGLE_SESSION, singleRows);
	/*
	 * THE EMPTY ARM: a supplement row that carries no files, components or
	 * sounds. The block's own rule is that such a row paints NOTHING - this
	 * seeds the wire shape so the scene can state that from the real DOM.
	 */
	const emptyRows = [
		message("empty-user", "user", [{ text: "Nothing to see." }]),
		message("empty-answer", "assistant", [{ text: "No artifacts came out." }]),
		{
			id: "empty-highlights",
			ts: 1792260001,
			type: "custom",
			payload: {
				custom_type: "supplement_v1",
				details: { anchor: "empty-answer", state: "done", rev: 1 },
			},
		},
	];
	writeSession(SOUNDS_EMPTY_SESSION, emptyRows);
	return {
		digest: first.attachment,
		digests: sounds.map((sound) => sound.attachment),
		imageDigest,
		longTitle: SOUNDS_LONG_TITLE,
		sessionId: SOUNDS_SESSION,
		singleSessionId: SOUNDS_SINGLE_SESSION,
		emptySessionId: SOUNDS_EMPTY_SESSION,
		bytes: first.bytes.length,
		sounds,
	};
}
