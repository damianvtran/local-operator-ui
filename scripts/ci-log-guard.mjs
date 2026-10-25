#!/usr/bin/env node
/*
 * A log line that carries a payload is a log nobody can read.
 *
 * WHY THIS EXISTS, with the measurements rather than the theory:
 *
 *  - Desktop Tests shard 2/3 was cancelled at its 50-minute cap on three runs
 *    (40160038927, 40169799731, 40169840176). The one whose log survived is a
 *    6,196-line file of which ONE line is 8,264,707 bytes: a stack frame naming
 *    a `data:text/javascript;base64,...` module specifier
 *    (`scripts/completion-view-ack.test.mjs`, fixed in #1407). Two of the three
 *    runs' logs were never stored at all (the blob is absent), so nothing can
 *    be read from them.
 *  - The class outlived that fix: a later GREEN run of the same shard
 *    (40181028498, job 121131988804) still contains two lines of 3,933,710 and
 *    3,933,712 bytes, both `at probeTarget(s) (data:text/javascript;base64,...)`
 *    frames from `scripts/link-actions.test.mjs`.
 *  - So the ceiling is not the finding and the enormous line is the finding.
 *    The 2026-10-25 raise to 75 minutes made the next real stall take 75
 *    minutes to report; it is reverted beside this file.
 *
 * THE TWO RULES, and they answer different questions:
 *
 *  1. `data-uri` - a `data:` URI in a log line AT ALL, whatever its size. A
 *     900 KB base64 payload in a log is as useless to a reader as a 4 MB one,
 *     and a size-only rule lets it through until it happens to grow past the
 *     threshold. The rule encoded here is "binary payloads do not belong in
 *     logs", which is what the incident was.
 *  2. `oversized-line` - any single line above the cap (1 MiB by default), as a
 *     backstop for a payload that is not a `data:` URI. Ordinary long lines are
 *     nowhere near it: the suite's own TAP summary and its longest ordinary
 *     stack frames are hundreds of bytes.
 *
 * WHERE THE LINE IS DRAWN BETWEEN "LOG" AND "SOURCE", stated because it is the
 * judgement this guard makes: it reads LOG FILES ONLY. It never scans
 * `scripts/**`, so the ~302 test scripts that import an esbuild bundle through
 * a `data:` specifier are invisible to it - that is a known class, listed on
 * the PR that introduced this guard, not a finding here. What it catches is a
 * data URI that REACHED OUTPUT, because output is what the runner streams and
 * what a reader has to be able to read. A log line that is visibly a quoted
 * SOURCE statement (a ` 12 | await import("data:...")` code frame, or a line
 * beginning with `const`/`let`/`import`/`export`) is exempted for the same
 * reason: that is the 302-file class being echoed, not a diagnostic about it.
 *
 * WHAT IT CANNOT DO, so nobody expects it to: the scan runs as a step AFTER the
 * suite, and GitHub runs no further steps for a job cancelled at
 * `timeout-minutes`. A run that stalls on its own log output therefore cannot
 * be diagnosed by this guard - it can only be prevented from happening twice,
 * which is why the emitter is fixed rather than only detected. For a run that
 * survives, this names the file, the test and the frame in minutes.
 *
 * Usage:
 *   node scripts/ci-log-guard.mjs check <log> [<log>...] [--max-line-bytes N]
 *
 * Exit: 0 clean, 1 findings, 2 usage or unreadable input. Findings are printed
 * as `::error::` workflow commands so they surface as annotations, which do not
 * travel through the log that is being complained about.
 */
