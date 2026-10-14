import {
	type RefObject,
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { flushSync } from "react-dom";
import {
	type EntryDescriptor,
	type EntryMeasurement,
	buildHeightIndex,
	invalidateEntryMeasurements,
	seedEntryEstimates,
	windowSegments,
} from "./transcript-dom-window";
import type { ScrollLayoutCoordinator } from "./transcript-scroll-layout";

export type TranscriptMountAdapter = {
	requested: boolean;
	acquire: (id: string) => () => void;
};

/** Resolved once per transcript mount; an explicit off always beats the build opt-in. */
export function transcriptDomWindowEnabled(): boolean {
	try {
		const local = window.localStorage.getItem("canonicalTranscriptDomWindow");
		if (local === "off") return false;
		return (
			local === "on" ||
			import.meta.env.VITE_CANONICAL_TRANSCRIPT_DOM_WINDOW === "1"
		);
	} catch {
		return false;
	}
}

/**
 * DOM scope follows the full entry partition. It never changes model scope,
 * hiddenRows or paging demand. Stateful descendants get disjoint DOM leases;
 * only a high-density corpus falls back to the full DOM. A lower mount count
 * is not worth silently resetting an editor, media player or tool disclosure.
 */
export function useTranscriptDomWindow({
	entries,
	regionRef,
	entriesRef,
	layout,
	sessionKey,
	requested,
	contentPresent = true,
}: {
	entries: readonly EntryDescriptor[];
	regionRef: RefObject<HTMLElement | null>;
	entriesRef: RefObject<HTMLDivElement | null>;
	layout: ScrollLayoutCoordinator;
	sessionKey: string;
	requested: boolean;
	contentPresent?: boolean;
}) {
	const cache = useRef(new Map<string, EntryMeasurement>());
	const estimates = useRef(new Map<string, EntryMeasurement>());
	const navigation = useRef(new Map<symbol, string>());
	const editorPins = useRef(new Set<string>());
	const [revision, setRevision] = useState(0);
	const [viewport, setViewport] = useState({ top: 0, bottom: 0, width: 0 });
	const [interaction, setInteraction] = useState<string | null>(null);
	const [selection, setSelection] = useState(false);
	const [fault, setFault] = useState<string | null>(null);
	const generation = useRef(sessionKey);
	const committedSession = useRef(sessionKey);
	const descriptors = useMemo(
		() => new Map(entries.map((entry) => [entry.key, entry])),
		[entries],
	);
	const latest = useRef(descriptors);
	latest.current = descriptors;
	const generationChanged = generation.current !== sessionKey;
	if (generationChanged) {
		generation.current = sessionKey;
		cache.current.clear();
		estimates.current.clear();
		navigation.current.clear();
		editorPins.current.clear();
		layout.cancel();
		setFault(null);
		setInteraction(null);
		setSelection(false);
		setViewport({ top: 0, bottom: 0, width: 0 });
	}
	const refresh = useCallback(() => {
		const region = regionRef.current;
		const area = entriesRef.current;
		if (!region || !area) return;
		const box = area.getBoundingClientRect();
		const top = region.getBoundingClientRect().top + region.clientTop - box.top;
		const next = { top, bottom: top + region.clientHeight, width: box.width };
		setViewport((previous) =>
			previous.top === next.top &&
			previous.bottom === next.bottom &&
			previous.width === next.width
				? previous
				: next,
		);
	}, [regionRef, entriesRef]);
	const recordToEntry = useMemo(() => {
		const map = new Map<string, number>();
		entries.forEach((entry, index) => {
			for (const id of entry.recordIds) map.set(id, index);
		});
		return map;
	}, [entries]);
	// Capture BEFORE projecting leases/ranges. Beginning only after projection
	// can choose a row the projection has just scheduled for unmount.
	if (requested) {
		if (!contentPresent) layout.cancel();
		else if (committedSession.current === sessionKey) layout.begin();
	}
	let held = requested ? layout.heldId() : null;
	const owner = held ? recordToEntry.get(held) : undefined;
	if (
		owner !== undefined &&
		entries[owner].collapsed &&
		held !== entries[owner].recordIds[0]
	) {
		layout.retarget(held as string, entries[owner].recordIds[0]);
		held = layout.heldId();
	}
	const missingLease = held !== null && !recordToEntry.has(held);
	const statePins = entries.flatMap((entry, index) =>
		entry.unsafe || entry.active || editorPins.current.has(entry.key)
			? [index]
			: [],
	);
	const densePins =
		statePins.length > 64 ||
		(entries.length > 20 && statePins.length > entries.length * 0.6);
	const reason = !requested
		? "disabled"
		: (fault ??
			(selection
				? "selection"
				: densePins
					? "pinned-state-density"
					: missingLease
						? "missing-anchor-entry"
						: null));
	const prefix = requested
		? buildHeightIndex(
				seedEntryEstimates(
					entries,
					cache.current,
					estimates.current,
					viewport.width,
				),
				cache.current,
				viewport.width,
			)
		: [0];
	// Tiny conversations stay intrinsic; estimates must not defeat mb-auto.
	const enabled =
		reason === null &&
		entries.length > 20 &&
		viewport.bottom > viewport.top &&
		prefix[prefix.length - 1] > (viewport.bottom - viewport.top) * 3;
	// Unsafe local state is an exceptional disjoint lease, not a reason that
	// one picture or code answer disables the rest of a long conversation.
	const leases = [...statePins];
	for (const id of [...navigation.current.values(), ...(held ? [held] : [])]) {
		const index = recordToEntry.get(id);
		if (index !== undefined) leases.push(index);
	}
	if (interaction) {
		const index = entries.findIndex((entry) => entry.key === interaction);
		if (index >= 0) leases.push(index);
	}
	const pieces = enabled
		? windowSegments(
				prefix,
				viewport.top,
				viewport.bottom,
				viewport.bottom - viewport.top,
				leases,
			)
		: entries.map((_, index) => ({ kind: "entry" as const, index }));
	const mountedKeysKey = JSON.stringify(
		pieces.flatMap((piece) =>
			piece.kind === "entry" ? [entries[piece.index].key] : [],
		),
	);
	const cueGeometry = useRef("");
	// React's layout phase cannot capture removed DOM; the transaction above
	// already sampled the old committed tree and included its exact lease.

	useLayoutEffect(() => {
		committedSession.current = sessionKey;
		if (requested && contentPresent) {
			// A vanished row is a transient fail-open, not a session-long opt-out.
			setFault(layout.commit() ? null : "missing-held-node");
		}
		const area = entriesRef.current;
		if (!area || !requested || !contentPresent) return;
		const width = area.getBoundingClientRect().width;
		const keys = new Set(entries.map((entry) => entry.key));
		for (const key of cache.current.keys())
			if (!keys.has(key)) cache.current.delete(key);
		for (const key of estimates.current.keys())
			if (!keys.has(key)) estimates.current.delete(key);
		let changed = false;
		for (const element of area.querySelectorAll<HTMLElement>(
			"[data-lo-entry-key]",
		)) {
			const descriptor = descriptors.get(element.dataset.loEntryKey ?? "");
			if (
				!descriptor ||
				!element.isConnected ||
				(element.dataset.loEntrySignature !== undefined &&
					element.dataset.loEntrySignature !== descriptor.signature)
			)
				continue;
			const old = cache.current.get(descriptor.key);
			if (old?.signature === descriptor.signature && old.width === width)
				continue;
			const height = element.getBoundingClientRect().height;
			if (
				old?.signature !== descriptor.signature ||
				old.width !== width ||
				Math.abs(old.height - height) > 0.01
			) {
				cache.current.set(descriptor.key, {
					signature: descriptor.signature,
					width,
					height,
					kind:
						element.querySelector<HTMLElement>("[data-lo-transition-phase]")
							?.dataset.loTransitionPhase === "interpolating"
							? undefined
							: descriptor.estimateKind,
					gap: descriptor.gapPx,
				});
				changed = true;
			}
		}
		if (changed && requested) {
			layout.begin();
			setRevision((value) => value + 1);
		}
		refresh();
		const cueKey = enabled
			? `${entries.map((entry) => entry.key).join(",")}:${mountedKeysKey}:${viewport.top}:${viewport.width}:${viewport.bottom - viewport.top}:${prefix.join(",")}`
			: "";
		if (cueGeometry.current !== cueKey) {
			cueGeometry.current = cueKey;
			regionRef.current?.dispatchEvent(new Event("lo:transcript-layout"));
		}
	});

	useLayoutEffect(() => {
		if (!requested || !contentPresent) return;
		const region = regionRef.current;
		const area = entriesRef.current;
		if (!region || !area) return;
		const capturedGeneration = sessionKey;
		const mountedKeys = new Set<string>(JSON.parse(mountedKeysKey));
		const observer = new ResizeObserver((observations) => {
			if (generation.current !== capturedGeneration) return;
			let changed = false;
			const width = area.getBoundingClientRect().width;
			for (const observation of observations) {
				const element = observation.target as HTMLElement;
				if (!element.isConnected) continue;
				const descriptor = latest.current.get(element.dataset.loEntryKey ?? "");
				if (
					!descriptor ||
					!element.isConnected ||
					(element.dataset.loEntrySignature !== undefined &&
						element.dataset.loEntrySignature !== descriptor.signature)
				)
					continue;
				const height = element.getBoundingClientRect().height;
				const previous = cache.current.get(descriptor.key);
				if (
					previous?.signature === descriptor.signature &&
					previous.width === width &&
					Math.abs(previous.height - height) < 0.01
				)
					continue;
				cache.current.set(descriptor.key, {
					signature: descriptor.signature,
					width,
					height,
					kind:
						element.querySelector<HTMLElement>("[data-lo-transition-phase]")
							?.dataset.loTransitionPhase === "interpolating"
							? undefined
							: descriptor.estimateKind,
					gap: descriptor.gapPx,
				});
				changed = true;
			}
			if (changed) {
				layout.begin();
				flushSync(() => setRevision((value) => value + 1));
			}
		});
		observer.observe(region);
		observer.observe(area);
		for (const element of area.querySelectorAll<HTMLElement>(
			"[data-lo-entry-key]",
		))
			if (mountedKeys.has(element.dataset.loEntryKey ?? ""))
				observer.observe(element);
		// Commit synchronously on scroll: a scrollbar teleport must not paint an
		// empty estimated canvas while a rAF-delayed range catches up.
		const scroll = () => {
			layout.begin();
			flushSync(refresh);
		};
		const focus = () =>
			setInteraction(
				document.activeElement?.closest<HTMLElement>("[data-lo-entry-key]")
					?.dataset.loEntryKey ?? null,
			);
		const select = () => {
			const range = window.getSelection();
			setSelection(
				Boolean(range?.toString()) &&
					Boolean(
						(range?.anchorNode && region.contains(range.anchorNode)) ||
							(range?.focusNode && region.contains(range.focusNode)),
					),
			);
		};
		const edit = (event: Event) => {
			const target = event.target as HTMLElement;
			const key = target.closest<HTMLElement>("[data-lo-entry-key]")?.dataset
				.loEntryKey;
			if (
				key &&
				target.matches("input, textarea, [contenteditable=true]") &&
				!editorPins.current.has(key)
			) {
				editorPins.current.add(key);
				setRevision((value) => value + 1);
			}
		};
		region.addEventListener("scroll", scroll, { passive: true });
		region.addEventListener("focusin", focus);
		region.addEventListener("focusout", focus);
		document.addEventListener("selectionchange", select);
		region.addEventListener("input", edit);
		return () => {
			observer.disconnect();
			region.removeEventListener("scroll", scroll);
			region.removeEventListener("focusin", focus);
			region.removeEventListener("focusout", focus);
			document.removeEventListener("selectionchange", select);
			region.removeEventListener("input", edit);
		};
	}, [
		requested,
		regionRef,
		entriesRef,
		layout,
		refresh,
		mountedKeysKey,
		contentPresent,
		sessionKey,
	]);

	useLayoutEffect(() => {
		if (!requested || !contentPresent) return;
		const area = entriesRef.current;
		if (!area || generation.current !== sessionKey) return;
		const invalidate = () => {
			layout.begin();
			invalidateEntryMeasurements(cache.current, estimates.current);
			setRevision((value) => value + 1);
		};
		const regime = () => {
			const style = window.getComputedStyle(area);
			const typography = Array.from({ length: style.length }, (_, index) =>
				style.item(index),
			).filter(
				(name) =>
					name.startsWith("--font-") ||
					name.startsWith("--text-") ||
					name.startsWith("--lo-display-") ||
					name === "--spacing",
			);
			return `${style.font}:${window.getComputedStyle(document.documentElement).fontSize}:${typography.map((name) => `${name}=${style.getPropertyValue(name)}`).join(";")}`;
		};
		let previousRegime = regime();
		const changedRegime = () => {
			const next = regime();
			if (next !== previousRegime) {
				previousRegime = next;
				invalidate();
			}
		};
		// Paint-only palette/mask changes must not resize omitted history. Font
		// loading is different: CSS names stay identical while glyph metrics change.
		document.fonts?.addEventListener("loadingdone", invalidate);
		const theme = new MutationObserver(changedRegime);
		for (
			let ancestor = area.parentElement;
			ancestor;
			ancestor = ancestor.parentElement
		)
			theme.observe(ancestor, {
				attributes: true,
				attributeFilter: ["class", "style", "data-theme"],
			});
		return () => {
			document.fonts?.removeEventListener("loadingdone", invalidate);
			theme.disconnect();
		};
	}, [requested, layout, contentPresent, entriesRef, sessionKey]);

	const acquire = useCallback(
		(id: string) => {
			if (!requested) return layout.retainNavigation();
			const token = Symbol(id);
			const capturedGeneration = generation.current;
			navigation.current.set(token, id);
			const releaseNavigation = layout.retainNavigation();
			layout.begin();
			setRevision((value) => value + 1);
			return () => {
				releaseNavigation();
				if (generation.current !== capturedGeneration) return;
				layout.begin();
				navigation.current.delete(token);
				setRevision((value) => value + 1);
			};
		},
		[layout, requested],
	);
	return {
		requested,
		prefix,
		pinned: statePins.length,
		pieces,
		enabled,
		reason: reason ?? (enabled ? "windowed" : "short-transcript"),
		revision,
		acquire,
	};
}
