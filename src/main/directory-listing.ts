/**
 * The one directory-listing primitive this app has, the two path facts the
 * composer's `@` picker needs from the main process, and the existence probe
 * behind the Files panel (`probeFiles`).
 *
 * WHY A MODULE OF ITS OWN. `src/main/index.ts` boots the app on import, so
 * nothing that lives there can be bundled and exercised by a test.
 * `scripts/desktop-contract.test.mjs` bundles files under `src/main/` in memory
 * instead, which is the pattern `picker-directory.ts` states for the same
 * reason; `scripts/directory-listing.test.mjs` pins the functions below.
 *
 * FIVE THINGS, ONE RULE EACH:
 *
 * 1. **A directory's listable entries.** The renderer cannot read a directory
 *    (`nodeIntegration: false`, `contextIsolation: true`), and `probe-files`
 *    answers existence and identity but not membership — so a picker has no way
 *    to offer a row without this. The exclusions are the visible half of the
 *    answer: dotfiles and the build/vendor directories a listing would drown in.
 *    They mirror the harness's own `@` picker listing vocabulary
 *    (`local_operator/references.py:scan_directory`, which skips
 *    `builtin.py:_GREP_PRUNE_DIRS` and every name starting with a dot), because a
 *    picker that offers `node_modules` is a picker nobody can use; and the mirror
 *    is stated rather than assumed, because a name missing from this set costs
 *    ROWS in a menu and cannot make the composer expand a path the approval gate
 *    would refuse. That is what makes duplicating it here a listing decision
 *    rather than a second spelling of a security control. (The harness's
 *    `.gitignore` handling is deliberately NOT mirrored: that machinery belongs
 *    to the walker, and half an implementation of it here would be worse than
 *    none. The divergence is stated in the pull request's own "Not addressed"
 *    section — where a reviewer reads it — rather than left as a pointer in a
 *    comment that nothing links to (review round 1, N2): the behaviour is fine,
 *    because a gitignored path still expands server-side.)
 *
 * 2. **Whether a resolved path lies outside the workspace.** The chip's
 *    needs-approval fill is this one fact, and it is the harness's own definition
 *    (`builtin.py:_resolve_workspace_path`): both sides are FULLY RESOLVED —
 *    symlinks included — and the target must be the root itself or under it. It
 *    has to be computed here rather than in the renderer for the reason the path
 *    rule lives here at all: the renderer never guesses a home directory, and a
 *    prefix test over `~/x` against `/Users/you/x` is how the chip would come to
 *    disagree with the gate about one file.
 *
 * 3. **A resolved spelling, for that test.** `realpath`, because a symlink inside
 *    the workspace that points outside it is the case the harness resolves FIRST
 *    and then judges — so judging the link's own spelling would paint a plain
 *    chip over a path that raises a card.
 *
 * 4. **The app's one path rule** (`resolveUserPath`), which every local-file
 *    handler resolves through and which therefore belongs here rather than in
 *    `src/main/index.ts`: `index.ts` boots Electron on import, so a rule living
 *    there cannot be executed by a test, and this one is load-bearing for BOTH
 *    the picker's listing and the chip's probe (`probe-files`) — the two calls a
 *    picker makes per keystroke. It takes `home` as an argument for that same
 *    reason: the caller supplies `app.getPath("home")`, and the rule stays pure.
 *
 * 5. **Existence and identity for the Files panel** (`probeFiles` below). It is
 *    the one local-file answer built on TRANSCRIPT content rather than a
 *    keystroke, and that content is remote: a cloud session's mentions name
 *    `/home/ec2-user/...` paths, and on macOS `/home` is an autofs map where a
 *    missing path costs a measured 266-275 ms per lookup. The synchronous shape
 *    this replaces blocked the process that serves every IPC for 8.00 s on 30
 *    such paths, holding a warm remote open at 2.4-3.2 s before first paint.
 *    The rule now is promises only, a bounded pool, a per-path deadline and a
 *    cross-call cache — `probeFiles`' own comment carries the numbers, the
 *    constraints and the evidence pointer.
 */

import { realpathSync, statSync } from "node:fs";
import {
	realpath as fsRealpath,
	stat as fsStat,
	opendir,
} from "node:fs/promises";
import { join, sep } from "node:path";
import {
	DIRECTORY_ENTRY_LIMIT,
	type DirectoryEntry,
	type DirectoryListing,
	MAX_PROBE_PATHS,
	type ProbedFile,
} from "../shared/desktop-contract";

/**
 * Names never offered as rows, whatever they contain.
 *
 * The harness's `_GREP_PRUNE_DIRS` verbatim. Skipped by NAME rather than by kind,
 * so a file called `build` is skipped too — the set is about what a listing is
 * for, and it is applied the same way there.
 */
