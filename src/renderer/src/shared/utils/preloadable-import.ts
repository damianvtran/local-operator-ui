/**
 * A lazily-loaded route chunk that can be fetched AHEAD of its first render
 * (PR #1869 QA Q1: the first Team Bridge open after a cold launch measured
 * 158 / 178 / 390 ms, one sample over the operator's 300 ms target; the lazy
 * `TeamBridgePage` chunk is the cost the first open pays and later ones don't).
 *
 * WHY A SYNCHRONOUS THENABLE. React 18's `lazy` calls its factory on first
 * render and attaches `.then`; with a native Promise that callback runs on a
 * microtask, so even an already-downloaded chunk suspends once and paints the
 * Suspense fallback for a frame. Once the module has resolved, `load` returns a
 * thenable whose `then` calls back synchronously, so `lazy` reaches `Resolved`
 * inside the render that asked and the page paints in that frame. Before then
 * it returns the shared import promise, so a preload in flight and the first
 * render join ONE download.
 *
 * The import itself is the bundler's own `import()`: Vite still splits the
 * chunk, and nothing changes for a reader who never opens the page except a
 * download at idle time.
 */
export type PreloadableImport<T> = {
	/**
	 * The factory for `React.lazy` (wrapped in its `{ default }` mapping). Typed
	 * `Promise` because that is what `lazy` declares; once resolved it is really
	 * a synchronous thenable, and `lazy` (like any `await`) only calls `then`.
	 */
	load: () => Promise<T>;
	/** Start (or join) the download now; safe to call any number of times. */
	preload: () => Promise<T>;
};

export function preloadableImport<T>(
	importer: () => Promise<T>,
): PreloadableImport<T> {
	let pending: Promise<T> | undefined;
	let resolved: { module: T } | undefined;
	const preload = () => {
		if (!pending) {
			pending = importer().then(
				(module) => {
					resolved = { module };
					return module;
				},
				(error: unknown) => {
					// A failed download (offline, chunk renamed by an update) must not
					// poison the route: the next render or preload tries again.
					pending = undefined;
					throw error;
				},
			);
		}
		return pending;
	};
	const load = (): Promise<T> =>
		resolved ? (resolvedThenable(resolved.module) as Promise<T>) : preload();
	return { load, preload };
}

/**
 * A thenable already holding `value`: `then` calls back synchronously and
 * returns another such thenable, so a chain (`load().then(mapToDefault)`, as
 * every `lazy` factory here writes it) stays synchronous end to end. A callback
 * that returns a real promise hands that promise on unchanged.
 */
function resolvedThenable<T>(value: T): PromiseLike<T> {
	return {
		// biome-ignore lint/suspicious/noThenProperty: a synchronous thenable IS the mechanism (see `preloadableImport`).
		then<R1 = T, R2 = never>(
			onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
		): PromiseLike<R1 | R2> {
			if (!onFulfilled) return resolvedThenable(value as unknown as R1);
			const next = onFulfilled(value);
			return isThenable(next) ? next : resolvedThenable(next);
		},
	};
}

function isThenable<R>(value: R | PromiseLike<R>): value is PromiseLike<R> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { then?: unknown }).then === "function"
	);
}

/**
 * Run `preload` once the renderer is idle, so the download never competes with
 * first paint. Returns a cancel for an effect cleanup. `requestIdleCallback`
 * exists in Electron's Chromium; the timer fallback keeps non-browser hosts
 * (tests, stories in another engine) working. The 2 s `timeout` bounds the wait
 * on a renderer that never goes idle (a busy chat stream): the chunk is worth
 * having before the reader reaches for the rail, not only "eventually".
 */
export function preloadWhenIdle(preload: () => Promise<unknown>): () => void {
	let cancelled = false;
	const run = () => {
		if (!cancelled) void preload().catch(() => undefined);
	};
	const idle = (
		globalThis as { requestIdleCallback?: typeof requestIdleCallback }
	).requestIdleCallback;
	if (typeof idle === "function") {
		const handle = idle(run, { timeout: 2_000 });
		return () => {
			cancelled = true;
			globalThis.cancelIdleCallback?.(handle);
		};
	}
	const timer = setTimeout(run, 0);
	return () => {
		cancelled = true;
		clearTimeout(timer);
	};
}
