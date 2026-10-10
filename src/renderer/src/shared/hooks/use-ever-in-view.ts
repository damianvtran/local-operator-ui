import {
	type RefCallback,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

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
 */
export function useEverInView(
	rootMargin = "200px",
): [RefCallback<Element>, boolean] {
	const [seen, setSeen] = useState(
		() => typeof IntersectionObserver === "undefined",
	);
	const observer = useRef<IntersectionObserver | null>(null);

	useEffect(() => () => observer.current?.disconnect(), []);

	// A callback ref, not an effect on a ref object: the element may mount after
	// this component (a row that renders its slot conditionally), and the ref
	// callback fires exactly when there is something to observe.
	const ref = useCallback<RefCallback<Element>>(
		(element) => {
			observer.current?.disconnect();
			observer.current = null;
			if (element === null || seen) return;
			const next = new IntersectionObserver(
				(entries) => {
					if (entries.some((entry) => entry.isIntersecting)) {
						setSeen(true);
						next.disconnect();
					}
				},
				{ rootMargin },
			);
			next.observe(element);
			observer.current = next;
		},
		[rootMargin, seen],
	);

	return [ref, seen];
}
