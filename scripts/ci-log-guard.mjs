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
 * what a reader has to be able to read. A `data:` URI that is QUOTED is a
 * CITATION - source text, an assertion's compared values, or its message - and
 * is exempt while it stays under `CITATION_MAX_BYTES`; a citation is a
 * reference, not a dump. A URI that is NOT quoted is how a stack frame
 * (`at fn (data:...:1:1)`) and a resolution failure write a module specifier, so
 * it is a finding at any size, and a line that says the specifier was used AS A
 * MODULE stays a finding even when quoted. This is a property of the line, not
 * a list of reporter renderings: TAP prefixes every one of those lines with
 * `# `, so the prefix is stripped before the property is read.
 *
 * WHAT IT CANNOT DO, said plainly because the alternative is overstating it:
 * the scan is a step AFTER the suite, and a job cancelled at its own
 * `timeout-minutes` runs no further steps - so a recurrence big enough to stall
 * the JOB is precisely the case this cannot scan. That is why the suite step
 * carries a lower ceiling than the job (45 against 50): a stall ends at the
 * step, the job continues, and this reads the truncated tee file. Either way
 * the prevention is the emitter fix, not this scan.
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
/* TAP's reporter prefixes every line a test writes with `# `, so a code frame
 * or a source echo inside a shard's log arrives as `#   12 | ...` — a rule that
 * only knows the spec-reporter shape misses every one of them. The job log also
 * wraps each line in the runner's own timestamp; the tee file does not, and the
 * guard reads both. */
const ECHO_PREFIX =
	/^(?:\uFEFF)?(?:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z\s?|#\s?)/;

/*
 * THE EXEMPTION IS A PROPERTY OF THE LINE, NOT A LIST OF REPORTER SHAPES.
 *
 * Two review rounds landed on the same defect: the rule was a list of renderings
 * (spec-reporter code frame, then TAP's `# `-prefixed ones), and each round found
 * a shape the list had not been taught - the last one being TAP's `error:`
 * scalar, which quotes an assertion's own message (`  error: "…'data:…'…"`).
 * Enumerating renderings cannot converge, because the reporters are not the
 * surface this guard exists to protect; READABILITY is.
 *
 * So the rule is the one property every real false positive shared: the `data:`
 * URI is a CITATION - it sits inside matching quotes, which is how source text,
 * an assertion's compared values, and its message all write a value they are
 * quoting. A citation is exempt up to CITATION_MAX_BYTES, because a citation is
 * a reference and not a dump; past that bound, quotes or not, it is a payload.
 *
 * A URI that is NOT enclosed in quotes is the hazard, whatever surrounds it:
 * that is how a stack frame (`at fn (data:…:1:1)`) and a resolution failure
 * write a module specifier, and it is exactly the shape of the incident on both
 * sides of this file. Those are findings at any size.
 */
const CITATION =
	/(['"`])(data:[a-z0-9.+-]+\/[a-z0-9.+-]*(?:;[a-z0-9=.+-]+)*,[^'"`\s]*)\1/gi;
/* Every URI-shaped run on the line, quoted or not, for the "all of them?" test. */
const ANY_DATA_URI =
	/data:[a-z0-9.+-]+\/[a-z0-9.+-]*(?:;[a-z0-9=.+-]+)*,[^\s'"`)]*/gi;
/* A diagnostic that says the specifier was USED AS A MODULE keeps failing, even
 * when the message quotes it: its subject is the module, not a value. */
const MODULE_RESOLUTION =
	/Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|cannot import|imported from|Failed to resolve|does not provide an export/i;
/* How long a quoted citation may be before it is a payload wearing quotes. */
const CITATION_MAX_BYTES = 4096;

/* The test file a diagnostic names, with or without a file:// URL prefix. */
const SCRIPT_PATH = /scripts\/[A-Za-z0-9._/-]+\.m?js/;
const SUBTEST = /# Subtest: (.+)$/;
const FRAME = /at\s+([A-Za-z0-9_$.[\]]+)\s+\(data:/;

/** `1234567` -> `8,264,707`-style grouping, without Intl surprises in output. */
function group(value) {
	return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Is every data: URI on this line a bounded, quoted citation? */
function isQuotation(line) {
	/* Two prefixes can stack: the runner's timestamp, then TAP's `# `. */
	const body = line.replace(ECHO_PREFIX, "").replace(ECHO_PREFIX, "");
	if (MODULE_RESOLUTION.test(body)) return false;
	const citations = [...body.matchAll(CITATION)];
	if (citations.length === 0) return false;
	/* One unquoted URI among them makes the line a diagnostic, not a citation. */
	if ([...body.matchAll(ANY_DATA_URI)].length !== citations.length)
		return false;
	return citations.every(([, , uri]) => uri.length <= CITATION_MAX_BYTES);
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
		if (!isQuotation(line) && DATA_URI.test(line)) rules.push("data-uri");
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
