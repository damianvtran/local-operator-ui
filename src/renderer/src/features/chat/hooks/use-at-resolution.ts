/**
 * The one place a draft's `@` tokens are asked about, so the chip's decoration
 * and the composer's atomic delete cannot disagree about which spans resolve.
 *
 * WHY IT IS A HOOK RATHER THAN A PROBE PER CALLER. Two surfaces read the answer —
 * the chip layer, which paints a fill behind every resolving token, and the
 * composer's key handler, which takes a whole token on one Backspace at its edge
 * — and a second probe would be a second request per keystroke on the composer's
 * own keystroke path, with two answers that can differ by the width of a round
 * trip. One owner, one answer.
 *
 * RESOLUTION IS THE MAIN PROCESS'S (`probe-files`), never re-implemented here:
 * that call already resolves symlinks with `statSync` and already applies the one
 * path rule including `~` and cwd-relative joining, so the chip and the batch the
 * harness builds on submit cannot disagree about which file `@src/app.py` names.
 *
 * WHAT THE ANSWER CARRIES, and the one thing it deliberately does not:
 *
 *   - `exists` is what makes a token a chip, and `isFile` distinguishes a file
 *     from a directory — both facts the probe already answered for the Files
 *     panel.
 *   - `outsideWorkspace` is the containment verdict, computed in main against the
 *     same resolved paths the harness's approval gate compares
 *     (`directory-listing.ts`). It exists because the chip states ONE thing its
 *     absence cannot: this reference will ask for approval. What it does NOT
 *     cover is the harness's deny-list (`.env`, `.pem`, `.ssh/…`), which is
 *     backend state in the module that owns it and therefore not something this
 *     process may re-spell — a `.env` inside the workspace chips plainly and
 *     raises its card at submit, which is the honest half of the trade the design
 *     direction names.
 *     THE GAP IS REACHABLE WITH THE MOUSE, not only by typing a deny-listed path:
 *     the picker's exclusions are dotfiles and `PRUNE_NAMES`, which is the
 *     harness's LISTING vocabulary rather than its gate — `id_rsa`,
 *     `credentials`, `server.pem` and `prod.env` are offered as ordinary rows, and
 *     accepting one writes a plain chip over a path whose `read` raises a
 *     "may hold secrets" card (review round 1, N1). Stated here because a
 *     disclosure that describes the gap as a typing-only case understates it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_PROBE_PATHS } from "../../../../../shared/desktop-contract";
import { type AtResolved, atChipSpans } from "../components/at-contract";
import { type AtSpan, atTokenSpans } from "../components/at-token";

/**
 * How long a draft may keep changing before the batch is asked.
 *
 * Longer than the picker's listing debounce because this probe runs on EVERY
 * keystroke of a draft that holds a token, including the many that only extend a
 * path which cannot resolve yet — the common case here is a miss, and a miss is
 * what the debounce collapses.
 */
export const AT_RESOLVE_DEBOUNCE_MS = 120;

/** The probe bridge, as this module uses it. Absent outside Electron. */
type ProbeBridge = {
	probeFiles: (
		paths: string[],
		cwd?: string,
	) => Promise<
		{
			input: string;
			exists: boolean;
			isFile: boolean;
			outsideWorkspace?: boolean;
		}[]
	>;
};

export type AtResolution = {
	/** Every candidate token in the draft, in order. */
	spans: AtSpan[];
	/** The spans that are chips, keyed by their `start:end`. */
	resolved: ReadonlyMap<string, AtResolved>;
};

