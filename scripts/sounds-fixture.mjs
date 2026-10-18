import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SOUNDS_SESSION = "50a0facade01";
/** Non-silent PCM proves that graph silence is routing, not a silent fixture. */
export function soundSample() {
	const rate = 8000;
	const seconds = 12;
	const samples = rate * seconds;
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
			Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / rate)),
			44 + i * 2,
		);
	return wav;
}
export function writeSoundsFixture(
	root,
	expiredUrl = "http://127.0.0.1:9/expired-signed-audio?expired=1",
) {
	const bytes = soundSample();
	const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
	const attachments = join(root, "attachments");
	mkdirSync(attachments, { recursive: true });
	writeFileSync(join(attachments, `${digest}.bin`), bytes);
	writeFileSync(
		join(attachments, `${digest}.json`),
		JSON.stringify({
			digest,
			mime_type: "audio/wav",
			bytes: bytes.length,
			duration_s: 12,
			peaks: Array.from(
				{ length: 240 },
				(_, i) => 0.2 + 0.7 * Math.abs(Math.sin(i / 9)),
			),
		}),
	);
	writeFileSync(
		join(attachments, `${digest}.peaks.json`),
		JSON.stringify({
			version: 1,
			bars: 240,
			peaks: Array.from(
				{ length: 240 },
				(_, i) => 0.2 + 0.7 * Math.abs(Math.sin(i / 9)),
			),
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
					attachment: digest,
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
					sounds: [
						{
							attachment: digest,
							mime: "audio/wav",
							title: "Storm swell",
							duration_s: 12,
						},
					],
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
	return { digest, sessionId: SOUNDS_SESSION, bytes: bytes.length };
}
