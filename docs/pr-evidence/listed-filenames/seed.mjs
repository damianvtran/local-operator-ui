// Seed the synthetic sessions for this evidence into the ISOLATED config root,
// with every introducer pointing under this rig's scratch fixture root.
// argv: <configDir> <fixtureRoot>. Prints the session ids, in capture order.
//
// Round 1 (review F4) added the NEGATIVE states: a listed file that is not on
// disk, and sentence items. A listed name links only when the disk says
// `<dir>/<name>` exists, so the fixture writes exactly the files each frame
// claims: `present/` holds both deliverables (and `parse.ts`, so the sentence
// item ending in it is a sentence, not a missing file), `partial/` only the PDF.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [config, root] = process.argv.slice(2);
if (!config || !root)
	throw new Error("usage: seed.mjs <configDir> <fixtureRoot>");
const PDF = "Radient-IP-Scope-for-Counsel-2026-10-27.pdf";
const DOCX = "Radient-IP-Scope-for-Counsel-2026-10-27 (editable).docx";
const present = join(root, "present");
const partial = join(root, "partial");
for (const dir of [present, partial]) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, PDF), "%PDF-1.4\n%%EOF\n");
}
writeFileSync(join(present, DOCX), "PK synthetic docx placeholder");
writeFileSync(join(present, "parse.ts"), "export {};\n");
const final = (dir) =>
	`Both documents are ready.\n\nFiles are in \`${dir}/\`:\n- ${PDF}\n- ${DOCX}`;
const SESSIONS = [
	["5eed1157abcd", "final", final(present)],
	[
		"5eed1157ab27",
		"screenshot-1227",
		`Files are in \`${present}/\`:\n- ${PDF}\n- ${DOCX} — the same text without the Radient styling, so the lawyers can mark it up`,
	],
	["5eed1157ab0d", "missing", final(partial)],
	[
		"5eed1157ab5e",
		"sentence",
		`Changes in \`${present}/\`:\n- Fixed the parser in parse.ts\n- I wrote ${PDF}`,
	],
];
const id = () => randomBytes(16).toString("hex");
const t0 = Date.now() / 1000 - 600;
SESSIONS.forEach(([sessionId, label, text], index) => {
	const s = join(config, "sessions", sessionId);
	mkdirSync(s, { recursive: true });
	const t = t0 + index * 60;
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
			id: id(),
			ts: t + 30,
			type: "message",
			payload: { kind: "message", role: "assistant", content: [{ text }] },
		},
	];
	writeFileSync(
		join(s, "transcript.jsonl"),
		`${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
	);
	writeFileSync(join(s, "created_at.json"), JSON.stringify(t));
	writeFileSync(join(s, "desktop.json"), JSON.stringify({ cwd: root }));
	writeFileSync(
		join(s, "title.json"),
		JSON.stringify({
			text: `Listing fixture: ${label}`,
			user_set: true,
			names: [`Listing fixture: ${label}`],
		}),
	);
});
console.log(
	SESSIONS.map(([sessionId, label]) => `${sessionId}:${label}`).join(","),
);
