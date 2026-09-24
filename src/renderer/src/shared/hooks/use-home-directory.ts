import { useEffect, useState } from "react";

/**
 * The account's home directory, as the app's own bridge reports it.
 *
 * WHY A HOOK RATHER THAN A FIELD. Two surfaces print a home-relative path - the
 * composer's directory chip and the chat header's identity row - and both need
 * the same value to render it through `formatDirectory`. The chip used to fetch
 * it for itself with its own `useEffect`; a second copy of that effect in the
 * header would be a second IPC round trip for one value that cannot change while
 * the app runs.
 *
 * So the request is made once per renderer process and shared: the module-level
 * `request` below is the cache, and every mount subscribes to the same promise.
 * It is deliberately not a store and not invalidating: `getHomeDirectory` reads
 * the OS account's home, which does not move under a running app, so a refresh
 * would be a re-read of a constant.
 *
 * The bridge is probed rather than assumed. The renderer is also mounted by
 * jsdom harnesses (`scripts/run-panel-navigation.test.mjs`) and by Storybook,
 * where `window.api` is absent or partial; those get `null`, which
 * `formatDirectory` treats as "print the path in full" rather than as an error.
 * A failed bridge call is the same answer for the same reason - a header that
 * cannot ask must still render, and it renders the unshortened path.
 */
let request: Promise<string | null> | null = null;

function requestHomeDirectory(): Promise<string | null> {
	if (!request) {
		const read = window.api?.getHomeDirectory;
		request =
			typeof read === "function"
				? read.call(window.api).catch(() => null)
				: Promise.resolve(null);
	}
	return request;
}

/**
 * @returns The home directory, or null until the bridge answers (and null
 *   permanently where there is no bridge).
 */
export function useHomeDirectory(): string | null {
	const [homeDirectory, setHomeDirectory] = useState<string | null>(null);

	useEffect(() => {
		let live = true;
		void requestHomeDirectory().then((home) => {
			// An answer that arrives after unmount must not set state on a dead
			// component: the promise is process-wide, so a later mount re-reads it
			// from the cache and a stale closure here would be the only writer.
			if (live) setHomeDirectory(home);
		});
		return () => {
			live = false;
		};
	}, []);

	return homeDirectory;
}
