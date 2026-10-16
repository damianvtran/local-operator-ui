#!/usr/bin/env node
/**
 * THE `skill-seal` SCENE'S FIXTURE: a synthetic transcript whose user rows are
 * the PAYLOADS a `$name` send persists.
 *
 * The seal's evidence has to run against the real stack the way the rail's and
 * the image card's do (`transcript-rail-fixture.mjs`, `imagegen-card-fixture.mjs`):
 * the daemon derives the page from a journal on disk, the app paints what it
 * reads back, and nothing on screen is stubbed. This script writes that
 * conversation into the config root the run owns BEFORE its daemon starts:
 * `sessions/<id>/transcript.jsonl`, in the journal's own row format (the shapes
 * `local-operator`'s transcript writer emits and this repo's
 * `transcript-reducer.ts` `durableRecord` reads).
 *
 * WHAT A `$name` SEND STORES, and why the fixture writes the WHOLE payload: the
 * client expands the skill and sends the rendered payload as the user's text, so
 * the raw string below IS the message on the wire -- the header sentence, the
 * `<skill>` tag, the SKILL.md file verbatim and the request. Two of them, picked
 * for the two rules the row owns:
 *
 *   - `seal-demo`, whose `description:` is a FOLDED BLOCK SCALAR (`>-` over two
 *     indented lines) -- the shape shipped skills actually use, and the one the
 *     row must fold onto ONE line rather than decline (this PR's D3').
 *   - `seal-audit`, whose description is long enough to clip, so the frame and
 *     the reading carry the truncation case.
 *
 * THE PAYLOADS ARE PINNED TO THE WRITER, not retyped blind: `scripts/skill-row.test.mjs`
 * renders the same two SKILL.md files through the app's own
 * `renderSkillInvocation` and asserts these strings byte for byte, so a writer
 * that drifts fails that suite rather than quietly photographing an old format.
 *
 * Usage: node scripts/skill-seal-fixture.mjs <config_dir>
 *
 * The scene's full command line (daemon + token + driver) is the scene's own doc
 * block in `scripts/renderer-driver.mjs`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isEntryPoint } from "./entry-point.mjs";

/** The conversation this fixture writes; the scene opens it by this id. */
export const SKILL_SEAL_SESSION = "1a9efacade02";

/** `seal-demo`'s SKILL.md: a FOLDED description, the shape shipped skills use. */
export const SEAL_DEMO_SKILL =
	"---\nname: seal-demo\ndescription: >-\n  Review a diff for the seal demo\n  and say what breaks\n---\n\n# Seal demo\n\nAnswer with one line.\n";
/** `seal-audit`'s SKILL.md: a description long enough to clip on the row. */
export const SEAL_AUDIT_SKILL =
	"---\nname: seal-audit\ndescription: Audit this branch for the riskiest change, name the one file a reviewer should read first, and say what would have to be true for that file to be safe\n---\n\n# Seal audit\n\nName the riskiest file, then say what would make it safe.\n";
/** The rendered payload of `$seal-demo review the diff`, as the composer builds it. */
export const SEAL_DEMO_PAYLOAD =
	'The user invoked the `seal-demo` skill directly. Follow it for this request. Its reference files, if any, are listed at the end of the body and are read with `skill://<name>/<path>`.\n<skill name="seal-demo" invocation="$seal-demo review the diff">\n---\nname: seal-demo\ndescription: >-\n  Review a diff for the seal demo\n  and say what breaks\n---\n\n# Seal demo\n\nAnswer with one line.\n\n</skill>\nreview the diff';
/** The rendered payload of `$seal-audit audit this branch`. */
export const SEAL_AUDIT_PAYLOAD =
	'The user invoked the `seal-audit` skill directly. Follow it for this request. Its reference files, if any, are listed at the end of the body and are read with `skill://<name>/<path>`.\n<skill name="seal-audit" invocation="$seal-audit audit this branch">\n---\nname: seal-audit\ndescription: Audit this branch for the riskiest change, name the one file a reviewer should read first, and say what would have to be true for that file to be safe\n---\n\n# Seal audit\n\nName the riskiest file, then say what would make it safe.\n\n</skill>\naudit this branch';

