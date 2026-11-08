#!/usr/bin/env node
/**
 * Fail-closed, base-aware guard for literal UI copy outside the original
 * JSX-text/literal-attribute inventory. It deliberately has NO baseline: only
 * findings whose literal starts on an added diff line fail, while the existing
 * shrink-only ratchet continues to govern the old shapes and historical debt.
 * There is still no stored list of accepted text: what follows is provenance,
 * proven per literal and at check time, from the comparison base's own tree.
 *
 * RESTORED CONTENT. An added line can re-introduce copy the base branch already
 * carried: reverting a translation-keying pull request re-adds exactly the
 * literals that pull request removed, and charging those as newly authored copy
 * makes a revert structurally impossible (the only escape was a pragma per
 * literal). So a finding is RESTORED - reported, never counted as new - when the
 * base tree proves the literal already existed, by either source:
 *   A. the same path, verbatim: `git show <base>:<path>` contains the finding's
 *      exact source span, quotes included;
 *   B. the de-keying move in the SAME file: this very diff removes a
 *      `t("<key>")` call from the file the finding sits in, and the base English
 *      catalogue message for that key carries the finding's normalized words as
 *      a bounded run. The proof is the removal, so source B reaches copy this
 *      change stopped translating and nothing wider: punctuation, line wrapping
 *      and the rendered value of a leading count may drift between the message
 *      and the re-added literal, while a file the change never un-keyed - and a
 *      new file, which carries no removed call at all - can never qualify.
 * Anything neither source proves is NOT restored and still fails. Absence of
 * evidence, an ambiguous lookup, an unreadable base tree or an unparseable base
 * catalogue is a failure, never a silent pass.
 *
 * Two boundaries are stated rather than left implied:
 *   (a) source B's residue is the de-keying move itself: a file that un-keys a
 *       message and re-adds that message's words is accepted, because that is
 *       exactly the revert the allowance exists to permit. A literal whose words
 *       merely appear somewhere in the English catalogue is NOT accepted - that
 *       was a vocabulary-wide allowance rather than a revert allowance, and it
 *       vouched for short new labels such as `Retry` and `Search` that any
 *       unrelated catalogue happens to carry. Every acceptance prints its own
 *       `RESTORED:` line naming the un-keyed key and the catalogue file that
 *       holds the message. The haystack is English MESSAGE values only. The
 *       `*.context.json` sidecars beside those messages are translator notes
 *       (register, style and width prose about a key), and a note is not
 *       evidence that the UI ever shipped that string, so they are filtered out
 *       of the base listing: a literal lifted out of a note is newly authored
 *       copy and still fails;
 *   (b) git history is deliberately NOT consulted. CI checks the merge out with
 *       `fetch-depth: 2`, and the versions a revert restores can sit thousands
 *       of commits behind base, so a restore whose base-tree counterpart drifted
 *       in wording fails closed here instead of being rescued from `git log`.
 *
 * Covered additions:
 *   - copy-valued object properties such as `{ label: "New chat" }`;
 *   - expression-valued copy attributes such as `aria-label={"New chat"}`;
 *   - static literal arms of conditionals, logical fallbacks and `+`
 *     concatenations, plus literal spans of template expressions in either sink;
 *   - static text in JSX expression containers, including logical branches;
 *   - a TEMPLATE in a plain `const X = …`, `return …` or array-literal element
 *     under `src/renderer/` (the `template:` sinks). This is the one shape the
 *     ratchet (`check-strings.mjs`) deliberately leaves out: measured at this
 *     head, 234 such templates in 108 renderer files carry a letter and most of
 *     them are ids, URLs, units and CSS, so listing them would put machine text
 *     in the debt ledger. An ADDED line needs no allowance, so the diff guard
 *     takes the shape instead — new copy of it cannot land, and the historical
 *     occurrences stay a stated gap rather than a silent one.
 *
 * This is a static sink check, not a claim about arbitrary runtime or server
 * text. Dynamic values, non-copy property names, and calls such as `t()` do not
 * expose a static literal to flag. Technical copy still needs the same narrow
 * `i18n: ignore <reason>` or allowlist reason as the original scanner.
 *
 * AN EXEMPTION IS PER LITERAL, ON ITS OWN LINE. A pragma silences the literal
 * whose own lines carry it and nothing else - not the rest of the JSX element
 * it sits in, which is how a reason written for one glyph used to silence its
 * siblings too (review M1/Q-2 on #1767). That is the form
 * `docs/i18n/literal-allowance.md` documents. A multi-line literal is covered
 * by a pragma on any of its own lines; the enclosing element's other literals
 * are not covered by it.
 *
 * Usage: node scripts/i18n/check-added-strings.mjs [--base origin/main]
 *        [--repo <path>]
 *
 * `--repo` exists so the CLI can be exercised against a scratch git repo.
 * `runAddedCheck` always took a repo; `main` did not forward one, so the only
 * way to prove the CLI end to end (exit code, stdout, findings) was to run it
 * against THIS checkout. That needs the whole project inventory to parse - one
 * run measured 13.2 s on a loaded host - and it wrote a probe into the working
 * tree, whose leftover reached a commit once (#1767). A scratch repo has one
 * file per case and nothing to leave behind.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SyntaxKind } from "typescript/unstable/ast";

import {
	ALLOWLIST,
	COPY_ATTRIBUTES,
	SCAN_ROOTS,
	allowlistReason,
	collapse,
	copyTexts,
	inSpan,
	isScanned,
	lineSpan,
	loadAllowlist,
	onDataShapeSurface,
	openSnapshot,
	pragmaLines,
	staticTextNodes,
} from "./check-strings.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LETTER_RE = /\p{L}/u;
const CATALOGUE_KEY_RE = /^ui(?:\.[a-z0-9_]+)+$/;
const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const TEST_DIRECTORY_RE = /(?:^|\/)(?:__tests__|tests?)\//;
const TEST_FILE_RE = /\.(?:test|spec)\.[^.]+$/;

/**
 * Property names whose string values are product copy, not arbitrary data.
 *
 * The four native attributes are spelled out rather than spread from
 * `COPY_ATTRIBUTES`: that set also holds component-prop names (`content`,
 * `summary`, `empty`, `header`...) which are prose as JSX props but are
 * ordinary data keys in object literals elsewhere, and widening this guard
 * with them would flag unrelated added lines. Widening object-literal
 * coverage is its own measured change.
 */
