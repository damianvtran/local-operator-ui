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
}: {
	text: string;
	cwd?: string;
}): AtResolution {
	const spans = useMemo(() => atTokenSpans(text), [text]);

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
		if (paths.length === 0 || typeof api?.probeFiles !== "function") {
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