/**
 * `seal-audit`'s description as ONE line, exported so the scene asserts the
 * clipped row's `title` against the sentence the FIXTURE seeded.
 *
 * The first version of that check compared `title.length > text.length`, which
 * can never hold when the title is the whole sentence and the visible text is
 * its prefix - it reported a product defect where there was none (design round
 * 1's note on this PR's own evidence run).
 */
export const SEAL_AUDIT_PURPOSE =
	"Audit this branch for the riskiest change, name the one file a reviewer should read first, and say what would have to be true for that file to be safe";

/**
 * `seal-steps`'s SKILL.md: a body at the length shipped skills actually run
 * (17-156 lines, measured over the skill library).
 *
 * WHY THE FIXTURE CARRIES ONE (design round 1, D1). The first version of this
 * fixture seeded a one-line body, and that is exactly the case that HID the
 * defect: an uncapped block only grows tall once the body is long enough to
 * matter, and then it pushes its own row - and the reader's request under it -
 * out of the scroller. The frames that prove the cap have to seed the shape
 * that needs it.
 */
export const SEAL_STEPS_SKILL = `---\nname: seal-steps\ndescription: Walk the forty steps this skill performs, in order\n---\n\n# Seal steps\n\n${Array.from(
	{ length: 40 },
	(_, index) =>
		`Step ${index + 1}: read the file, then write one line about it.`,
).join("\n")}\n`;
/** The rendered payload of a 40-step invocation. */
export const SEAL_STEPS_PAYLOAD = `The user invoked the \`seal-steps\` skill directly. Follow it for this request. Its reference files, if any, are listed at the end of the body and are read with \`skill://<name>/<path>\`.\n<skill name="seal-steps" invocation="$seal-steps walk the steps">\n${SEAL_STEPS_SKILL}\n</skill>\nwalk the steps`;

const BASE_TS = 1781500000; // epoch seconds; ~2026-06-15, increasing across the log

const user = (id, ts, text) => ({
	id,
	ts,
	type: "message",
	payload: { kind: "message", role: "user", content: [{ text }] },
});

const assistant = (id, ts, text) => ({
	id,
	ts,
	type: "message",
	payload: { kind: "message", role: "assistant", content: [{ text }] },
});

/** The three invocations, each answered, so the pane is an ordinary conversation. */
export function journalRows() {
	const rows = [];
	let ts = BASE_TS;
	ts += 20;
	rows.push(user("e-seal-u1", ts, SEAL_DEMO_PAYLOAD));
	ts += 15;
	rows.push(
		assistant("e-seal-a1", ts, "Read it. One thing to fix, one to watch."),
	);
	ts += 20;
	rows.push(user("e-seal-u2", ts, SEAL_AUDIT_PAYLOAD));
	ts += 15;
	rows.push(
		assistant("e-seal-a2", ts, "The riskiest file is the one that moves."),
	);
	ts += 20;
	rows.push(user("e-seal-u3", ts, SEAL_STEPS_PAYLOAD));
	ts += 15;
	rows.push(assistant("e-seal-a3", ts, "Forty steps, no detours."));
	return rows;
}

/** Write the journal into the config root; report what went. */
export function writeSkillSealFixture(root) {
	const dir = join(root, "sessions", SKILL_SEAL_SESSION);
	mkdirSync(dir, { recursive: true });
	const rows = journalRows();
	const path = join(dir, "transcript.jsonl");
	writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
	return { path, rows: rows.length };
}

/*
 * The shared entry-point helper, not `process.argv[1]?.endsWith(...)`: through a
 * symlinked directory the lexical comparison is the silent no-op
 * `entry-point.test.mjs` scans for, and a fixture that never runs exits 0.
 */
if (isEntryPoint(import.meta.url)) {
	const root = process.argv[2];
	if (!root) {
		console.error("usage: node scripts/skill-seal-fixture.mjs <config_dir>");
		process.exit(2);
	}
	const written = writeSkillSealFixture(root);
	console.log(
		`wrote ${written.rows} rows for ${SKILL_SEAL_SESSION} -> ${written.path}`,
	);
}
