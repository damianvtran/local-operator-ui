/**
 * A git-style line diff of two strings, computed in the renderer.
 *
 * ## Why this exists, and why it is in-repo
 *
 * Every diff the app drew before this file arrived pre-rendered from the
 * backend (`trace/diff-block.tsx` reads a unified patch the tool produced). The
 * two surfaces that need a diff now - a pending profile proposal in Agents and
 * the hub update preview - receive the two SIDES as plain strings, so the diff
 * has to be computed here. No diff library is a dependency (package.json carries
 * neither `diff` nor `@codemirror/merge`), and the inputs are small: a profile
 * field is capped at 8000 characters by the desktop contract, a hub region is a
 * section of one. A ~200-line pure module is cheaper than a dependency for the
 * whole fleet's install, and it is unit-tested in `scripts/text-diff.test.mjs`.
 *
 * ## The model
 *
 * - LINES are diffed with Myers' O((N+M)D) algorithm after trimming the common
 *   prefix and suffix (the usual shape of an edit is a few changed lines in a
 *   long text, so the trim leaves Myers almost nothing to do).
 * - Inside a RUN of removed lines followed by added lines, the lines are paired
 *   in order and each pair gets a word-level LCS so the exact words that changed
 *   can be highlighted, the way `git diff --word-diff`/diff-highlight do. A pair
 *   that shares too little is left unhighlighted: marking every word of a
 *   rewritten line says nothing the +/- marker does not.
 * - Unchanged lines more than `context` away from any change are folded into
 *   GAP blocks that the view can expand in place.
 *
 * Bounded on purpose: past `MAX_EDIT_DISTANCE` the line diff degrades to
 * "everything removed, everything added", and past `MAX_WORD_TOKENS` a pair
 * gets no word highlight. Both are correct diffs, only less precise, so a huge
 * paste can never stall the renderer.
 */

export type DiffLineKind = "context" | "add" | "del";

/** One run of a changed line: `changed` spans are the words that differ. */
export type DiffSegment = { text: string; changed: boolean };

export type DiffLine = {
	kind: DiffLineKind;
	text: string;
	/** 1-based line number on the before side, null for an added line. */
	oldNo: number | null;
	/** 1-based line number on the after side, null for a removed line. */
	newNo: number | null;
	/** Word-level split, present only on a paired changed line worth highlighting. */
	segments?: DiffSegment[];
};

/**
 * What the view draws, in order. A `change` block is one contiguous run of
 * removed/added lines (the unit "next/previous change" jumps between); a
 * `context` block is shown unchanged lines; a `gap` block is folded context the
 * person can expand.
 */
export type DiffBlock =
	| { kind: "change"; id: string; index: number; lines: DiffLine[] }
	| { kind: "context"; id: string; lines: DiffLine[] }
	| { kind: "gap"; id: string; lines: DiffLine[] };

export type DiffModel = {
	blocks: DiffBlock[];
	added: number;
	removed: number;
	/** Number of `change` blocks. */
	changes: number;
	identical: boolean;
};

/** Beyond this many line edits the diff is reported as a whole replacement. */
export const MAX_EDIT_DISTANCE = 1000;
/** Beyond this many tokens on either side a line pair gets no word highlight. */
export const MAX_WORD_TOKENS = 400;
/**
 * The share of a pair's text that must be common before word highlights are
 * drawn. Below it the line was rewritten, not edited, and highlighting nearly
 * every word is noise.
 */
const MIN_WORD_SIMILARITY = 0.35;

export function splitLines(text: string): string[] {
	return text === "" ? [] : text.split("\n");
}

type Op = { kind: DiffLineKind; a: number; b: number };

/**
 * Myers' greedy diff over two arrays, returning one op per line in order.
 * `a`/`b` are the indexes into each side (the side an op does not touch keeps
 * the index it would insert at, which the caller ignores).
 */
export function diffSequence<T>(a: readonly T[], b: readonly T[]): Op[] {
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	const ops: Op[] = [];
	for (let i = 0; i < start; i++) ops.push({ kind: "context", a: i, b: i });
	ops.push(...myersMiddle(a, b, start, endA, start, endB));
	for (let i = 0; endA + i < a.length; i++)
		ops.push({ kind: "context", a: endA + i, b: endB + i });
	return ops;
}