export const PRUNE_NAMES: readonly string[] = [
	"__pycache__",
	"node_modules",
	"dist",
	"build",
	".git",
	".venv",
];

/**
 * Whether a name is excluded from a listing.
 *
 * A dotfile is excluded because the harness's listing excludes it and because
 * `ls` does; `PRUNE_NAMES` is matched case-SENSITIVELY, unlike the harness's
 * deny-list, because these are spellings a build tool fixes rather than names a
 * filesystem may fold.
 */
function excluded(name: string): boolean {
	if (name.startsWith(".")) return true;
	return PRUNE_NAMES.includes(name);
}

/**
 * The app's one path rule: `~`, a `~/…` prefix, and a relative path against a
 * working directory. Used by EVERY local-file handler (`read-file`,
 * `read-file-bytes`, `probe-files`, `list-directory`), which is what keeps the
 * picker's listing and the chip's probe from disagreeing about which file a
 * token names.
 *
 * THE CWD RESOLVES THROUGH THIS SAME RULE, and that is a fix rather than a
 * refactor. It used to expand only a `cwd` that matched `~/…`, so the literal
 * `"~"` a brand-new chat's draft carries fell through and was joined
 * `/`. A relative listing then became `scandir '~'` — ENOENT, zero rows — and a
 * relative probe became `~/README.md` — `exists: false`, no chip. The feature's
 * only entry point failed on the first attempt of every user who had not yet
 * chosen a directory.
 */
export function resolveUserPath(
	filePath: string,
	cwd: string | undefined,
	home: string,
): string {
	if (filePath === "~") return home;
	if (filePath.startsWith("~/")) return join(home, filePath.slice(2));
	if (cwd && !filePath.startsWith("/")) {
		const base =
			cwd === "~" || cwd.startsWith("~/")
				? resolveUserPath(cwd, undefined, home)
				: cwd;
		return join(base, filePath);
	}
	return filePath;
}

/**
 * Ceiling on the candidate list one listing builds, before the alphabet is
 * applied to it.
 *
 * The harness's own `SCAN_CANDIDATE_LIMIT` (`references.py`), copied with the
 * reason it gives: the picker windows to 8 rows, so the ROWS were never the
 * cost — this stops a pathological directory from making the SCAN the cost on a
 * keystroke path.
 *
 * The bound is on the WORK, not on the answer. `readdirSync` plus a
 * `localeCompare` sort of everything measured **236ms** on a 200,000-entry
 * directory (about fourteen dropped frames of the whole app window, on a
 * 60ms-debounced keystroke path) to answer with 200 rows. Neither half of that
 * scales here: the scan is ASYNC (see `listDirectory`), so the read happens off
 * the main thread and the event loop that serves every other IPC keeps running;
 * the retained set never exceeds this many names however large the directory is
 * (see `offerCandidate`); and the per-row `stat` runs at most this many times.
 *
 * Measured on the same 200,000-entry directory, before and after (one process,
 * one directory, a 16ms heartbeat running throughout): the synchronous unbounded
 * shape blocked the event loop for **295ms**; the async shape's longest block is
 * **18.9ms** — about one frame instead of eighteen — for the same 200 rows in the
 * same order and a wall time within noise of the old one. The finding was about
 * the BLOCK, and that is the number that moved.
 *
 * THE RETAINED SET CHANGED AFTER THAT MEASUREMENT (review round 2, R1): the cap
 * now keeps the smallest names of the stream as it arrives, which is one
 * comparison per entry in the common case, where the shape measured above sorted
 * up to twice this many names at every crossing of the cap. So the read loop's
 * per-entry work is smaller and no synchronous step in it grew; the 18.9ms is the
 * async read's block rather than this cap's, which is why it is still the number
 * quoted for the BLOCK finding.
 */
export const DIRECTORY_SCAN_LIMIT = 2000;

/** One candidate: the dirent's two answers, with a link's kind left unresolved. */
type Candidate = { name: string; directory: boolean; link: boolean };

/**
 * The order the picker's answer is in, and therefore the order its CAP is applied
 * in.
 *
 * ONE ORDER, TWO USES, and separating them was a defect (review round 2, R1). The
 * cap used to retain with plain `<` — code units — while the answer was sorted
 * with `localeCompare`, and the two disagree the moment a directory holds both
 * cases or an accented name: the retained set was then neither order's prefix. A
 * directory of 2,500 `B…` and 2,500 `a…` answered with names from the MIDDLE of
 * the alphabet (a00040.txt upward, measured) where the shape it replaced answered
 * with the directory's own first 200.
 *
 * `localeCompare` is the display order this listing is sorted in, so it is the
 * order the cap has to keep — and the code-unit tiebreak under it makes the order
 * TOTAL, so two names the collator calls equal cannot depend on the order the
 * filesystem happened to enumerate them in.
 *
 * The collator is built once: `String.prototype.localeCompare` constructs one per
 * call, and this comparator runs once per directory entry.
 */
