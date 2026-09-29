/**
 * Shared fixture for the loader-continuity regressions
 * (`transcript-cursor-continuity.test.mjs`, `loader-state-machine.test.mjs`).
 *
 * WHY THIS EXISTS. The "I can't scroll past that" report (a 1233-entry journal
 * whose reader stalled three pages deep) was reproduced against the operator's
 * REAL journal with the backend's own `read_transcript_page`. That journal is
 * private and 200+ KB of prose, so it cannot live in the repository. What made
 * it fail was never its text; it was the SEQUENCE OF ENTRY KINDS at the page
 * boundaries: a silent `session_spend.v1` custom (which the reducer never turns
 * into a record) or a `tool` entry (keyed `tool:<callId>`, not by entry id) sat
 * at 7 of the 11 boundaries. `fixtures/loader-journal-shape.json` carries only
 * that kind sequence; this module mints a synthetic journal from it - fresh ids,
 * fresh instants, filler text - so the boundaries land where they did.
 *
 * THE FAKE PAGER follows the backend reader's contract (`read_transcript_page`),
 * restated in the design spec's C4: a page is the `limit` entries immediately
 * OLDER than `before_id` (exclusive), or the last `limit` entries when
 * `before_id` is absent, oldest-first; `has_more` is "an entry exists older than
 * the page"; an UNKNOWN `before_id` answers the CURRENT TAIL with
 * `cursor_missing: true`. It also supports the two mutations the regressions are
 * about: appending (a live turn) and deleting by kind (what `compact_file` does
 * to superseded `session_spend.v1` rows).
 *
 * THE REDUCER IS BUNDLED, NOT MOCKED, and the module list is probed so this file
 * runs against a tree that predates the fix: `load-older.ts` does not exist
 * there, and the regression must FAIL on behaviour rather than on a missing
 * import. `makeOlderLoader` therefore falls back to a small re-statement of the
 * pre-fix hook (`legacyOlderLoader`) when the module is absent.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const ROOT = resolve(import.meta.dirname, "..");
const CANONICAL = "src/renderer/src/features/chat/canonical";

export const PAGE_LIMIT = 100;
const BASE_TS = 1_790_000_000;

/** The committed entry-kind sequence (no text, ids or instants). */
export const shape = JSON.parse(
	readFileSync(
		resolve(ROOT, "scripts/fixtures/loader-journal-shape.json"),
		"utf8",
	),
);

/** Deterministic PRNG (mulberry32) so a failing seed reproduces exactly. */
export function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const entryId = (n) => `entry-${String(n).padStart(6, "0")}`;

/**
 * Mint entries from a kind sequence. `startAt` continues an existing journal
 * (ids and instants keep increasing), which is how a live turn is appended.
 */
export function mintEntries(kinds, startAt = 0, prefix = "") {
	const out = [];
	const pendingCalls = [];
	kinds.forEach((kind, offset) => {
		const n = startAt + offset;
		const base = { id: `${prefix}${entryId(n)}`, ts: BASE_TS + n * 2 };
		const [head, a, b] = kind.split(":");
		if (head === "custom" || head === "prune") {
			const payload =
				head === "prune"
					? { target: "x", notice: "x" }
					: { custom_type: a, details: {} };
			if (a === "completion_attention")
				payload.details = { anchor: "x", kind: "complete" };
			out.push({ ...base, type: head, payload });
		} else if (head === "compaction") {
			out.push({
				...base,
				type: "compaction",
				payload: { summary: "s", tokens_before: 1000 + n },
			});
		} else if (head === "user") {
			out.push({
				...base,
				type: "message",
				payload: {
					kind: "message",
					role: "user",
					content: [{ type: "text", text: `user ${n}` }],
				},
			});
		} else if (head === "assistant") {
			const calls = Number(a);
			const ids = Array.from({ length: calls }, (_, c) => `call-${n}-${c}`);
			pendingCalls.push(...ids);
			out.push({
				...base,
				type: "message",
				payload: {
					kind: "message",
					role: "assistant",
					content: b === "1" ? [{ type: "text", text: `assistant ${n}` }] : [],
					tool_calls: ids.map((id) => ({
						id,
						name: "bash",
						arguments: { i: "step", command: "true" },
					})),
					stop_reason: calls > 0 ? "toolUse" : "stop",
				},
			});
		} else if (head === "tool") {
			const callId = pendingCalls.shift() ?? `call-orphan-${n}`;
			out.push({
				...base,
				type: "message",
				payload: {
					kind: "message",
					role: "tool",
					content: [{ type: "text", text: "ok" }],
					tool_call_id: callId,
					tool_name: "bash",
					provider_payload: { details: null, duration_s: 0.1 },
				},
			});
		} else if (head === "message") {
			// A message-typed custom row (`payload.kind === "custom"`).
			out.push({
				...base,
				type: "message",
				payload: {
					kind: "custom",
					custom_type: a,
					details:
						a === "peer_message"
							? { text: "peer", body: "peer", sender: {} }
							: { text: `${a} ${n}` },
				},
			});
		} else {
			throw new Error(`unknown journal kind ${kind}`);
		}
	});
	return out;
}