function myersMiddle<T>(
	a: readonly T[],
	b: readonly T[],
	a0: number,
	a1: number,
	b0: number,
	b1: number,
): Op[] {
	const n = a1 - a0;
	const m = b1 - b0;
	const replaceAll = (): Op[] => [
		...Array.from({ length: n }, (_, i) => ({
			kind: "del" as const,
			a: a0 + i,
			b: b0,
		})),
		...Array.from({ length: m }, (_, i) => ({
			kind: "add" as const,
			a: a1,
			b: b0 + i,
		})),
	];
	if (n === 0 || m === 0) return replaceAll();
	const max = Math.min(n + m, MAX_EDIT_DISTANCE);
	const offset = max;
	let v = new Int32Array(2 * max + 2);
	const trace: Int32Array[] = [];
	let found = -1;
	for (let d = 0; d <= max; d++) {
		trace.push(v.slice());
		const next = v.slice();
		for (let k = -d; k <= d; k += 2) {
			let x: number;
			if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]))
				x = v[offset + k + 1];
			else x = v[offset + k - 1] + 1;
			let y = x - k;
			while (x < n && y < m && a[a0 + x] === b[b0 + y]) {
				x++;
				y++;
			}
			next[offset + k] = x;
			if (x >= n && y >= m) {
				found = d;
				break;
			}
		}
		v = next;
		if (found >= 0) break;
	}
	if (found < 0) return replaceAll();
	// Backtrack from (n, m) through the recorded frontiers.
	const reversed: Op[] = [];
	let x = n;
	let y = m;
	for (let d = found; d > 0; d--) {
		const prev = trace[d];
		const k = x - y;
		const down =
			k === -d || (k !== d && prev[offset + k - 1] < prev[offset + k + 1]);
		const prevK = down ? k + 1 : k - 1;
		const prevX = prev[offset + prevK];
		const prevY = prevX - prevK;
		while (x > prevX && y > prevY) {
			x--;
			y--;
			reversed.push({ kind: "context", a: a0 + x, b: b0 + y });
		}
		if (down) {
			y--;
			reversed.push({ kind: "add", a: a0 + x, b: b0 + y });
		} else {
			x--;
			reversed.push({ kind: "del", a: a0 + x, b: b0 + y });
		}
	}
	while (x > 0 && y > 0) {
		x--;
		y--;
		reversed.push({ kind: "context", a: a0 + x, b: b0 + y });
	}
	return reversed.reverse();
}

/** Words, runs of whitespace and single punctuation marks, in any script. */
export function tokenize(line: string): string[] {
	return line.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? [];
}

/**
 * Word-level highlights for one removed/added pair, or null when the pair
 * should be shown without them (too long, or too little in common).
 */
export function wordSegments(
	before: string,
	after: string,
): { before: DiffSegment[]; after: DiffSegment[] } | null {
	const a = tokenize(before);
	const b = tokenize(after);
	// The cap bounds the Myers search, which only ever runs on the tokens
	// between the common prefix and suffix (`diffSequence` trims both first).
	// Capping the whole line instead dropped the highlight for a one-word edit
	// inside a long paragraph (design round 1, D3: a 250-word line showed no
	// changed words), which is exactly the long-brief case this view serves.
	let head = 0;
	while (head < a.length && head < b.length && a[head] === b[head]) head++;
	let tail = 0;
	while (
		tail < a.length - head &&
		tail < b.length - head &&
		a[a.length - 1 - tail] === b[b.length - 1 - tail]
	)
		tail++;
	if (
		a.length - head - tail > MAX_WORD_TOKENS ||
		b.length - head - tail > MAX_WORD_TOKENS
	)
		return null;
	const ops = diffSequence(a, b);
	let common = 0;
	for (const op of ops) if (op.kind === "context") common += a[op.a].length;
	const longest = Math.max(before.length, after.length);
	if (longest === 0 || common / longest < MIN_WORD_SIMILARITY) return null;
	const push = (into: DiffSegment[], text: string, changed: boolean) => {
		const last = into[into.length - 1];
		if (last && last.changed === changed) last.text += text;
		else into.push({ text, changed });
	};
	const left: DiffSegment[] = [];
	const right: DiffSegment[] = [];
	for (const op of ops) {
		if (op.kind === "context") {
			push(left, a[op.a], false);
			push(right, b[op.b], false);
		} else if (op.kind === "del") push(left, a[op.a], true);
		else push(right, b[op.b], true);
	}
	return { before: left, after: right };
}

