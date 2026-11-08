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
 *   B. an already authored English message: a string value in
 *      `src/i18n/catalogues/en/**` at base contains the finding's normalized
 *      words as a bounded run, so punctuation, wrapping and interpolated values
 *      may drift between the message and the re-added literal.
 * Anything neither source proves is NOT restored and still fails. Absence of
 * evidence, an ambiguous lookup, an unreadable base tree or an unparseable base
 * catalogue is a failure, never a silent pass.
 *
 * Two boundaries are stated rather than left implied:
 *   (a) source B accepts a newly written un-keyed sink that reuses an English
 *       message already in the base tree. That is a known, visible residue of
 *       the revert allowance rather than a silent pass: every acceptance prints
 *       its own `RESTORED:` line with the catalogue it came from. The haystack
 *       is English MESSAGE values only. The `*.context.json` sidecars beside
 *       those messages are translator notes (register, style and width prose
 *       about a key), and a note is not evidence that the UI ever shipped that
 *       string, so they are filtered out of the base listing: a literal lifted
 *       out of a note is newly authored copy and still fails. A whole-value
 *       message match is preferred for the evidence line;
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
	enclosingElement,
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
 * Comparison form: whitespace collapsed, digit runs and ICU braces flattened.
 *
 * Why flatten at all: a re-added literal and the catalogue message behind it
 * legitimately differ in the interpolated value (a `{count}` placeholder where
 * the literal baked a digit in) and in line wrapping. Normalizing both sides is
 * what lets source B compare copy rather than formatting.
 */
function normalizeCopy(text) {
	return text
		.replace(/\s+/g, " ")
		.replace(/\d+/g, "#")
		.replace(/[{}]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * A needle keeps its words but drops edge punctuation, so "Done." matches
 * "Done..." - the trailing mark is a rendering difference, not other copy.
 */
function copyNeedle(text) {
	return normalizeCopy(text).replace(/^[\s.,;:!?…—–-]+|[\s.,;:!?…—–-]+$/g, "");
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
		const [, type, sizeText] = header.split(" ");
		if (type === "missing") {
			objects.set(name, { type, content: null });
			continue;
		}
		const size = Number(sizeText);
		if (type !== "blob" || !Number.isFinite(size)) {
			throw new Error(`git cat-file --batch returned "${header}" for ${name}`);
		}
		const content = buffer.subarray(offset, offset + size).toString("utf8");
		offset += size + 1;
		objects.set(name, { type, content });
	}
	return objects;
}

/** Every string value under one parsed catalogue message tree. */
function collectMessageStrings(value, out) {
	if (typeof value === "string") {
		out.push(value);
	} else if (Array.isArray(value)) {
		for (const item of value) collectMessageStrings(item, out);
	} else if (value !== null && typeof value === "object") {
		for (const item of Object.values(value)) collectMessageStrings(item, out);
	}
}

/**
 * Every English MESSAGE string at `base`, as `{ path, value }`.
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
		collectMessageStrings(parsed, values);
		for (const value of values) entries.push({ path: blob.path, value });
	}
	return entries;
}

/**
 * The restore oracle for one run, created once and handed to every file's
 * extractor. Nothing is read until a candidate finding asks, so a diff with no
 * findings never touches the base tree.
 *
 * `tester(absolutePath, raw, text)` answers the evidence line for a restored
 * finding, or `undefined` meaning "not restored, still a failure": an absent
 * same-path blob, a needle no base catalogue carries, or an empty needle.
 *
 * `raw` is the literal's exact source span (quotes included) because that is
 * what "the base file contains this literal" has to mean; `text` is the
 * collapsed literal the report shows, which source B compares against English
 * MESSAGE values only - the `*.context.json` translator notes are filtered out
 * of the base listing, so the evidence can never name a note.
 */
function createRestoreTester(repo, base) {
	const shortBase = shortSha(base);
	const baseBlobs = new Map();
	let catalogue;

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

	const catalogueEntries = () => {
		if (catalogue === undefined) catalogue = readBaseCatalogue(repo, base);
		return catalogue;
	};

	return (absPath, raw, text) => {
		const rel = relative(repo, absPath);
		const blob = samePathBlob(rel);
		if (blob !== null && raw.length > 0 && blob.includes(raw)) {
			return `verbatim in ${rel} at ${shortBase}`;
		}
		const needle = copyNeedle(text);
		if (needle.length === 0) return undefined;
		const entries = catalogueEntries();
		/* Prefer a message whose WHOLE value is the needle, so the evidence names the
		 * message a revert restores rather than a longer message that merely contains
		 * it. Preference only: it changes which evidence is reported, never whether a
		 * finding is accepted. */
		const exact = entries.find((entry) => copyNeedle(entry.value) === needle);
		if (exact !== undefined) {
			return `present in ${exact.path} at ${shortBase}`;
		}
		for (const entry of entries) {
			if (containsBounded(normalizeCopy(entry.value), needle)) {
				return `present in ${entry.path} at ${shortBase}`;
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
 */
export function findAddedCopyViolations(
	sourceFile,
	addedLines,
	{ templateSinks = false, restore } = {},
) {
	const pragmas = pragmaLines(sourceFile);
	const findings = [];
	const isAdded = (line) => addedLines === null || addedLines.has(line);
	const exempt = (node) => {
		const element = enclosingElement(node);
		return (
			inSpan(lineSpan(sourceFile, node), pragmas) ||
			(element !== undefined && inSpan(lineSpan(sourceFile, element), pragmas))
		);
	};
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
		if (added.size > 0) additions.set(rel, added);
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
	const restoreTester = createRestoreTester(repo, comparisonBase);
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
			`WARN: ${result.restored.length} restored literal(s) already existed at ${shortSha(result.base)}; listed above as RESTORED and not counted as new.`,
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
