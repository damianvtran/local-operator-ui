#!/usr/bin/env node
/**
 * Writes one synthetic session into a scratch config dir, so the app has a real
 * transcript to render while the window mode is measured.
 *
 *     node seed.mjs <scratch-root>
 *
 * The shapes come from the backend source, not from a guess: a session
 * directory is 12 lowercase hex (the renderer's own `SESSION_ID` is the tighter
 * of the two contracts), and `transcript.jsonl` carries one JSON object per
 * line with a `type` and a `payload`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const SESSION = "a1a1a1a1a1a1";
const root = process.argv[2];
if (!root) {
	console.error("usage: seed.mjs <scratch-root>");
	process.exit(1);
}
const CONFIG = join(resolve(root), "config");
if (CONFIG === join(homedir(), ".local-operator")) {
	console.error("refusing to seed into the live config dir");
	process.exit(1);
}

const row = (ts, role, text) => ({
	id: Math.random().toString(16).slice(2).padEnd(32, "0"),
	ts,
	type: "message",
	payload: { kind: "message", role, content: [{ text }] },
});

const dir = join(CONFIG, "sessions", SESSION);
mkdirSync(dir, { recursive: true });
const started = Math.floor(Date.now() / 1000) - 60;
writeFileSync(
	join(dir, "transcript.jsonl"),
	`${[
		row(started, "user", "Headless window check: this row is seeded on purpose"),
		row(started + 5, "assistant", "Rendered from the real app in headless mode."),
	]
		.map((r) => JSON.stringify(r))
		.join("\n")}\n`,
);
console.log(SESSION);