const collator = new Intl.Collator();

function compareCandidates(a: Candidate, b: Candidate): number {
	const display = collator.compare(a.name, b.name);
	if (display !== 0) return display;
	return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Offer one candidate to the bounded kept set, as a MAX-heap of
 * `DIRECTORY_SCAN_LIMIT` names: the root is the LARGEST name kept, i.e. the one
 * candidate a later arrival can displace.
 *
 * WHY THE RETAINED SET IS THE EXACT SMALLEST NAMES OF THE STREAM (review round 2,
 * R1). Sorting at every crossing of the cap — what the shape this replaced did —
 * is not the same answer: entries read after a crossing were appended to the kept
 * set without ever being compared against it, so the pool the final sort truncated
 * was a mixture of two windows rather than any one order's minimum. This is the
 * same RULE and the same BOUND as the harness's own `scan_directory`, which
 * retains with `heapq.nsmallest`: the smallest `SCAN_CANDIDATE_LIMIT` names of
 * the WHOLE stream, decided as the entries arrive, so the final sort and slice
 * return the directory's own first `DIRECTORY_ENTRY_LIMIT` names whatever the
 * enumeration order was.
 *
 * AND THE ORDER IT KEEPS IS THIS ONE, NOT THE HARNESS'S — stated because the
 * sentence above reads as row parity and is not one (code review round 3, S1;
 * QA round 3, Q-7). `heapq.nsmallest` keys on the raw Python string, so the
 * harness compares CODE UNITS; this cap compares `Intl.Collator` DISPLAY order.
 * The two disagree on exactly the inputs the paragraph above names: a
 * `new Intl.Collator()` calls `"B00000.txt"` against `"a00000.txt"` `1` where
 * `sorted()` puts `B…` first, and `"é"` against `"f"` `-1` where the code-unit
 * compare is positive. On a directory that mixes cases or carries an accented
 * name the two surfaces therefore choose DIFFERENT prefixes of the same size —
 * the picker answers `a00000.txt` upward where the harness's reference block
 * answers `B00000.txt` upward. What the two guarantee between them is the same
 * shape and the same bound; the rows are this listing's own, and display order
 * is deliberately the one they are in, because the rows a reader sees are the
 * rows the collator orders and a picker whose cap kept a different order than
 * its answer would be showing a prefix of neither.
 *
 * The COST is the reason for a heap rather than a scan for the maximum: a full
 * heap refuses an arrival with ONE comparison in the common case (a name past the
 * cap's current boundary), and pays `log(k)` only when it accepts.
 *
 * Returns whether the candidate was kept: `false` means the cap withheld it, which
 * is what `truncated` reports.
 */
function offerCandidate(heap: Candidate[], candidate: Candidate): boolean {
	if (heap.length < DIRECTORY_SCAN_LIMIT) {
		heap.push(candidate);
		siftUp(heap, heap.length - 1);
		return true;
	}
	if (compareCandidates(candidate, heap[0]) >= 0) return false;
	heap[0] = candidate;
	siftDown(heap, 0);
	return true;
}

/** Restore the max-heap invariant upward from `from`. */
function siftUp(heap: Candidate[], from: number): void {
	let index = from;
	while (index > 0) {
		const parent = (index - 1) >> 1;
		if (compareCandidates(heap[index], heap[parent]) <= 0) return;
		[heap[parent], heap[index]] = [heap[index], heap[parent]];
		index = parent;
	}
}

/** Restore the max-heap invariant downward from `from`. */
function siftDown(heap: Candidate[], from: number): void {
	let index = from;
	for (;;) {
		const left = index * 2 + 1;
		const right = left + 1;
		let largest = index;
		if (left < heap.length && compareCandidates(heap[left], heap[largest]) > 0)
			largest = left;
		if (
			right < heap.length &&
			compareCandidates(heap[right], heap[largest]) > 0
		)
			largest = right;
		if (largest === index) return;
		[heap[largest], heap[index]] = [heap[index], heap[largest]];
		index = largest;
	}
}

/**
 * One directory's listable entries, sorted by name. Never throws.
 *
 * SORTED BY NAME, like the harness, so the renderer's own ranking starts from a
 * deterministic order and its alphabetical tiebreak cannot depend on `readdir`
 * order. `dir` must already have been through the path rule (`resolveUserPath`),
 * so there is one resolver in this process.
 *
 * ASYNC, AND THAT IS THE POINT RATHER THAN A STYLE (review round 1, M2). This
 * answers a 60ms-debounced keystroke from the renderer, on the process that serves
 * EVERY other IPC in the app, so a synchronous read of a pathological directory
 * blocks the whole window: measured at **236ms** for a 200,000-entry directory,
 * about fourteen dropped frames. `fs.readdirSync` was the shape that did it.
 * `opendir`'s async iteration reads in batches and yields between them, so the
 * blocking window is one batch rather than one directory, and the candidate cap
 * below bounds the CPU that follows.
 *
 * A symlink is asked about with `statSync` rather than answered from the dirent,
 * because `stat` follows the link and the harness's `DirEntry.is_dir()` does too
 * — a symlinked directory is a directory row on both surfaces. The stat runs
 * only for a link AND only for a row that survived the candidate cap, so a
 * directory of 200,000 symlinks costs the cap's worth of stats, not 200,000.
 *
 * `truncated` is true whenever anything was withheld, from either bound: the
 * scan cap or `DIRECTORY_ENTRY_LIMIT`.
 */
export async function listDirectory(dir: string): Promise<DirectoryListing> {
	try {
		const candidates: Candidate[] = [];
		let overflow = false;
		const stream = await opendir(dir);
		/*
		 * No `finally { close() }`: `fs.Dir`'s async iterator closes the handle
		 * itself when the loop ends, and closing an already-closed handle throws
		 * (`Directory handle was closed`), which the `catch` below would then report
		 * as an unreadable folder. An abrupt exit — a break, or a throw out of the
		 * loop — calls the iterator's own `return()`, which closes it the same way.
		 */
		for await (const entry of stream) {
			if (excluded(entry.name)) continue;
			if (
				!offerCandidate(candidates, {
					name: entry.name,
					directory: entry.isDirectory(),
					link: entry.isSymbolicLink(),
				})
			)
				overflow = true;
		}
		candidates.sort(compareCandidates);
		const kept = candidates.slice(0, DIRECTORY_ENTRY_LIMIT);
		const entries: DirectoryEntry[] = kept.map((candidate) => ({
			name: candidate.name,
			directory: candidate.link
				? (statSync(join(dir, candidate.name), {
						throwIfNoEntry: false,
					})?.isDirectory() ?? false)
				: candidate.directory,
		}));
		return {
			dir,
			entries,
			// Either bound withheld something. `overflow` is the scan cap, which
			// means the kept set is the smallest ALPHABETICAL
			// `DIRECTORY_SCAN_LIMIT` names of a directory nobody finished reading —
			// the same rows a full sort-then-truncate would have answered with — and
			// the second term is the answer's own `DIRECTORY_ENTRY_LIMIT`-row limit.
			truncated: overflow || candidates.length > DIRECTORY_ENTRY_LIMIT,
		};
	} catch (error) {
		return {
			dir,
			entries: [],
			truncated: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** A path's fully resolved spelling, or `null` when it will not resolve. */
export function realPathOrNull(path: string): string | null {
	try {
		return realpathSync(path);
	} catch {
		return null;
	}
}

/**
 * The harness's own containment verdict, over two already-resolved paths.
 *
 * `undefined` — not `false` — when the workspace root is unknown, so a caller
 * that cannot ask the question paints nothing rather than claiming either
 * verdict. `true` is the fail-closed answer for a target that will not resolve,
 * matching `_resolve_workspace_path`: a path that cannot be shown to be inside
 * the workspace is treated as outside, which is also what the approval gate does
 * with one.
 */
export function outsideWorkspace(
	realTarget: string | null,
	realRoot: string | null,
): boolean | undefined {
	if (realRoot === null) return undefined;
	if (realTarget === null) return true;
	return realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${sep}`);
}

/*
 * ---------------------------------------------------------------------------
 * `probe-files`: existence and identity for the Files panel, on an event loop
 * it must never block.
 *
 * THE MEASURED WHY. A remote session's transcript mentions paths like
 * `/home/ec2-user/work/...`. On macOS `/home` is an autofs map
 * (`/etc/auto_master` -> `auto_home`), and every lookup of a missing
 * `/home/<user>/...` path costs a measured **266-275 ms** (three `os.stat`
 * calls: 274.7 / 276.9 / 276.0 ms; `/tmp` and a real directory answer in
 * ~0 ms; the same lookup re-derives at 285-321 ms under this host's current
 * load). The handler this replaces called `statSync` per path INSIDE the IPC
 * handler - on the one process that serves every other IPC in the app - so one
 * open of the remote conversation blocked the main thread for **8.00 s for 30
 * paths** (6.85 s / 26; 4.38 s / 17), with the process's event-loop lag
 * mirroring it (up to 7977 ms). The SSE snapshot of the conversation (248 KB)
 * was already in main by ~230 ms and could not be forwarded until the block
 * cleared, which is why a WARM remote open stalled 2.4-3.2 s before first
 * paint. The renderer re-asks missing paths every time the transcript grows
 * (`book.missing` in `use-mentioned-files.ts`), so the storm repeated on every
 * open. Making the syscalls promises moves them into libuv's thread pool and
 * off the event loop; the pool bound, the deadline and the cache below are
 * what keep the WORK bounded, not just the block.
 *
 * The rig that measured all of this - and the before/after runs over the same
 * 30-path input - is summarised in this function's pull request, under
 * "Problem" and "Evidence". The response shape is deliberately unchanged:
 * `resolved`, `exists`, `isFile`, `sizeBytes`, `mtimeMs`, the
 * `outsideWorkspace` verdict (only asked of a path that exists, `undefined`
 * when the root cannot be resolved) and the `error` branch for a genuine
 * fault.
 */

/**
 * How many path probes may be in flight at once.
 *
 * Four is libuv's own thread-pool width, and the number comes from a measured
 * property of the storm itself: the missing-path autofs lookup is SERIALISED
 * system-wide, so concurrency buys no wall time, only queue positions.
 * Measured on this host, one lookup ~265-295 ms: a 2-at-once batch totals
 * ~2 x 265 ms, a 4-at-once ~4 x 265 ms, a 6-at-once ~6 x 265 ms - the batch
 * total is n x 265 ms however wide the pool is, and what a wider pool changes
 * is each lookup's queue position (the 6-at-once batch saw individual lookups
 * of 0.8-1.6 s). A bound beyond the pool's width would not finish the batch
 * sooner; it would only charge queue time against each probe's deadline - the
 * deadline starts when the unit is dispatched - turning healthy slow lookups
 * into faults. Four keeps the pool saturated without queueing units behind it,
 * and the bound is what makes the concurrency claim testable: the pinned test
 * drives slow probes and asserts the high-water mark is exactly this number,
 * which a 64-wide fan-out (or a serial loop) would fail.
 *
 * What the measured storm charges the LOOP is now nothing. The before/after
 * run drives a 30-path batch with a 16 ms heartbeat: the batch ran off-thread
 * for 7.44 s while the loop served 422 ticks, max lag 10.4 ms; the synchronous
 * shape it replaces served ZERO ticks and blocked the loop for 8.65 s (its max
 * lag, read by the tick that finally ran).
 */
export const PROBE_CONCURRENCY = 4;

/**
 * Wall-clock ceiling on ONE path's probe, from the moment its turn starts
 * (queue time in the pool is not charged to it).
 *
 * Inside the deadline the measured autofs lookup (266-275 ms) answers as the
 * true "missing" it is; past it the answer is a FAULT - `exists: false` WITH
 * an `error` - because a probe that did not finish is not a statement that the
 * file is absent, and the difference is the whole diagnosis when a tile says
 * the file is gone and it is there. 1.75 s sits between the two measured ends:
 * well over any lookup the OS should answer, well under the multi-second
 * stalls the synchronous handler caused. NOTE the deadline bounds the ANSWER,
 * not the syscall: a timed-out stat still occupies a libuv thread until the OS
 * answers it, so a batch of hung mounts still costs the pool their queueing,
 * and what the deadline bounds is each answer's wait on that queue.
 */
export const PROBE_DEADLINE_MS = 1750;

/**
 * How long a POSITIVE answer (the path is there) stays usable, ms.
 *
 * Short, because a file the panel found can change while a turn streams:
 * `sizeBytes` and `mtimeMs` are read from this entry, and a re-open after half
 * a minute must see the numbers of a file an agent rewrote. Long enough to
 * absorb the deltas of one open, where the renderer's own book already asks
 * each spelling once per conversation (`use-mentioned-files.ts`).
 */
export const PROBE_POSITIVE_TTL_MS = 30_000;

/**
 * How long a NEGATIVE answer (nothing at that path) stays usable, ms.
 *
 * A negative answer is what the autofs storm is made of: the measured open
 * asked about 29 distinct `/home/ec2-user/*` paths, every one missed, and the
 * renderer re-asks misses on every transcript growth - so every open of the
 * session repeated the storm. Longer than the positive TTL because the fact is
 * more stable in the direction that hurts (a missing path that comes back is
 * the write-later flow, which the renderer already retries) and because these
 * are the lookups that cost 266-275 ms each. The honest bound this puts on
 * staleness, stated rather than implied: a file that appears while a negative
 * answer is cached stays reported missing for up to this window - including
 * to the renderer's growth retry, when the retry's resolved spelling is the
 * key the miss was stored under (`probeCacheKey` below explains when it is
 * not) - and the first probe after the window is the one that sees it.
 */
export const PROBE_NEGATIVE_TTL_MS = 120_000;

/**
 * Ceiling on remembered answers.
 *
 * A bound, not a budget calculation: both TTLs are two minutes at most, so
 * the map turns over on its own and this number only stops a pathological
 * mention stream from growing it for the life of the process. Entries are
 * small (a path, two numbers, a timestamp), so the worst case here is a few
 * hundred KB; 2048 is far more paths than one two-minute window of this app's
 * transcripts contains.
 */
export const PROBE_CACHE_LIMIT = 2048;

/** The `fs.Stats` facts the probe reads; a structural subset, so test fakes are small. */
export type ProbeStat = {
	isFile(): boolean;
	size: number;
	mtimeMs: number;
};

/**
 * The probe's injectable dependencies: the two filesystem answers and the
 * clock.
 *
 * Injectable because `src/main/index.ts` boots Electron on import - the same
 * reason this module exists - so the deadline, the pool bound and the TTLs
 * could only ever be exercised through fakes. The production answers are
 * `fsProbeDeps` below, and the tests inject their own to drive a hung stat, a
 * counting stat and a clock they control.
 */
export type ProbeDeps = {
	/**
	 * `fs.promises.stat` with `throwIfNoEntry: false`: `undefined` when nothing
	 * is there, and it THROWS on a genuine fault (EACCES, a stale mount) - the
	 * same split `statSync(..., { throwIfNoEntry: false })` gave the handler.
	 */
	stat(path: string): Promise<ProbeStat | undefined>;
	/**
	 * The fully resolved spelling, or `null` when it will not resolve. Never
	 * expected to throw: "will not resolve" includes every failure to the
	 * production implementation, exactly as `realPathOrNull` folded them.
	 */
	realpath(path: string): Promise<string | null>;
	/** Wall clock, ms, for the cache TTLs. */
	now(): number;
};

/**
 * One remembered answer, with the two facts the caller-facing shape does not
 * carry: when it was captured and how long it may live.
 *
 * `realPath` is remembered rather than the VERDICT: `outsideWorkspace` depends
 * on both sides, and the workspace root is per-call (`cwd` can differ between
 * two calls that ask the same path - a draft and the session it became), so
 * the verdict is recomputed from the cached target against the current root,
 * exactly as the old handler computed it per call. A cached verdict would be
 * wrong the moment two callers shared an entry.
 *
 * A fault (an `error`) is never stored here: it is a fact about ONE attempt,
 * not about the file, and persisting it either way would carry a diagnosis the
 * next attempt may refute.
 */
export type ProbeCacheEntry = {
	at: number;
	ttlMs: number;
	exists: boolean;
	isFile: boolean;
	sizeBytes: number | null;
	mtimeMs: number | null;
	realPath: string | null;
};

/** The cross-call cache: `(asked spelling, resolved path)` -> answer. */
export type ProbeFileCache = Map<string, ProbeCacheEntry>;

/**
 * The production dependencies: `fs.promises`, and the wall clock.
 *
 * `stat` keeps the `throwIfNoEntry: false` split - `undefined` for "nothing
 * there", a THROW for a genuine fault - because that split IS the answer's
 * `error` field, and it is spelled by hand here: the promise API honours
 * `throwIfNoEntry` (probing it: ENOENT and ENOTDIR both answer `undefined`),
 * but `@types/node` 22.14.1 does not type the option on `fs/promises.stat`,
 * and re-spelling the split is truer than casting the option past the
 * compiler. Only a path that is genuinely not there earns the "missing"
 * answer; every other errno throws, exactly as it did before. `realpath` folds
 * every failure to `null`, exactly as `realPathOrNull` did, so a target that
 * will not resolve stays the fail-closed "outside" rather than becoming a
 * fault.
 */
export const fsProbeDeps: ProbeDeps = {
	stat: async (path) => {
		try {
			return await fsStat(path);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT" || code === "ENOTDIR") return undefined;
			throw error;
		}
	},
	realpath: async (path) => {
		try {
			return await fsRealpath(path);
		} catch {
			return null;
		}
	},
	now: () => Date.now(),
};

/**
 * The cache every call shares unless one is injected.
 *
 * One map per process, which is the lifetime the win needs: the measured storm
 * was per-open, and the warm re-open that motivated the cache is seconds to
 * minutes after the first - well inside the TTLs. Tests pass their own map so
 * no case can see another's answers.
 */
const sharedProbeCache: ProbeFileCache = new Map();

/**
 * The cache key: the ASKED spelling and the RESOLVED path.
 *
 * Both, because each answers a question the other cannot. `resolved` makes the
 * key name a file (the same spelling under a different `cwd` is a different
 * target - `docs/a.md` from two sessions), and the asked spelling is what the
 * answer is paired to (the renderer matches results to tiles BY INPUT).
 *
 * One consequence worth stating, because the renderer's retry loop leans on
 * it: a missing path is re-asked in its RESOLVED spelling (`book.missing`),
 * and for a `~`-relative mention those are two keys - the retry gets a fresh
 * look at the filesystem, which is what lets the write-later flow flip to
 * present. For an absolute mention - every `/home/ec2-user/...` path in the
 * measured storm - the two spellings are the same key, and the retry is
 * absorbed by the cache instead of re-paying 266-275 ms per miss.
 */
function probeCacheKey(input: string, resolved: string): string {
	return `${input}\u0000${resolved}`;
}

/** The fault a probe reports when its filesystem work outlived the deadline. */
function probeDeadlineError(): Error {
	return new Error(`probe timed out after ${PROBE_DEADLINE_MS} ms`);
}

/**
 * `work` raced against the per-path deadline. The loser is not cancelled -
 * libuv has no cancellation for a stat already in flight - so a timed-out
 * probe's syscall still completes in the pool; `Promise.race` keeps its own
 * handler on the work promise, which is also why the work's eventual rejection
 * is not an unhandled rejection.
 */
async function withProbeDeadline<T>(work: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(probeDeadlineError()),
					PROBE_DEADLINE_MS,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The workspace root this call's containment verdicts are measured against:
 * the cwd through the same path rule as everywhere, then fully resolved -
 * ONCE per call, asynchronously, and under the same deadline.
 *
 * `null` means the question cannot be asked: no real resolution (the old
 * `realPathOrNull`'s answer to a throw), or the deadline fired. A `null` root
 * makes `outsideWorkspace` answer `undefined` - a caller told nothing rather
 * than told "inside" - and folding a slow root into that same `null`, rather
 * than faulting every path in the batch, keeps one slow lookup on the root
 * from turning every tile into an error.
 */
async function probeRealRoot(
	cwdPath: string,
	deps: ProbeDeps,
): Promise<string | null> {
	try {
		return await withProbeDeadline(deps.realpath(cwdPath));
	} catch {
		return null;
	}
}

/** The filesystem facts one path contributes, before they become an answer. */
type ProbeFacts = {
	exists: boolean;
	isFile: boolean;
	sizeBytes: number | null;
	mtimeMs: number | null;
	/** The fully resolved target, for the verdict; `null` when it did not resolve. */
	realPath: string | null;
	/** Present on a fault; a fault is never cached. */
	error?: string;
};

/**
 * One path, once: stat, then - only when it exists - realpath, both inside the
 * deadline. Never throws; a fault comes back as the `error` field so the
 * caller can answer WITHOUT claiming the file is missing.
 *
 * The realpath runs only for an existing target, as the old handler's did: a
 * miss is the common case on this path (the autofs storm is ALL misses) and
 * the containment verdict is only ever asked of something that exists.
 */
async function probeOnce(
	resolved: string,
	deps: ProbeDeps,
): Promise<ProbeFacts> {
	try {
		return await withProbeDeadline(
			(async (): Promise<ProbeFacts> => {
				const stat = await deps.stat(resolved);
				if (stat === undefined)
					return {
						exists: false,
						isFile: false,
						sizeBytes: null,
						mtimeMs: null,
						realPath: null,
					};
				const isFile = stat.isFile();
				return {
					exists: true,
					isFile,
					sizeBytes: isFile ? stat.size : null,
					mtimeMs: isFile ? stat.mtimeMs : null,
					realPath: await deps.realpath(resolved),
				};
			})(),
		);
	} catch (error) {
		// A genuine fault - permission, a stale network mount, the deadline - is not
		// the same answer as "no such file", and the difference is the whole
		// diagnosis when a tile says the file is gone and it is there.
		return {
			exists: false,
			isFile: false,
			sizeBytes: null,
			mtimeMs: null,
			realPath: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Remember an answer, under the cap and never for a fault.
 *
 * At the cap the OLDEST insertion is dropped. Deliberately FIFO, not LRU: with
 * TTLs of two minutes at most, everything in the map is dead within one storm's
 * worth of time anyway, and re-ordering on every hit is bookkeeping this win
 * does not need.
 */
function remember(
	cache: ProbeFileCache,
	key: string,
	facts: ProbeFacts,
	at: number,
): void {
	if (facts.error !== undefined) return;
	if (cache.size >= PROBE_CACHE_LIMIT) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(key, {
		at,
		ttlMs: facts.exists ? PROBE_POSITIVE_TTL_MS : PROBE_NEGATIVE_TTL_MS,
		exists: facts.exists,
		isFile: facts.isFile,
		sizeBytes: facts.sizeBytes,
		mtimeMs: facts.mtimeMs,
		realPath: facts.realPath,
	});
}

/**
 * Run `worker` over `items` with at most `limit` in flight. Each runner awaits
 * one item's worker before pulling the next, so the in-flight count is at most
 * the number of runners - the property the concurrency test pins.
 */
async function runWithLimit<T>(
	items: readonly T[],
	limit: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	const runners: Promise<void>[] = [];
	for (let index = 0; index < Math.min(limit, items.length); index += 1) {
		runners.push(
			(async () => {
				for (;;) {
					const taken = next;
					next += 1;
					if (taken >= items.length) return;
					await worker(items[taken]);
				}
			})(),
		);
	}
	await Promise.all(runners);
}

/**
 * Existence and identity for the Files panel, for one batch of asked paths.
 *
 * The contract is the one the handler has always had - response shape,
 * resolution rule, containment semantics, the `MAX_PROBE_PATHS` cap - with the
 * two changes the measured storm forces: everything here is asynchronous (no
 * `statSync`/`realpathSync` anywhere on this path), and the work is bounded and
 * cached (pool, deadline, TTLs) so a batch of slow autofs misses costs the
 * event loop nothing and a re-open costs the filesystem nothing. The account
 * of those changes is the block comment at the top of this section.
 *
 * `asked` is taken as the renderer sent it - each entry already a string (the
 * IPC wiring filters) - and is capped here, where the cap's rationale lives.
 */
export async function probeFiles(
	asked: readonly string[],
	cwd: string | undefined,
	home: string,
	deps: ProbeDeps = fsProbeDeps,
	cache: ProbeFileCache = sharedProbeCache,
): Promise<ProbedFile[]> {
	const inputs = asked.slice(0, MAX_PROBE_PATHS);

	/*
	 * The workspace root for this call's verdicts, started FIRST and awaited
	 * last, so its one lookup overlaps the batch rather than preceding it.
	 * `null` for no cwd; `probeRealRoot` folds an unresolvable or slow root to
	 * `null` as well (see its own note).
	 */
	const realRootPromise = cwd
		? probeRealRoot(resolveUserPath(cwd, undefined, home), deps)
		: Promise.resolve<string | null>(null);

	/*
	 * One unit per distinct cache key. `resolveUserPath` is pure string work
	 * (that is why it can stay synchronous here), so a path repeated in the
	 * batch - the renderer does repeat spellings across chunks - is resolved N
	 * times and PROBED once, which the old per-entry `map` did not do.
	 */
	type ProbeUnit = { resolved: string; facts: ProbeFacts | null };
	const units = new Map<string, ProbeUnit>();
	const keys = inputs.map((input) => {
		const resolved = resolveUserPath(input, cwd, home);
		const key = probeCacheKey(input, resolved);
		if (!units.has(key)) units.set(key, { resolved, facts: null });
		return key;
	});

	/* A cached answer is used while it lives; an expired one is re-probed. */
	const now = deps.now();
	for (const [key, unit] of units) {
		const entry = cache.get(key);
		if (entry === undefined) continue;
		if (now - entry.at < entry.ttlMs) unit.facts = entry;
		else cache.delete(key);
	}

	/* Everything the cache did not answer goes through the bounded pool. */
	await runWithLimit(
		[...units.entries()].filter(([, unit]) => unit.facts === null),
		PROBE_CONCURRENCY,
		async ([key, unit]) => {
			const facts = await probeOnce(unit.resolved, deps);
			unit.facts = facts;
			remember(cache, key, facts, deps.now());
		},
	);

	const realRoot = await realRootPromise;
	return inputs.map((input, index): ProbedFile => {
		const unit = units.get(keys[index]);
		const facts = unit?.facts;
		/*
		 * Unreachable by construction - every unit is a cache hit or was awaited
		 * above - and thrown rather than answered so a future edit that breaks the
		 * invariant fails loudly instead of shipping a lie about a file.
		 */
		if (unit === undefined || facts === null || facts === undefined)
			throw new Error("probe-files: an answered path went missing");
		if (facts.error !== undefined) {
			return {
				input,
				resolved: unit.resolved,
				exists: false,
				isFile: false,
				sizeBytes: null,
				mtimeMs: null,
				error: facts.error,
			};
		}
		return {
			input,
			resolved: unit.resolved,
			exists: facts.exists,
			isFile: facts.isFile,
			sizeBytes: facts.sizeBytes,
			mtimeMs: facts.mtimeMs,
			/*
			 * Asked only of a path that exists - the one caller that reads it (the
			 * composer's `@` chip) asks the question about a candidate reference,
			 * so a miss costs no second syscall, and the miss is the common case on
			 * this path. `undefined` when the question cannot be asked, which is the
			 * `null` root case (`outsideWorkspace` owns that rule).
			 */
			outsideWorkspace: facts.exists
				? outsideWorkspace(facts.realPath, realRoot)
				: undefined,
		};
	});
}
