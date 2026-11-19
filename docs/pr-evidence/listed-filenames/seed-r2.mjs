// Seed the ROUND-2 (review R2-1) session: message A lists two deliverables
// under an introducing directory, and the files are NOT written yet. The rig
// (capture-r2.mjs) writes them later and appends message B.
// argv: <configDir> <fixtureDir> <sessionId>. Prints the session id.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [config, dir, session] = process.argv.slice(2);
if (!config || !dir || !session)
	throw new Error("usage: seed-r2.mjs <configDir> <fixtureDir> <sessionId>");
const s = join(config, "sessions", session);
mkdirSync(s, { recursive: true });
const t = Date.now() / 1000 - 600;
const rows = [
	{
		id: "r2a00000000000000000000000000000001",
		ts: t,
		type: "message",
		payload: {
			kind: "message",
			role: "user",
			content: [{ text: "Write the report and the spreadsheet." }],
		},
	},
	{
		id: "r2a00000000000000000000000000000002",
		ts: t + 30,
		type: "message",
		payload: {
			kind: "message",
			role: "assistant",
			content: [
				{
					text: `I'll write the deliverables to \`${dir}/\`:\n- report.pdf\n- data.xlsx`,
				},
			],
		},
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
		text: "R2-1: listed before the files exist",
		user_set: true,
		names: ["R2-1: listed before the files exist"],
	}),
);
console.log(session);