import { createReadStream, statSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;
/** How much of an offending line is quoted back. Never the payload itself. */
const EXCERPT_BYTES = 140;
/** Context lines kept for attribution. Short lines only; a payload is dropped. */
const CONTEXT_LINES = 400;
const CONTEXT_BYTES = 4096;

/* A real data URI, not the word "data:" in prose: a media type, optional
 * parameters, then the comma that starts the payload. */
const DATA_URI = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*,/i;
/* Visibly-quoted source text: a code frame with a gutter, or a statement. */
const SOURCE_CITATION =
	/^\s*(?:\d+\s*[|:]|(?:const|let|var|import|export|await|return)\b)/;
/* The test file a diagnostic names, with or without a file:// URL prefix. */
const SCRIPT_PATH = /scripts\/[A-Za-z0-9._/-]+\.m?js/;
const SUBTEST = /# Subtest: (.+)$/;
const FRAME = /at\s+([A-Za-z0-9_$.[\]]+)\s+\(data:/;

/** `1234567` -> `8,264,707`-style grouping, without Intl surprises in output. */
function group(value) {
	return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function excerptOf(text) {
	const flat = text
		.replace(/[\uFEFF\r\n\t]+/g, " ")
		.replace(/\p{Cc}/gu, "")
		.trim();
	return flat.length <= EXCERPT_BYTES
		? flat
		: `${flat.slice(0, EXCERPT_BYTES)}…`;
}

/**
 * Read one log file without ever holding a whole line: a payload line is
 * buffered only up to the cap, while its true byte length is still counted.
 * Attribution needs the lines BEFORE the finding, so a short ring of them is
 * kept; anything longer than CONTEXT_BYTES is dropped from that ring rather
 * than retained twice.
 */
async function scanFile(path, { maxLineBytes }, onFinding) {
	const lines = [];
	let lineNo = 0;
	let parts = [];
	let held = 0;
	let total = 0;
	let overflow = false;

	const finish = () => {
		lineNo += 1;
		const line = Buffer.concat(parts, held).toString("utf8");
		const bytes = total;
		parts = [];
		held = 0;
		total = 0;
		overflow = false;

		const rules = [];
		if (!SOURCE_CITATION.test(line) && DATA_URI.test(line))
			rules.push("data-uri");
		if (bytes > maxLineBytes) rules.push("oversized-line");
		for (const rule of rules) {
			onFinding({
				rule,
				file: path,
				line: lineNo,
				bytes,
				excerpt: excerptOf(line),
				script: scriptOf(line, lines),
				test: subtestOf(line, lines),
				frame: FRAME.exec(line)?.[1] ?? null,
			});
		}
		if (line.length <= CONTEXT_BYTES) {
			lines.push(line);
			if (lines.length > CONTEXT_LINES) lines.shift();
		}
	};

	const stream = createReadStream(path, { highWaterMark: 1 << 16 });
	for await (const chunk of stream) {
		let start = 0;
		for (;;) {
			const newline = chunk.indexOf(10, start);
			const end = newline === -1 ? chunk.length : newline;
			const piece = chunk.subarray(start, end);
			total += piece.length;
			if (!overflow && held + piece.length > maxLineBytes + 1) {
				/* Keep one byte past the cap so `bytes > max` is decidable and the
				 * excerpt still comes from the head; stop buffering there. */
				const room = maxLineBytes + 1 - held;
				if (room > 0) {
					parts.push(piece.subarray(0, room));
					held += room;
				}
				overflow = true;
			} else if (!overflow) {
				parts.push(piece);
				held += piece.length;
			}
			if (newline === -1) break;
			finish();
			start = newline + 1;
		}
	}
	if (total > 0 || held > 0 || overflow) finish();
}

/** Nearest test file named by the finding line, else by a line before it. */
function scriptOf(line, lines) {
	const own = SCRIPT_PATH.exec(line);
	if (own) return own[0];
	for (let i = lines.length - 1; i >= 0; i -= 1) {
		const found = SCRIPT_PATH.exec(lines[i]);
		if (found) return found[0];
	}
	return null;
}

/** Nearest TAP subtest name, which is what a reader greps for. */
function subtestOf(line, lines) {
	const own = SUBTEST.exec(line);
	if (own) return own[1].trim();
	for (let i = lines.length - 1; i >= 0; i -= 1) {
		const found = SUBTEST.exec(lines[i]);
		if (found) return found[1].trim();
	}
	return null;
}

function describe(finding) {
	const where = `${resolve(finding.file)}:${finding.line}`;
	const who = finding.script ?? "an unnamed emitter";
	const detail = finding.frame ? ` (frame \`${finding.frame}\`)` : "";
	switch (finding.rule) {
		case "data-uri":
			return `${where} logs a data: URI${detail}; nearest test file ${who}; nearest subtest ${JSON.stringify(finding.test ?? null)}; ${group(finding.bytes)}-byte line starts ${JSON.stringify(finding.excerpt)}`;
		default:
			return `${where} is one ${group(finding.bytes)}-byte line${detail}; nearest test file ${who}; nearest subtest ${JSON.stringify(finding.test ?? null)}; starts ${JSON.stringify(finding.excerpt)}`;
	}
}

function parseArgs(argv) {
	const files = [];
	let maxLineBytes = DEFAULT_MAX_LINE_BYTES;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--max-line-bytes") {
			maxLineBytes = Number(argv[++i]);
			if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes <= 0)
				throw new Error("--max-line-bytes needs a positive integer");
		} else if (arg.startsWith("-")) {
			throw new Error(`unknown argument: ${arg}`);
		} else {
			files.push(arg);
		}
	}
	return { files, maxLineBytes };
}

const argv = process.argv.slice(2);
if (argv[0] === "check") argv.shift();
let options;
try {
	options = parseArgs(argv);
} catch (error) {
	console.error(`ci-log-guard: ${error.message}`);
	console.error(
		"usage: node scripts/ci-log-guard.mjs check <log> [<log>...] [--max-line-bytes N]",
	);
	process.exit(2);
}
if (options.files.length === 0) {
	console.error("ci-log-guard: no log files named");
	process.exit(2);
}

const findings = [];
for (const file of options.files) {
	try {
		statSync(file);
	} catch {
		console.error(`ci-log-guard: cannot read ${file}`);
		process.exit(2);
	}
	await scanFile(file, options, (finding) => findings.push(finding));
}

const counts = findings.reduce((tally, finding) => {
	tally[finding.rule] = (tally[finding.rule] ?? 0) + 1;
	return tally;
}, {});
for (const finding of findings) {
	console.log(`::error::ci-log-guard [${finding.rule}] ${describe(finding)}`);
}
if (findings.length === 0) {
	console.log(
		`ci-log-guard: clean (${options.files.length} log${options.files.length === 1 ? "" : "s"}, ` +
			`no line over ${group(options.maxLineBytes)} B, no data: URI)`,
	);
	process.exit(0);
}
console.log(
	`ci-log-guard: ${findings.length} finding(s) in ${options.files.length} file(s) ` +
		`(${Object.entries(counts)
			.map(([rule, count]) => `${rule}=${count}`)
			.join(
				", ",
			)}); a payload line makes the log unreadable — import the bundle from a file instead of a data: URI, or truncate the diagnostic before printing it`,
);
process.exit(1);