/**
 * Within each run of changed lines, every removal before every addition - the
 * order `git diff` prints a hunk in. Myers' backtrack can interleave them
 * (`- + - +`), which reads as noise and would pair the wrong lines for word
 * highlights. Line numbers travel with the lines, so nothing is renumbered.
 */
function groupRemovalsFirst(lines: DiffLine[]): void {
	let i = 0;
	while (i < lines.length) {
		if (lines[i].kind === "context") {
			i++;
			continue;
		}
		const start = i;
		while (i < lines.length && lines[i].kind !== "context") i++;
		const run = lines.slice(start, i);
		const ordered = [
			...run.filter((line) => line.kind === "del"),
			...run.filter((line) => line.kind === "add"),
		];
		lines.splice(start, ordered.length, ...ordered);
	}
}

function annotateWords(lines: DiffLine[]): void {
	// Pair each run of removals with the run of additions right after it.
	let i = 0;
	while (i < lines.length) {
		if (lines[i].kind !== "del") {
			i++;
			continue;
		}
		const dels: DiffLine[] = [];
		while (i < lines.length && lines[i].kind === "del") dels.push(lines[i++]);
		const adds: DiffLine[] = [];
		while (i < lines.length && lines[i].kind === "add") adds.push(lines[i++]);
		for (let p = 0; p < Math.min(dels.length, adds.length); p++) {
			const words = wordSegments(dels[p].text, adds[p].text);
			if (!words) continue;
			dels[p].segments = words.before;
			adds[p].segments = words.after;
		}
	}
}

/**
 * The view model: blocks in order plus the header counts.
 *
 * `context` is the number of unchanged lines kept visible on each side of a
 * change (git's default is 3). A fold shorter than two lines is not worth a
 * button, so it is shown instead.
 */
export function diffModel(
	before: string,
	after: string,
	{
		context = 3,
		wordLevel = true,
	}: { context?: number; wordLevel?: boolean } = {},
): DiffModel {
	const a = splitLines(before);
	const b = splitLines(after);
	const lines: DiffLine[] = diffSequence(a, b).map((op) =>
		op.kind === "context"
			? { kind: "context", text: a[op.a], oldNo: op.a + 1, newNo: op.b + 1 }
			: op.kind === "del"
				? { kind: "del", text: a[op.a], oldNo: op.a + 1, newNo: null }
				: { kind: "add", text: b[op.b], oldNo: null, newNo: op.b + 1 },
	);
	groupRemovalsFirst(lines);
	if (wordLevel) annotateWords(lines);

	let added = 0;
	let removed = 0;
	for (const line of lines) {
		if (line.kind === "add") added++;
		else if (line.kind === "del") removed++;
	}

	// Which context lines stay visible: those within `context` of a change.
	const visible = new Array<boolean>(lines.length).fill(false);
	lines.forEach((line, index) => {
		if (line.kind === "context") return;
		const from = Math.max(0, index - context);
		const to = Math.min(lines.length - 1, index + context);
		for (let j = from; j <= to; j++) visible[j] = true;
	});

	const blocks: DiffBlock[] = [];
	let changes = 0;
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const start = i;
		if (line.kind !== "context") {
			const run: DiffLine[] = [];
			while (i < lines.length && lines[i].kind !== "context")
				run.push(lines[i++]);
			blocks.push({
				kind: "change",
				id: `change-${changes}`,
				index: changes,
				lines: run,
			});
			changes++;
			continue;
		}
		const shown = visible[i];
		const run: DiffLine[] = [];
		while (
			i < lines.length &&
			lines[i].kind === "context" &&
			visible[i] === shown
		)
			run.push(lines[i++]);
		const id = `${shown ? "context" : "gap"}-${start}`;
		blocks.push(
			shown || run.length < 2
				? { kind: "context", id, lines: run }
				: { kind: "gap", id, lines: run },
		);
	}
	return {
		blocks,
		added,
		removed,
		changes,
		identical: added === 0 && removed === 0,
	};
}
