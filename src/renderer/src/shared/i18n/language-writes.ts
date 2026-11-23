/**
 * The language setting's OWN-WRITE window, and the one renegotiation seam.
 *
 * WHY A WINDOW AT ALL. The `config` frame deliberately does not project the
 * core watcher's `source` ("disk"/"local"): the frame is a FILE watch inside
 * the backend process while the writers live in several (the TUI, the
 * backend's own PATCH route, an agent's turn child), so a per-process verdict
 * has no meaning at the feed (core, PR #2213). The UI therefore decides
 * self-vs-external itself: a write this app just made through `settings.edit`
 * or `settings.reset` is marked here, and a language frame inside the window
 * is treated as our own - it still refetches, and stays quiet.
 *
 * WHY THE WINDOW OUTLIVES THE WRITE'S PROMISE. The frame is published on the
 * watcher's next tick plus its stat poll, which lands AFTER the PATCH
 * resolves; a window that closed at resolve would always miss our own frame
 * and toast the app's own change back at the reader. Five seconds covers
 * tick + poll + socket with room, and a miss degrades to one extra refetch -
 * never a stuck state (the core's own note on this contract).
 *
 * ONE SEAM FOR THE RENEGOTIATION, THREE CALLERS: the settings row's save and
 * reset, and the palette dialog's save. All three write the same backend
 * setting, so all three mark the window and invalidate the capabilities
 * query through here rather than through three copies of the same two lines.
 */

import { desktopKeys } from "@shared/api/local-operator/desktop-hooks";
import type { Query, QueryClient } from "@tanstack/react-query";

/** How long a frame may still be ours after our own write resolved. */
const OWN_WRITE_HOLD_MS = 5_000;

let ownWriteUntil = 0;

/** Mark a write this app just made through `settings.edit`/`settings.reset`. */
export function markLocalLanguageWrite(holdMs = OWN_WRITE_HOLD_MS): void {
	ownWriteUntil = Date.now() + holdMs;
}

/** Whether a language frame arriving now is (probably) our own write's echo. */
export function withinLocalLanguageWrite(now = Date.now()): boolean {
	return now <= ownWriteUntil;
}

/**
 * The capabilities renegotiation a language write owes: mark the window, then
 * invalidate the chain the i18n store resolves from. The next capabilities
 * answer carries the new `language`, and the store (and the row's
 * `In effect:` note) follow - RFC 2.5's one chain.
 */
export function renegotiateLanguage(queryClient: QueryClient): void {
	markLocalLanguageWrite();
	void queryClient.invalidateQueries({ queryKey: desktopKeys.capabilities });
}

/**
 * Refetch the server's copy after the backend's RESOLVED language changed.
 *
 * WHY (fr census, row 1). The backend renders a lot of the copy the UI shows
 * per request, in the language it resolved at that moment: voice availability
 * (`GET /v1/tts/paths`), import-source details, sound names, setting labels,
 * command descriptions, error sentences. The renderer caches those answers, and
 * a language switch used to refresh only capabilities and settings - so the
 * voice and import sections stayed English after switching to French until a
 * reload, while every word around them had switched.
 *
 * WHY EVERY QUERY, NOT A LIST. Which answers carry server-rendered prose is a
 * property of the BACKEND's code, which grows; a hand-kept allow-list here
 * would be stale the day a route gained a localized sentence, and the failure
 * is silent (old-language text, no error). A language switch is a rare,
 * deliberate act, and `invalidateQueries` only REFETCHES what is mounted right
 * now - everything else is marked stale and refetches when next shown - so the
 * blanket costs one refetch of the visible screen, which is what a reload cost
 * the user before, minus losing their place. Capabilities is skipped only
 * because its answer is what triggered this, so it is already fresh.
 *
 * Copy a component keeps in its OWN state rather than in the query cache (the
 * import section's source list) cannot be reached from here; such a reader
 * reloads on `useI18nLocale()` instead.
 */
export function refreshServerLocalizedQueries(queryClient: QueryClient): void {
	void queryClient.invalidateQueries({
		predicate: (query: Query) => !isCapabilitiesQuery(query.queryKey),
	});
}

function isCapabilitiesQuery(key: readonly unknown[]): boolean {
	const capabilities = desktopKeys.capabilities;
	return (
		key.length === capabilities.length &&
		capabilities.every((part, index) => key[index] === part)
	);
}
