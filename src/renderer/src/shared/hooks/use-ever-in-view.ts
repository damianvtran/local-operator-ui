import { type RefCallback, useCallback, useEffect, useState } from "react";

/**
 * Whether an element has EVER been near the viewport, latched true.
 *
 * WHY THIS EXISTS. A surface that does expensive work per row (here: reading a
 * file's bytes over IPC for a thumbnail) must not do it for rows nobody has
 * scrolled to. `<img loading="lazy">` used to give that for free, because the
 * browser deferred the image's network request; once the bytes come from a
 * bridge call made in an effect, nothing defers it, and a Files grid of N media
 * rows read N files at mount (agent review round 1, R2; design round 1, D3).
 *
 * LATCHED, NOT TRACKED. Once a row has been seen it keeps its answer: tracking
 * leaving the viewport would revoke the blob and re-read the file on every
 * scroll back, trading memory for repeated IPC reads of files that can be
 * megabytes. The bound on memory is "rows the reader has scrolled near", which
 * is the old route's bound too.
 *
 * `rootMargin` starts the read slightly BEFORE the row is visible, so a
 * thumbnail is usually painted by the time the row arrives.
 *
 * IT FAILS OPEN: where no `IntersectionObserver` exists (a harness, a stripped
 * host) the answer is `true` from the first render, so no host loses its
 * thumbnails to a rig that cannot observe - the same posture the composer's
 * on-screen check takes.
 *
 * THE OBSERVER IS BUILT IN AN EFFECT, NOT IN THE REF CALLBACK (agent review
 * round 2, R2-1). The ref callback records which node it was handed; the effect
 * keyed on that node is what observes it, and what disconnects it. The split is
 * forced by `React.StrictMode`, which the app mounts itself under (`main.tsx`):
 * React 18 surfaces a missing cleanup by running a mount through
 * mount -> cleanup -> mount, and it does NOT re-invoke the ref callback for that
 * simulated remount. With the build in the callback and only the disconnect in
 * the effect, the cleanup killed the one observer and nothing built another -
 * the row kept a non-null `observer.current` that observed nothing, and `seen`
 * stayed false for its whole life. In a production build (one mount pass) that
 * was invisible, which is how the round-1 frames missed it; in `pnpm dev` every
 * Files-grid media row sat on its grey placeholder forever. Building in the
 * effect puts creation and teardown on ONE lifecycle, so the mount pass that
 * follows a cleanup re-creates exactly what that cleanup tore down.
 */
export function useEverInView(
	rootMargin = "200px",
): [RefCallback<Element>, boolean] {
	const [seen, setSeen] = useState(
		() => typeof IntersectionObserver === "undefined",
	);
	/*
	 * The observed node is STATE rather than a ref object: the effect below has to
	 * re-run when the node changes, and a ref object cannot make that happen.
	 * Setting it from a ref callback costs one extra render per row mount, which is
	 * the price of the remount correctness above.
	 */
	const [element, setElement] = useState<Element | null>(null);

	// A callback ref, not an effect on a ref object: the element may mount after
	// this component (a row that renders its slot conditionally), and the ref
	// callback fires exactly when the node it was handed changes - including to
	// `null`, which is React detaching it.
	const ref = useCallback<RefCallback<Element>>((node) => setElement(node), []);

	useEffect(() => {
		// No node to watch, or an answer already latched: the latch is never
		// revoked, so a seen row owes no observer for the rest of its life.
		if (element === null || seen) return;
		// `seen` is already true from the first render where this host has no
		// observer to build (the fail-open posture above).
		if (typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setSeen(true);
					observer.disconnect();
				}
			},
			{ rootMargin },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [element, rootMargin, seen]);

	return [ref, seen];
}
