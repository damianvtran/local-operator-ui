/**
 * Keeping a path-backed asset's preview current with the file on disk.
 *
 * WHY mtime AND NOT A WATCHER. The same reason the canvas's
 * `chat/components/canvas/file-freshness.ts` states at length: the things that
 * rewrite one of these files do not announce themselves in a way a watcher can
 * use (an agent's tool call writes through a Python process, an editor renames a
 * temporary file over the original, a shell pipeline truncates in place), and
 * `fs.watch` costs a descriptor per open panel and behaves differently on every
 * platform. The modification time is the signal all of those share, and the
 * main process already answers it (`probeFiles`, from `statSync`).
 *
 * WHY THE POLL IS NOT THE ONLY TRIGGER. Polling every mounted preview would
 * spend a stat per tick on a panel nobody is looking at. So the checks are the
 * canvas's own set: on mount, when the window comes back to the front (including
 * a tab that became visible again), a slow poll while the window IS visible, and
 * an explicit `refreshTick` the preview bumps when a conversation turn settles —
 * the agent usually wrote the file it was asked about, and the settle is the
 * moment worth re-probing without waiting for the next tick.
 *
 * WHAT THIS DOES NOT DO. It does not decide what to render: it reports the
 * file's facts and a `revision` that moves when the mtime moves, and the viewer
 * reads again under that key (the canvas's "repoint" rule). Digest-only assets
 * have no path to watch and are not polled at all — their bytes come from the
 * library's content route and do not change under the reader.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopLibraryAsset } from "../../../../../shared/desktop-control-contract";

/** The visible-window poll interval; the canvas's own cadence. */
const VISIBLE_POLL_MS = 2000;

export type LibraryFileState = {
	/** The path's mtime as last probed, or null before the first answer. */
	mtimeMs: number | null;
	/** The path's size as last probed, or null. */
	sizeBytes: number | null;
	/**
	 * Bumped whenever the probe saw a newer mtime. Viewers key their reads by
	 * it, which is what makes the `repoint` arm a re-read rather than a re-render.
	 */
	revision: number;
	/** The path no longer resolves — the viewer keeps its last bytes and says so. */
	missing: boolean;
};

/** Whether this asset is read from a live path at all. */
export function isPathBacked(asset: DesktopLibraryAsset): boolean {
	return (
		asset.ref.type === "path" &&
		Boolean(asset.ref.path) &&
		asset.exists === true
	);
}

export function useLibraryFileWatch(
	asset: DesktopLibraryAsset,
	/** A counter the host bumps when something else says "look again now". */
	refreshTick: number,
): LibraryFileState {
	const path = isPathBacked(asset) ? asset.ref.path : null;
	const [state, setState] = useState<LibraryFileState>({
		mtimeMs: null,
		sizeBytes: null,
		revision: 0,
		missing: false,
	});
	/*
	 * The mtime the last answer carried, read by the probe without making it a
	 * dependency: a probe that re-armed on its own setState would re-subscribe
	 * every poll interval.
	 */
	const knownMtime = useRef<number | null>(null);
	const inflight = useRef(false);

	/*
	 * A SWITCHED ASSET IS A NEW FILE, NOT A NEW READING OF THE OLD ONE. The
	 * preview is not remounted on a selection change, so `path` can move under
	 * this hook; without this reset A's size and mtime would paint on B's strip
	 * and B's first probe (same mtime as the remembered one, by chance or by a
	 * copied file) would not move the revision, so the viewer would keep A's
	 * bytes. The revision starts again at zero deliberately: it is a per-path
	 * key, and the viewers keyed by it are re-reading a different file.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: path is the reset trigger, not a value the body reads.
	useEffect(() => {
		knownMtime.current = null;
		setState({
			mtimeMs: null,
			sizeBytes: null,
			revision: 0,
			missing: false,
		});
	}, [path]);

	const probe = useCallback(async () => {
		if (!path || !window.api?.probeFiles) return;
		if (inflight.current) return;
		inflight.current = true;
		try {
			/*
			 * `fresh`: the answer cache serves a positive stat for 30 s, which is
			 * right for a chip and wrong for a watcher - see `probeFiles`'s own
			 * parameter. Without it a 2 s poll could report a change 29 s late.
			 */
			const [answer] = await window.api.probeFiles([path], undefined, {
				fresh: true,
			});
			if (!answer) return;
			/*
			 * A probe that could not LOOK (`error`) is not "the file is gone":
			 * the contract's own note says the two must stay distinguishable, and
			 * a reader told their file vanished will go looking at one that is
			 * right there. Only a clean absence is reported as missing.
			 */
			const missing = answer.exists === false && !answer.error;
			const mtimeMs = answer.mtimeMs ?? null;
			const moved = mtimeMs !== null && mtimeMs !== knownMtime.current;
			knownMtime.current = mtimeMs;
			setState((previous) => ({
				mtimeMs,
				sizeBytes: answer.sizeBytes ?? null,
				revision: moved ? previous.revision + 1 : previous.revision,
				missing,
			}));
		} finally {
			inflight.current = false;
		}
	}, [path]);

	// Mount, path change, and the host's own "look again" tick.
	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshTick is the signal, not a value the body reads.
	useEffect(() => {
		void probe();
	}, [probe, refreshTick]);

	/*
	 * The window's return, and the visible-window poll. Both are established
	 * once per path; the interval itself checks visibility at each tick rather
	 * than being torn down and rebuilt on every visibility change, which would
	 * reset the cadence each time the user glanced elsewhere.
	 */
	useEffect(() => {
		if (!path) return;
		const onFocus = () => void probe();
		const onVisibility = () => {
			if (document.visibilityState === "visible") void probe();
		};
		window.addEventListener("focus", onFocus);
		document.addEventListener("visibilitychange", onVisibility);
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible") void probe();
		}, VISIBLE_POLL_MS);
		return () => {
			window.removeEventListener("focus", onFocus);
			document.removeEventListener("visibilitychange", onVisibility);
			window.clearInterval(timer);
		};
	}, [path, probe]);

	return state;
}
