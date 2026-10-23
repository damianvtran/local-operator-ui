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
			title: `Storm swell ${tone + 1}`,
			duration_s: 12,
			bytes,
			peaks,
		};
	});
	const first = sounds[0];
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
	const dir = join(root, "sessions", SOUNDS_SESSION);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "transcript.jsonl"),
		`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
	);
	return {
		digest: first.attachment,
		digests: sounds.map((sound) => sound.attachment),
		sessionId: SOUNDS_SESSION,
		bytes: first.bytes.length,
		sounds,
	};
}