export function useAtResolution({
	text,
	cwd,
	enabled = false,
}: {
	text: string;
	cwd?: string;
	/**
	 * Whether a mention expands at all — see `UseAtPickerArgs.enabled` for the two
	 * states this folds and why it fails closed. FALSE HERE MEANS NO SPANS: no
	 * probe is issued, no fill is painted AND the atomic delete is inert, because
	 * the delete asks this hook which tokens are chips.
	 */
	enabled?: boolean;
}): AtResolution {
	const spans = useMemo(
		() => (enabled ? atTokenSpans(text) : []),
		[text, enabled],
	);

	/*
	 * The cache, keyed by the path as typed, holding only POSITIVE answers.
	 *
	 * Negatives are deliberately not cached: a partial path misses on every
	 * keystroke, and caching those would be the cheap win — but it would also keep
	 * a file the user just created from ever chipping, because nothing about the
	 * draft would change to invalidate the entry. So a hit is remembered (a
	 * resolved path stays resolved for this composer's lifetime, which is what
	 * makes the atomic delete's answer cheap and stable) and a miss is asked again
	 * on the next pass, at one batched request per debounce.
	 */
	const cache = useRef(
		new Map<string, { exists: boolean; outside: boolean }>(),
	);
	const cacheCwd = useRef<string | undefined>(cwd);
	const [facts, setFacts] = useState<
		ReadonlyMap<string, { exists: boolean; outside: boolean }>
	>(new Map());

	/*
	 * The batch, sorted and de-duplicated so an identical draft is an identical
	 * request, and capped at the probe's own per-call limit (`MAX_PROBE_PATHS`).
	 * Past the cap the excess is left UNDECORATED rather than chunked: the harness
	 * itself refuses more than about 215 uniform tokens, so a draft over 64
	 * resolvable references is already outside what expansion will carry, and
	 * decorating the first 64 while saying nothing about the rest is the honest
	 * half-measure rather than a silent second request storm.
	 */
	const paths = useMemo(() => {
		const unique = new Set<string>();
		for (const span of spans) {
			if (span.path) unique.add(span.path);
			if (unique.size >= MAX_PROBE_PATHS) break;
		}
		return [...unique];
	}, [spans]);
	const pathsKey = paths.join("\n");

	// biome-ignore lint/correctness/useExhaustiveDependencies: the request is keyed by `pathsKey`, the batch's own identity; `paths` is an array rebuilt every render and listing it would re-run the request with nothing changed.
	useEffect(() => {
		const api = (window as unknown as { api?: Partial<ProbeBridge> }).api;
		/*
		 * A MOVED WORKING DIRECTORY INVALIDATES EVERY ANSWER IN THE CACHE
		 * (review round 1, M1).
		 *
		 * The answers are RELATIVE — `@src/app.py` is a different file under a
		 * different cwd — and the composer is not remounted when the session's
		 * directory moves (`chat-content.tsx` passes no `key`; `cwd` arrives as a
		 * prop), so the ref survived the move and the effect's `missing.length === 0`
		 * short-circuit re-set the OLD map without ever asking again. Reproduced:
		 * a draft whose file exists under `/A` kept its chip after the session moved
		 * to `/B`, where the path does not exist — the chip outliving the file it
		 * names, which is the one thing the design's rule ("the chip <=> the token
		 * resolves") exists to make impossible. The stale `outside` verdict travelled
		 * with it, so a chip could be plain over a path the gate would card.
		 *
		 * Cleared rather than keyed: the cache exists to make a RE-ASK cheap inside
		 * one workspace, and a keyed map would keep every workspace's answers alive
		 * in a composer that has one cwd at a time. The facts are cleared with it
		 * because they are the same answers one render later — leaving them would
		 * paint the moved workspace from the old one for the debounce window.
		 */
		if (cacheCwd.current !== cwd) {
			cacheCwd.current = cwd;
			cache.current.clear();
			setFacts(new Map());
		}
		if (
			!enabled ||
			paths.length === 0 ||
			typeof api?.probeFiles !== "function"
		) {
			setFacts((current) => (current.size > 0 ? new Map() : current));
			return;
		}
		const missing = paths.filter((path) => !cache.current.has(path));
		if (missing.length === 0) {
			// Every path in this draft has been answered before, so the pass costs one
			// render and no request: the common case on the keystroke path once a mention
			// has been typed and the user is editing around it.
			setFacts(new Map(cache.current));
			return;
		}
		let cancelled = false;
		const timer = setTimeout(() => {
			api
				.probeFiles?.(missing, cwd)
				.then((answers) => {
					if (cancelled) return;
					for (const answer of answers) {
						if (!answer.exists) continue;
						cache.current.set(answer.input, {
							exists: true,
							// `outsideWorkspace` is absent when main could not ask (no
							// workspace root), and an unanswerable question is NOT "outside":
							// a chip painted for it would warn about a path the gate may
							// never ask about. The card at submit is unaffected either way.
							outside: answer.outsideWorkspace === true,
						});
					}
					setFacts(new Map(cache.current));
				})
				.catch(() => {
					// A probe that failed says nothing about whether the path exists, so
					// the decoration simply does not change. Losing the previous fills
					// because a stat call threw would be the worse failure.
				});
		}, AT_RESOLVE_DEBOUNCE_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [pathsKey, cwd]);

	const resolved = useMemo(() => atChipSpans(spans, facts), [spans, facts]);
	return { spans, resolved };
}