export const COPY_PROPERTIES = new Set([
	"aria-label",
	"placeholder",
	"title",
	"alt",
	"label",
	"description",
	"message",
	"text",
	"tooltip",
	"helperText",
	"emptyText",
]);

function git(repo, args) {
	const result = spawnSync("git", args, {
		cwd: repo,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.error || result.status !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed: ${
				result.error?.message || result.stderr.trim() || `exit ${result.status}`
			}`,
		);
	}
	return result.stdout;
}

/** Resolve the comparison commit rather than silently accepting a missing ref. */
export function resolveComparisonBase(repo, requestedBase) {
	return git(repo, ["merge-base", requestedBase, "HEAD"]).trim();
}

/**
 * Comparison form: whitespace collapsed, and nothing else.
 *
 * Deliberately minimal. Flattening digit runs made "Max 3 attachments allowed."
 * and "Max 8 attachments allowed." compare equal, and flattening ICU braces made
 * unrelated placeholder shapes equal too - both are different copy, not
 * formatting differences. The one drift the evidence genuinely needs (a count the
 * message interpolates where the literal bakes the number in) is handled by
 * dropping ONE leading count token from the needle instead, in `copyNeedle`.
 */
function normalizeCopy(text) {
	return text.replace(/\s+/g, " ").trim();
}

/**
 * A needle keeps its words but drops one leading count token and edge
 * punctuation.
 *
 * Leading count: an ICU message renders `#` for the count where a restored
 * literal bakes the number in, so `1 reference points outside this session's
 * working directory.` restores a message `{# reference points outside this
 * session's working directory.}`. Exactly ONE token, and only at the start: a
 * count anywhere else is a different sentence and must stay different copy.
 *
 * Edge punctuation: "Done." matches "Done..." - the trailing mark is a
 * rendering difference, not other copy.
 */
const LEADING_COUNT_RE = /^[#\d]+\s+/;
const EDGE_PUNCTUATION_RE = /^[\s.,;:!?…—–-]+|[\s.,;:!?…—–-]+$/g;

function copyNeedle(text) {
	return normalizeCopy(text)
		.replace(LEADING_COUNT_RE, "")
		.replace(EDGE_PUNCTUATION_RE, "");
}

const BOUNDED_ALNUM_RE = /[\p{L}\p{N}]/u;

/**
 * True when `needle` occurs in `haystack` as a whole run: neither side of the
 * occurrence continues an alphanumeric word, or the occurrence sits at the
 * string edge. This is what stops `Search` from being satisfied by
 * `Searching conversations`, and every occurrence is scanned rather than only
 * the first, so one embedded match cannot shadow a later whole-word one.
 *
 * An empty needle is false: an empty literal proves nothing about provenance.
 */
function containsBounded(haystack, needle) {
	if (needle.length === 0) return false;
	let at = haystack.indexOf(needle);
	while (at !== -1) {
		const before = at === 0 ? undefined : haystack[at - 1];
		const afterAt = at + needle.length;
		const after = afterAt === haystack.length ? undefined : haystack[afterAt];
		const startsClean = before === undefined || !BOUNDED_ALNUM_RE.test(before);
		const endsClean = after === undefined || !BOUNDED_ALNUM_RE.test(after);
		if (startsClean && endsClean) return true;
		at = haystack.indexOf(needle, at + 1);
	}
	return false;
}

/** First seven characters of a commit id: enough to name it in evidence. */
function shortSha(sha) {
	return sha.slice(0, 7);
}

/**
 * Run git without throwing, for the calls that inspect a status themselves.
 */
function gitProbe(repo, args) {
	return spawnSync("git", args, {
		cwd: repo,
		maxBuffer: 64 * 1024 * 1024,
	});
}

const RESTORE_CATALOGUE_PREFIX = "src/i18n/catalogues/en";
/**
 * Translator-note sidecars that sit beside the English messages: prose ABOUT a
 * key (register, style, width), never a shipped string. They are not message
 * files and must never count as authored copy.
 */
const RESTORE_SIDECAR_RE = /\.context\.json$/;
const BATCH_HEADER_END = 0x0a;
/** A found object is `<oid> blob <size>`; a lookup git cannot resolve echoes
 * `<requested name> missing`. Both are matched by shape, never by field position,
 * because the requested name is a `<base>:<path>` pair that may contain spaces. */
const BLOB_RECORD_RE = /^[0-9a-f]{40,64} blob (\d+)$/;
const MISSING_RECORD_RE = / missing$/;

/**
 * Read blobs by object name through ONE `git cat-file --batch` process.
 *
 * Returns `{ type, content }` per requested name, where `type` is `"missing"`
 * when git says so: that is git's own explicit answer for `<base>:<path>` on a
 * path the base tree does not carry, so absence is never inferred from an exit
 * status (a `git show` of a path that exists on disk but not at base fails with
 * a generic fatal, which would read as a broken check rather than as absence).
 *
 * Any other shape - a short record, an ambiguous name, a non-blob - throws: a
 * lookup this guard cannot read is a failure, never a pass.
 */
function readBatchObjects(repo, names) {
	if (names.length === 0) return new Map();
	const batch = spawnSync("git", ["cat-file", "--batch"], {
		cwd: repo,
		input: names.map((name) => `${name}\n`).join(""),
		maxBuffer: 64 * 1024 * 1024,
	});
	if (batch.error || batch.status !== 0) {
		throw new Error(
			`git cat-file --batch failed: ${
				batch.error?.message ||
				batch.stderr?.toString().trim() ||
				`exit ${batch.status}`
			}`,
		);
	}
	const buffer = batch.stdout;
	const objects = new Map();
	let offset = 0;
	for (const name of names) {
		const headerEnd = buffer.indexOf(BATCH_HEADER_END, offset);
		if (headerEnd === -1) {
			throw new Error(
				`git cat-file --batch returned a short record for ${name}`,
			);
		}
		const header = buffer.subarray(offset, headerEnd).toString("utf8");
		offset = headerEnd + 1;
		if (MISSING_RECORD_RE.test(header)) {
			objects.set(name, { type: "missing", content: null });
			continue;
		}
		const blobRecord = BLOB_RECORD_RE.exec(header);
		if (blobRecord === null) {
			throw new Error(`git cat-file --batch returned "${header}" for ${name}`);
		}
		const size = Number(blobRecord[1]);
		const content = buffer.subarray(offset, offset + size).toString("utf8");
		offset += size + 1;
		objects.set(name, { type: "blob", content });
	}
	return objects;
}

/**
 * Every string value under one parsed catalogue message tree, with the dotted
 * key it belongs to.
 *
 * The key is what source B compares against: a de-keyed `t("<key>")` call names
 * one message, and matching its words against THAT message is the whole proof.
 * Message files are flat `"<key>": "<value>"` maps today; the recursion keeps a
 * nested object honest by prefixing its path rather than silently flattening two
 * different keys onto one another.
 */
function collectMessageStrings(value, key, out) {
	if (typeof value === "string") {
		out.push({ key, value });
	} else if (Array.isArray(value)) {
		for (const item of value) collectMessageStrings(item, key, out);
	} else if (value !== null && typeof value === "object") {
		for (const [childKey, item] of Object.entries(value)) {
			collectMessageStrings(item, key ? `${key}.${childKey}` : childKey, out);
		}
	}
}

/**
 * Every English MESSAGE string at `base`, as `{ path, key, value }`.
 *
 * Read from the BASE tree, not the working tree: the question is what the branch
 * this diff is compared against already shipped, and a revert deletes the very
 * catalogue file it restores copy from. The 152 `*.context.json` translator-note
 * sidecars are filtered out (154 message files remain), because a note is
 * instruction about copy rather than copy the UI ever rendered. One
 * `git cat-file --batch` process serves all blobs rather than a `git show` per
 * file. Every failure here throws: without the base catalogues the oracle
 * cannot tell restored copy from newly authored copy, and guessing is the one
 * thing this guard must never do.
 */
function readBaseCatalogue(repo, base) {
	const listing = gitProbe(repo, [
		"ls-tree",
		"-r",
		base,
		"--",
		RESTORE_CATALOGUE_PREFIX,
	]);
	if (listing.error || listing.status !== 0) {
		throw new Error(
			`git ls-tree ${base} -- ${RESTORE_CATALOGUE_PREFIX} failed: ${
				listing.error?.message ||
				listing.stderr?.toString().trim() ||
				`exit ${listing.status}`
			}`,
		);
	}
	const blobs = [];
	for (const line of listing.stdout.toString().split("\n")) {
		if (!line) continue;
		const [meta, path] = line.split("\t");
		const [, type, oid] = meta.split(" ");
		if (type !== "blob" || path === undefined) {
			throw new Error(`Unexpected base catalogue entry at ${base}: ${line}`);
		}
		if (RESTORE_SIDECAR_RE.test(path)) continue;
		blobs.push({ path, oid });
	}
	if (blobs.length === 0) return [];

	const objects = readBatchObjects(
		repo,
		blobs.map((blob) => blob.oid),
	);
	const entries = [];
	for (const blob of blobs) {
		const object = objects.get(blob.oid);
		if (object?.type !== "blob") {
			throw new Error(
				`Base catalogue ${blob.path} at ${shortSha(base)} is unreadable: ${object?.type ?? "no record"}`,
			);
		}
		let parsed;
		try {
			parsed = JSON.parse(object.content);
		} catch (error) {
			throw new Error(
				`Base catalogue ${blob.path} at ${shortSha(base)} is not valid JSON: ${error.message}`,
			);
		}
		const values = [];
		collectMessageStrings(parsed, "", values);
		for (const value of values) entries.push({ path: blob.path, ...value });
	}
	return entries;
}

/**
 * Catalogue keys whose `t("<key>")` call this diff REMOVES from one file.
 *
 * This is the whole of source B's proof, and it is deliberately textual and
 * same-line: `t(` is this codebase's translate helper, so a removed line holding
 * `t("ui.…")` is exactly the de-keying move a revert inverts. A call that wraps
 * its key onto the next line is not parsed here, which fails closed (no evidence,
 * so the literal is new) rather than guessing. `---` is the diff's own file
 * header, not a removed line.
 */
const TRANSLATE_CALL_RE = /\bt\(\s*["'](ui(?:\.[A-Za-z0-9_]+)+)["']/g;

export function unKeyedCatalogueKeys(diff) {
	const keys = new Set();
	for (const line of diff.split("\n")) {
		if (!line.startsWith("-") || line.startsWith("---")) continue;
		for (const match of line.matchAll(TRANSLATE_CALL_RE)) keys.add(match[1]);
	}
	return keys;
}

/**
 * The restore oracle for one run, created once and handed to every file's
 * extractor. Nothing is read until a candidate finding asks, so a diff with no
 * findings never touches the base tree.
 *
 * `tester(absolutePath, raw, text)` answers the evidence line for a restored
 * finding, or `undefined` meaning "not restored, still a failure": an absent
 * same-path blob, no key this diff un-keyed from that file, a key whose message
 * does not carry the words, or an empty needle.
 *
 * `raw` is the literal's exact source span (quotes included) because that is
 * what "the base file contains this literal" has to mean; `text` is the
 * collapsed literal the report shows, which source B compares against the words
 * of the one base English MESSAGE its de-keyed call named.
 */
function createRestoreTester(repo, base, unKeyedByFile) {
	const shortBase = shortSha(base);
	const baseBlobs = new Map();
	let index;

	const samePathBlob = (rel) => {
		if (!baseBlobs.has(rel)) {
			const name = `${base}:${rel}`;
			/* `missing` is git's explicit "this path is not in the base tree": the normal
			 * answer for a file the diff ADDS, and NOT evidence of provenance. */
			const object = readBatchObjects(repo, [name]).get(name);
			baseBlobs.set(rel, object.type === "blob" ? object.content : null);
		}
		return baseBlobs.get(rel);
	};

	/**
	 * Base key -> the message file and value that define it.
	 *
	 * Two files carrying one key with different English is an ambiguous lookup -
	 * which message a literal "restores" would be undefined - so it throws instead
	 * of picking one.
	 */
	const catalogueIndex = () => {
		if (index === undefined) {
			index = new Map();
			for (const entry of readBaseCatalogue(repo, base)) {
				const seen = index.get(entry.key);
				if (seen !== undefined && seen.value !== entry.value) {
					throw new Error(
						`Base English catalogue carries ${entry.key} twice with different text: ${seen.path} and ${entry.path} at ${shortBase}`,
					);
				}
				if (seen === undefined) index.set(entry.key, entry);
			}
		}
		return index;
	};

	return (absPath, raw, text) => {
		const rel = relative(repo, absPath);
		const blob = samePathBlob(rel);
		if (blob !== null && raw.length > 0 && blob.includes(raw)) {
			return `verbatim in ${rel} at ${shortBase}`;
		}
		const needle = copyNeedle(text);
		if (needle.length === 0) return undefined;
		const messages = catalogueIndex();
		/* Source B asks only about keys THIS diff un-keyed from THIS file, so a new
		 * file (no removed call) and copy that stayed keyed can never be vouched for.
		 * The catalogue is deliberately read above for every candidate with words,
		 * before the key test: an unreadable base catalogue must keep failing closed
		 * instead of being skipped whenever no de-keyed call happens to explain the
		 * literal. */
		const keys = unKeyedByFile.get(rel);
		if (keys === undefined) return undefined;
		for (const key of keys) {
			const entry = messages.get(key);
			if (entry === undefined) continue;
			if (containsBounded(normalizeCopy(entry.value), needle)) {
				return `un-keyed ${key} in ${entry.path} at ${shortBase}`;
			}
		}
		return undefined;
	};
}

/**
 * Read new-side hunk ranges. Count zero is legal and adds no lines; malformed
 * hunk headers fail closed instead of turning an unreadable diff into a pass.
 */
export function parseAddedLines(diff) {
	const added = new Set();
	let sawHunk = false;
	for (const line of diff.split("\n")) {
		if (!line.startsWith("@@")) continue;
		const match = HUNK_RE.exec(line);
		if (!match) throw new Error(`Cannot parse diff hunk header: ${line}`);
		sawHunk = true;
		const start = Number(match[1]);
		const count = match[2] === undefined ? 1 : Number(match[2]);
		for (let offset = 0; offset < count; offset += 1) {
			added.add(start + offset);
		}
	}
	return { added, sawHunk };
}

function propertyName(node) {
	if (
		node.kind === SyntaxKind.Identifier ||
		node.kind === SyntaxKind.StringLiteral
	) {
		return node.text;
	}
	return undefined;
}

/**
 * The nearest in-file declaration whose initializer holds static copy, if any.
 *
 * Walks OUT from the usage, so a name reused under the same spelling in two
 * blocks reports against the binding actually in scope at the render site rather
 * than whichever declaration the file mentions first. A declaration that binds
 * the name but holds no literal (a computed value, a `t()` call) answers
 * `undefined` and stops the walk: it shadows any outer copy const of that name,
 * which is exactly what the render site sees.
 *
 * Only block-shaped scopes are searched (block, module, source file). A const
 * hoisted into a `switch` clause or declared in a function's expression body is
 * not resolved - both are copy shapes the scanner's own corpus does not produce,
 * and accepting them here would mean claiming coverage this walker does not have.
 */
function nearestCopyDeclaration(identifier) {
	let scope = identifier.parent;
	while (scope) {
		/*
		 * Only REAL lexical scopes are searched, and the walk stops at the first
		 * one that binds the name: a copy const reused under the same spelling in
		 * two blocks is reported against the binding actually in scope at the
		 * render site, not whichever declaration the file happened to mention
		 * first.
		 */
		if (
			scope.kind === SyntaxKind.Block ||
			scope.kind === SyntaxKind.SourceFile ||
			scope.kind === SyntaxKind.ModuleBlock
		) {
			for (const statement of scope.statements) {
				if (statement.kind !== SyntaxKind.VariableStatement) continue;
				for (const declaration of statement.declarationList.declarations) {
					if (declaration.name.kind !== SyntaxKind.Identifier) continue;
					if (declaration.name.text !== identifier.text) continue;
					const initializer = declaration.initializer;
					if (initializer === undefined) return undefined;
					return staticTextNodes(initializer).length > 0
						? initializer
						: undefined;
				}
			}
		}
		scope = scope.parent;
	}
	return undefined;
}

/**
 * Find the additional copy shapes in one parsed file. `addedLines === null`
 * means a new/untracked file, for which every finding is new by construction.
 *
 * `options.restore` is the optional restore tester built by
 * `createRestoreTester`. It is an OPTIONS BAG rather than a third positional
 * argument deliberately: the template-sink coverage lands its own
 * `templateSinks` option on this same call, and a second positional addition to
 * one signature is silently dropped the first time the two are merged. Named
 * options cannot shadow each other.
 */
export function findAddedCopyViolations(
	sourceFile,
	addedLines,
	{ templateSinks = false, restore } = {},
) {
	const pragmas = pragmaLines(sourceFile);
	const findings = [];
	const isAdded = (line) => addedLines === null || addedLines.has(line);
	/**
	 * A pragma exempts exactly the literal whose OWN lines carry it.
	 *
	 * It used to also exempt every literal in the enclosing JSX element, because
	 * the element's whole span was searched for a pragma line. One glyph's reason
	 * therefore silenced its siblings: in `slash-commands.tsx` the pragma written
	 * for the `[x]` marker on its own line also covered the `[ ]` arm one line
	 * later, and the element-scoped reading was the loophole review M1/Q-2 filed
	 * on #1767 (that file's 2437-2462 span and
	 * `delegated-retention-copy.tsx`'s 50-54 were the two cases).
	 *
	 * Own-line is not a new rule invented here: `docs/i18n/literal-allowance.md`
	 * already documents the exemption as "an inline `// i18n: ignore <reason>`
	 * pragma on its own line", and the template-sink contract below says the
	 * same. The two real pragmas from that review sit inline on their literals'
	 * own lines, so they keep working unchanged - which is why this narrowing
	 * needs no source change, only the dropped element span.
	 */
	const exempt = (node) => inSpan(lineSpan(sourceFile, node), pragmas);
	/**
	 * Push one candidate. A caller with no restore tester (every existing caller
	 * and test) gets the unchanged `{ line, kind, text }` shape; with a tester a
	 * restored candidate gains the `restored` evidence string and the others keep
	 * that same unchanged shape.
	 */
	const record = (line, kind, text, literal) => {
		if (restore === undefined) {
			findings.push({ line, kind, text });
			return;
		}
		const raw = sourceFile.text.slice(
			literal.getStart(sourceFile),
			literal.getEnd(),
		);
		const evidence = restore(sourceFile.fileName, raw, text);
		if (evidence === undefined) {
			findings.push({ line, kind, text });
			return;
		}
		findings.push({ line, kind, text, restored: evidence });
	};
	const take = (node, kind) => {
		for (const literal of staticTextNodes(node)) {
			const text = collapse(literal.text);
			/* Key tables defer t() until presentation so locale switches cannot leave
			 * stale copy behind. Only property sinks may hold those keys; a raw key in
			 * JSX or an attribute is still user-visible and must remain a finding. */
			if (kind.startsWith("property:") && CATALOGUE_KEY_RE.test(text)) continue;
			const line =
				sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile))
					.line + 1;
			if (LETTER_RE.test(text) && isAdded(line) && !exempt(literal)) {
				record(line, kind, text, literal);
			}
		}
	};
	/**
	 * A JSX sink whose expression is a bare identifier.
	 *
	 * THE BLIND SPOT THIS CLOSES: a sentence kept in a module `const` and
	 * rendered as `{SECRET_CLOSURE_NOTICE}` reached neither sink this walker
	 * knew. The JSX-expression sink is an Identifier and `staticTextNodes` only
	 * reads literals, so a whole user-facing sentence could ship in English in
	 * every locale while the catalogue guard still reported zero missing keys -
	 * the string never was a key, so nothing counted it as missing.
	 *
	 * Resolved by SHAPE rather than by name: any identifier whose nearest
	 * declaration in this file holds static copy is reported at the line that
	 * renders it, which is the line a reviewer reads in the diff. There is no
	 * name blacklist and no baseline here, because either would let the next
	 * differently-spelled const through.
	 *
	 * BOUNDS, stated rather than implied: same file only. A copy const imported
	 * from another module needs that exporting file's own diff line, and
	 * widening this walker to cross-file symbols is its own measured change
	 * rather than a silent expansion of this guard's scope.
	 */
	const takeReference = (expression, kind) => {
		if (expression.kind !== SyntaxKind.Identifier) {
			take(expression, kind);
			return;
		}
		const declaration = nearestCopyDeclaration(expression);
		if (declaration === undefined) return;
		const line =
			sourceFile.getLineAndCharacterOfPosition(expression.getStart(sourceFile))
				.line + 1;
		if (!isAdded(line) || exempt(expression)) return;
		for (const literal of staticTextNodes(declaration)) {
			const text = collapse(literal.text);
			if (LETTER_RE.test(text)) {
				record(line, `${kind}:const`, text, literal);
			}
		}
	};
	/**
	 * A template in a plain `const` / `return` / array position.
	 *
	 * The ONE shape `check-strings.mjs` leaves to this guard (see its KNOWN
	 * BOUNDARIES): the ratchet cannot tell prose from ids, URLs, units and CSS
	 * in that position, because there is no key vocabulary to appeal to, so 234
	 * such templates stay outside its allowance. Here they cost one pragma on a
	 * line the author just wrote, never a debt entry — and `copyTexts` is the
	 * shared renderer that already treats a template as ONE sentence.
	 *
	 * Bounds: a template whose text is a single token still counts (the letter
	 * test is the same one every other sink uses), so a machine-shaped template
	 * takes an `// i18n: ignore <reason>`, exactly as a token site does in the
	 * ratchet. Narrowing this by a prose heuristic would make the guard's
	 * verdict depend on how the sentence happens to start.
	 */
	const takeTemplate = (node, kind) => {
		if (
			node === undefined ||
			(node.kind !== SyntaxKind.TemplateExpression &&
				node.kind !== SyntaxKind.NoSubstitutionTemplateLiteral)
		)
			return;
		const line =
			sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
			1;
		if (!isAdded(line) || exempt(node)) return;
		for (const sentence of copyTexts(node)) {
			const text = collapse(sentence);
			/*
			 * FAIL CLOSED, and this is deliberate: a template with a letter is
			 * reported whether or not it carries a space. The tempting
			 * refinement — "require a space so identifiers stop firing" — was
			 * measured and rejected, because it also silences genuine copy that
			 * has no space: `` `${count}online` `` and a one-word label are copy
			 * shapes, and a rule that lets them through is a false negative
			 * nothing reports, which this gate must never quietly produce.
			 * Machine strings are silenced by an `i18n: ignore <reason>` pragma
			 * on their own line — visible in the diff, justified per case — not
			 * by a rule that guesses at intent from the text.
			 */
			if (LETTER_RE.test(text)) record(line, kind, text, node);
		}
	};
	const visit = (node) => {
		if (node.kind === SyntaxKind.PropertyAssignment) {
			const name = propertyName(node.name);
			if (name !== undefined && COPY_PROPERTIES.has(name)) {
				take(node.initializer, `property:${name}`);
			}
		} else if (node.kind === SyntaxKind.JsxAttribute) {
			const name = node.name.text;
			const initializer = node.initializer;
			if (
				COPY_ATTRIBUTES.has(name) &&
				initializer?.kind === SyntaxKind.JsxExpression &&
				initializer.expression
			) {
				takeReference(initializer.expression, `attribute:${name}`);
			}
		} else if (node.kind === SyntaxKind.JsxExpression) {
			// Attribute expressions are handled by their named copy sink above.
			// Every other JSX expression container is rendered child text.
			if (node.parent?.kind !== SyntaxKind.JsxAttribute && node.expression) {
				takeReference(node.expression, "jsx-expression");
			}
		} else if (templateSinks && node.kind === SyntaxKind.VariableDeclaration) {
			takeTemplate(node.initializer, "template:const");
		} else if (templateSinks && node.kind === SyntaxKind.ReturnStatement) {
			takeTemplate(node.expression, "template:return");
		} else if (
			templateSinks &&
			node.kind === SyntaxKind.ArrayLiteralExpression
		) {
			for (const element of node.elements)
				takeTemplate(element, "template:array");
		}
		node.forEachChild(visit);
	};
	visit(sourceFile);
	return findings.sort(
		(a, b) => a.line - b.line || a.kind.localeCompare(b.kind),
	);
}

function isGuardedFile(rel) {
	/* Test fixtures and specs contain assertions about English, not rendered
	 * product copy. Keep them out of this added-line sink scan just as stories
	 * and fixtures are already outside the original scanner's corpus. */
	return (
		isScanned(rel) && !TEST_DIRECTORY_RE.test(rel) && !TEST_FILE_RE.test(rel)
	);
}

function changedFiles(repo, base) {
	const changed = git(repo, [
		"diff",
		"--name-only",
		"-z",
		"--diff-filter=ACMR",
		base,
		"--",
		...SCAN_ROOTS,
	])
		.split("\0")
		.filter(Boolean);
	const untracked = git(repo, [
		"ls-files",
		"--others",
		"--exclude-standard",
		"-z",
		"--",
		...SCAN_ROOTS,
	])
		.split("\0")
		.filter(Boolean);
	return {
		tracked: changed.filter((rel) => isGuardedFile(rel)),
		untracked: untracked.filter((rel) => isGuardedFile(rel)),
	};
}

/**
 * `afterListing` is a test seam fired between listing changed files and
 * reading them: it is the exact window in which a concurrent process can
 * delete a file, so tests can open that window deterministically.
 *
 * Why vanished UNTRACKED files are skipped but TRACKED ones still throw: many
 * sibling tests write a transient `_*.bundle.mjs` into scripts/i18n, import it
 * and unlink it, and under `node --test` concurrency the checker can list it
 * and then lose it (CI runs 41603855749 / 41595469149, exit 2 instead of 1).
 * A file that existed only as untracked scratch and is gone can never be
 * committed, so it holds no copy to guard. A tracked file that vanishes is a
 * real working-tree change the check cannot vouch for, so it stays fail-closed.
 */
export function runAddedCheck({
	repo = REPO,
	base = "origin/main",
	afterListing,
} = {}) {
	const comparisonBase = resolveComparisonBase(repo, base);
	const { tracked, untracked } = changedFiles(repo, comparisonBase);
	const allowlist = loadAllowlist(join(repo, "i18n", "allowlist.json"));
	const additions = new Map();
	/* rel -> the catalogue keys this file's own diff stopped calling t() for. Only
	 * a same-file de-keying can vouch for a restored literal, so this map is the
	 * whole input source B gets. */
	const unKeyed = new Map();
	for (const rel of tracked) {
		if (allowlistReason(rel, allowlist)) continue;
		const diff = git(repo, [
			"diff",
			"--unified=0",
			"--no-color",
			comparisonBase,
			"--",
			rel,
		]);
		const { added } = parseAddedLines(diff);
		if (added.size > 0) {
			additions.set(rel, added);
			const keys = unKeyedCatalogueKeys(diff);
			if (keys.size > 0) unKeyed.set(rel, keys);
		}
	}
	for (const rel of untracked) {
		if (!allowlistReason(rel, allowlist)) additions.set(rel, null);
	}
	afterListing?.();
	const files = [...additions.keys()];
	if (files.length === 0) {
		return { base: comparisonBase, files, findings: [], restored: [] };
	}

	/* One oracle per run, built before any file is parsed but lazy inside: it
	 * reads the base tree only when a candidate finding asks it to. */
	const restoreTester = createRestoreTester(repo, comparisonBase, unKeyed);
	const { api, snapshot } = openSnapshot(
		repo,
		files.map((rel) => join(repo, rel)),
	);
	try {
		const findings = [];
		const restored = [];
		for (const rel of files) {
			const abs = join(repo, rel);
			const isUntracked = additions.get(rel) === null;
			if (!existsSync(abs)) {
				if (isUntracked) {
					// Named on stderr so a skip is never silent; stdout and the exit
					// code keep their meaning.
					console.error(
						`check-added-strings.mjs: skipped untracked file that vanished before it was read: ${rel}`,
					);
					continue;
				}
				throw new Error(`Changed file disappeared: ${rel}`);
			}
			const project = snapshot.getDefaultProjectForFile(abs);
			const sourceFile = project.program.getSourceFile(abs);
			// Vanished between existsSync and parse: same untracked-only rule.
			if (!sourceFile && isUntracked && !existsSync(abs)) continue;
			if (!sourceFile) throw new Error(`TypeScript could not parse ${rel}`);
			for (const finding of findAddedCopyViolations(
				sourceFile,
				additions.get(rel),
				{
					/* The template sinks are the ratchet's stated boundary, so they
					 * follow the SAME surface the ratchet's data shapes do. */
					templateSinks: onDataShapeSurface(rel),
					restore: restoreTester,
				},
			)) {
				if (finding.restored === undefined) {
					findings.push({ path: rel, ...finding });
					continue;
				}
				/* Restored content is reported apart from the new findings, so a caller
				 * that only counts `findings` keeps exactly the meaning it had. */
				const { line, kind, text, restored: evidence } = finding;
				restored.push({ path: rel, line, kind, text, evidence });
			}
		}
		return { base: comparisonBase, files, findings, restored };
	} finally {
		api.close();
	}
}

/**
 * Render one run as the two streams it prints and the exit code it returns:
 * `standard` and `error` are lines in print order, so `main()` prints exactly
 * these and nothing else.
 *
 * Restored content is reported twice on purpose - a `RESTORED:` line per
 * finding (which one, where, and the evidence) and one counted warning - because
 * a revert that passes silently would be indistinguishable from a diff that
 * adds nothing.
 */
export function formatReport(result) {
	const standard = result.findings.map(
		(finding) =>
			`${finding.path}:${finding.line}: ${finding.kind}: ${finding.text}`,
	);
	for (const item of result.restored) {
		standard.push(
			`RESTORED: ${item.path}:${item.line}: ${item.kind}: ${item.text} — ${item.evidence}`,
		);
	}
	const error = [];
	if (result.restored.length > 0) {
		error.push(
			`WARN: ${result.restored.length} restored literal(s) the base tree already carried at ${shortSha(result.base)}; listed above as RESTORED and not counted as new.`,
		);
	}
	if (result.findings.length > 0) {
		error.push(
			`FAIL: ${result.findings.length} newly added literal-copy finding(s). Use t() or a narrow reasoned i18n exemption; do not add a baseline.`,
		);
		return { standard, error, code: 1 };
	}
	/* The restored note is a suffix so the no-restored line stays byte-identical. */
	const restoredNote =
		result.restored.length > 0
			? ` (${result.restored.length} restored literal(s) reported, not counted as new)`
			: "";
	standard.push(
		`PASS: no newly added literal copy in ${result.files.length} changed file(s) against ${result.base}${restoredNote}.`,
	);
	return { standard, error, code: 0 };
}

export function main(argv = process.argv.slice(2)) {
	let base = "origin/main";
	let repo = REPO;
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === "--base" && argv[index + 1]) {
			base = argv[++index];
		} else if (argv[index] === "--repo" && argv[index + 1]) {
			repo = argv[++index];
		} else {
			throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
		}
	}
	/* Both sides of this merge are load-bearing: `repo` is #1780's, so the CLI
	 * can be pointed at a scratch git repo; `formatReport` is this branch's, so
	 * restored content reaches the two streams and the exit code. */
	const { standard, error, code } = formatReport(runAddedCheck({ repo, base }));
	for (const line of standard) console.log(line);
	for (const line of error) console.error(line);
	return code;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	try {
		process.exitCode = main();
	} catch (error) {
		console.error(`check-added-strings.mjs: ${error.message}`);
		process.exitCode = 2;
	}
}
