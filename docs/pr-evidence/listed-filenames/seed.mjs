// Seed ONE synthetic session into the isolated config root: a user turn and the
// reported assistant turn, with the introducer pointing at this rig's scratch dir.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [config, dir] = process.argv.slice(2);
const sessionId = "5eed1157abcd";
const s = join(config, "sessions", sessionId);
mkdirSync(s, { recursive: true });
const id = () => randomBytes(16).toString("hex");
const t = Date.now() / 1000 - 120;
const text = `Both documents are ready.\n\nFiles are in \`${dir}/\`:\n- Radient-IP-Scope-for-Counsel-2026-10-27.pdf\n- Radient-IP-Scope-for-Counsel-2026-10-27 (editable).docx`;
const rows = [
	{
		id: id(),
		ts: t,
		type: "message",
		payload: {
			kind: "message",
			role: "user",
			content: [
				{
					text: "Write up the IP scope for counsel as a PDF and an editable docx.",
				},
			],
		},
	},
	{
		id: "023a2908141445e0bff1d0a08932e33d",
		ts: t + 60,
		type: "message",
		payload: { kind: "message", role: "assistant", content: [{ text }] },
	},
];
writeFileSync(
	join(s, "transcript.jsonl"),
	`${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
);
writeFileSync(join(s, "created_at.json"), JSON.stringify(t));
writeFileSync(join(s, "desktop.json"), JSON.stringify({ cwd: dir }));
writeFileSync(
	join(s, "title.json"),
	JSON.stringify({
		text: "Directory listing fixture",
		user_set: false,
		names: ["Directory listing fixture"],
	}),
);
console.log(sessionId);