/** The kind of one minted entry, in the fixture's own vocabulary. */
export const kindOf = (entry) =>
	entry.type === "custom"
		? `custom:${entry.payload.custom_type}`
		: entry.type === "message"
			? entry.payload.kind === "custom"
				? `message:${entry.payload.custom_type}`
				: entry.payload.role
			: entry.type;

/** The backend reader's contract, over an in-memory journal. */
export class FakeJournal {
	constructor(entries) {
		this.entries = [...entries];
	}

	static fromShape(kinds = shape.kinds) {
		return new FakeJournal(mintEntries(kinds));
	}

	get length() {
		return this.entries.length;
	}

	page(beforeId = null, limit = PAGE_LIMIT) {
		let end = this.entries.length;
		let cursorMissing = false;
		if (beforeId !== null && beforeId !== undefined) {
			const at = this.entries.findIndex((entry) => entry.id === beforeId);
			if (at < 0) cursorMissing = true;
			else end = at;
		}
		const start = Math.max(0, end - limit);
		return {
			entries: this.entries.slice(start, end),
			has_more: start > 0,
			cursor_missing: cursorMissing,
		};
	}

	/** A live turn: entries continue the id and instant sequence. */
	append(kinds) {
		const added = mintEntries(kinds, this.entries.length + 10_000);
		this.entries.push(...added);
		return added;
	}

	/** Delete entries by predicate; returns the deleted ids. */
	deleteWhere(predicate) {
		const gone = this.entries.filter(predicate).map((entry) => entry.id);
		const drop = new Set(gone);
		this.entries = this.entries.filter((entry) => !drop.has(entry.id));
		return gone;
	}

	/**
	 * `compact_file`: every message entry survives ("entry ids, order and types
	 * are unchanged"), and only the NEWEST `session_spend.v1` custom is kept.
	 */
	compact() {
		const spend = this.entries.filter(
			(entry) => kindOf(entry) === "custom:session_spend.v1",
		);
		const keep = spend.at(-1)?.id;
		return this.deleteWhere(
			(entry) =>
				kindOf(entry) === "custom:session_spend.v1" && entry.id !== keep,
		);
	}
}

/* ------------------------------------------------------------------ bundles */

async function bundleModule(contents) {
	const out = await build({
		stdin: { contents, resolveDir: ROOT },
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		tsconfig: resolve(ROOT, "tsconfig.web.json"),
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`
	);
}

/**
 * The reducer, the older-page loader (when the tree has one) and the paging
 * policy, bundled from the working tree.
 */
export async function loadModules() {
	const hasLoader = existsSync(resolve(ROOT, CANONICAL, "load-older.ts"));
	const reducer = await bundleModule(
		[
			`export * from "./${CANONICAL}/transcript-reducer";`,
			hasLoader ? `export * from "./${CANONICAL}/load-older";` : "",
		].join("\n"),
	);
	const paging = await bundleModule(
		`export * from "./${CANONICAL}/scroll-paging";`,
	);
	return { reducer, paging };
}

/* ------------------------------------------------------------------- loader */

/**
 * The hook's `loadOlder` as it stood before the fix, restated over the same
 * inputs, for a tree that has no `load-older.ts`. It reproduces the two facts the
 * regressions are about and nothing else: the store's own cursor is what it asks
 * from (with `historyCursorRef` overriding it after a miss), a miss re-anchors to
 * the TAIL page's first entry, the page is applied without saying it is a
 * continuation, and a caller arriving while a page is out is answered `false`
 * (which the pump counts as a failure).
 */
function legacyOlderLoader(m) {
	let busy = false;
	let historyCursor = null;
	return {
		async load(_key, deps) {
			if (busy) return { kind: "failed", reason: "request" };
			const t0 = deps.getTranscript();
			if (!t0.hasMore || !t0.oldestId)
				return { kind: "failed", reason: "request" };
			busy = true;
			try {
				const anchor = historyCursor ?? t0.oldestId;
				let page = await deps.readPage(anchor);
				let step = m.loadOlderStep(page, anchor, false);
				if (step.cursor !== null) {
					historyCursor = step.cursor;
					page = await deps.readPage(step.cursor);
					step = m.loadOlderStep(page, step.cursor, true);
				}
				historyCursor = step.cursor;
				if (step.failed) return { kind: "failed", reason: "request" };
				if (!deps.isCurrent()) return { kind: "failed", reason: "request" };
				const before = deps.getTranscript();
				const next = deps.commit((current) =>
					m.applyHistoryPage(current, page),
				);
				return {
					kind: "applied",
					newRecords: next.records.length - before.records.length,
					exhausted: !next.hasMore,
				};
			} catch {
				return { kind: "failed", reason: "request" };
			} finally {
				busy = false;
			}
		},
	};
}

/** A loader over this tree's reducer: the shipped one when it exists. */
export function makeOlderLoader(m) {
	return m.createOlderLoader ? m.createOlderLoader() : legacyOlderLoader(m);
}

/**
 * One reader over a fake journal: the transcript the store would hold, plus the
 * three ways the app moves it (open, tail re-apply, load older). Requests are
 * logged so a test can assert on WHAT was asked, not only on what came back.
 */
export class Reader {
	constructor(m, journal, { key = "session-a", onRead = null } = {}) {
		this.m = m;
		this.journal = journal;
		this.key = key;
		this.onRead = onRead;
		this.transcript = m.EMPTY_TRANSCRIPT;
		this.loader = makeOlderLoader(m);
		this.requests = [];
	}

	/** The cold open: the tail page, applied as the first page. */
	open() {
		this.transcript = this.m.applyHistoryPage(
			this.transcript,
			this.journal.page(null),
		);
		return this;
	}

	/** A reconnect snapshot / reconcile walk: the tail page, NO `keepPaging`. */
	reapplyTail() {
		this.transcript = this.m.applyHistoryPage(
			this.transcript,
			this.journal.page(null),
		);
		return this.transcript;
	}

	/** One load-older ask, through the loader the hook uses. */
	loadOlder({ key = this.key } = {}) {
		const requested = key;
		const first = this.requests.length;
		const pending = this.loader.load(requested, {
			getTranscript: () => this.transcript,
			readPage: async (beforeId) => {
				const page = this.journal.page(beforeId);
				this.requests.push({
					before: beforeId,
					missing: page.cursor_missing,
					threw: false,
				});
				await Promise.resolve();
				this.onRead?.(beforeId, page);
				if (this.failNext > 0) {
					this.failNext -= 1;
					this.requests.at(-1).threw = true;
					throw new Error("request failed");
				}
				return page;
			},
			isCurrent: () => this.key === requested,
			commit: (update) => {
				this.transcript = update(this.transcript);
				return this.transcript;
			},
		});
		// Tag every request this ask made with how it ended, so an invariant can
		// tell a repeated ask that RE-FETCHES a page the reader holds (a defect)
		// from one that retries a page that was never applied (a failure, or a
		// stale page dropped after a session switch - both legitimate).
		return pending.then((outcome) => {
			for (const request of this.requests.slice(first))
				request.outcome ??= outcome.kind;
			return outcome;
		});
	}

	failNext = 0;

	/** Page until the cursor stops moving or the start is reached. */
	async loadAll(limit = 40) {
		let asks = 0;
		while (this.transcript.hasMore && asks < limit) {
			asks += 1;
			await this.loadOlder();
		}
		return asks;
	}

	/** Ids of every RECORD the journal's full history would produce. */
	fullRecordIds() {
		const all = this.m.applyHistoryPage(
			this.m.EMPTY_TRANSCRIPT,
			{
				entries: this.journal.entries,
				has_more: false,
				cursor_missing: false,
			},
			{ replace: true },
		);
		return all.records.map((record) => record.id);
	}
}

/** Short id for assertion messages. */
export const short = (id) => String(id).slice(-6);
