import {
	applyBackendLanguage,
	applyDeviceLocale,
	isLanguageTag,
} from "../i18n/locale";

/**
 * The MAIN process's locale source, and why it needs one of its own.
 *
 * Every notification this process raises is now keyed copy (`ui.notices.main.*`
 * in `update-install.ts` and `browser/consent-notifier.ts`), but until this
 * module existed the main process had no locale: the store initialised once at
 * import time from `navigator.language`, which under a main-process runtime is
 * the OS/ICU default, not the backend `language` setting the user chose. The
 * measured consequence was an update-hold banner and a site-approval banner
 * that read English in French, Russian and Urdu - the exact failure this PR
 * exists to remove, moved one process to the left (agent review round 1, R1-1).
 *
 * THREE SOURCES, IN THE RFC'S OWN ORDER, and none of them is new:
 *
 * 1. The BACKEND's resolved tag, read from the SAME configured transport the
 *    renderer's capabilities query uses (`{ op: "capabilities" }`). Only the
 *    answer's `language` is used, only when `features.i18n` gates it, and the
 *    tag is structurally validated before it reaches ICU. This is the
 *    authoritative source once a backend answers: it is where an in-app
 *    language choice lands.
 * 2. The DEVICE, read from Electron's own app object. Deliberately NOT
 *    `navigator.language`: under Node that value follows `LANG`/ICU rather than
 *    the macOS preferred-languages list the app's UI is expected to follow, so
 *    it would disagree with the OS the user configured.
 * 3. English, via the locale store's own default, when neither can answer.
 *
 * WHAT A FAILED READ DOES. Nothing. A throw, a non-200 or a malformed envelope
 * says nothing about the backend's language, so the previous locale stays - and
 * the log line carries no values from the response, because a config or
 * credential value can appear in an error body and this module has no business
 * copying one into a log.
 *
 * WHY THERE IS NO SECOND PERSISTED PREFERENCE. The backend setting is the one
 * owner (docs/I18N.md). This module only mirrors what it reads; the marker
 * field `update-install.ts` writes is a record of the resolved tag for the
 * pre-window hold, never a value anything reads back as a choice.
 */

/** The parts of Electron's `app` this module reads. Structural so tests need no Electron. */
export type MainLocaleApp = {
	getPreferredSystemLanguages?: () => unknown;
	getSystemLocale?: () => unknown;
	getLocale?: () => unknown;
};

/** One capabilities answer, narrowed to what main needs. */
type CapabilitiesAnswer = {
	features?: Record<string, number> | null;
	language?: string | null;
};

type MainLocaleResponse = {
	status: number;
	body?: unknown;
};

export type MainLocale = {
	/**
	 * Re-read the backend's resolved language. Coalesces: a call while a read is
	 * in flight marks a rerun instead of opening a second request, and the loop
	 * reads again before it settles, so the LAST invalidation wins rather than a
	 * stale answer landing after a newer one.
	 */
	refresh: () => Promise<void>;
	/** Apply the device reading now (boot, before any backend is reachable). */
	applyDevice: () => boolean;
};

/**
 * The device's language tag, in Electron's own precedence order.
 *
 * Preferred system languages first (the macOS list the user arranged), then the
 * system locale, then the app locale. Each reading is tried and validated on
 * its own: a host where one getter throws or returns junk must not lose the
 * next reading, and only a structurally valid tag is returned.
 */
export function deviceLocaleFor(
	appLike: MainLocaleApp | null | undefined,
): string | undefined {
	const read = (value: unknown): string | undefined => {
		if (typeof value === "string")
			return isLanguageTag(value) ? value : undefined;
		if (Array.isArray(value)) {
			for (const candidate of value) {
				if (typeof candidate === "string" && isLanguageTag(candidate))
					return candidate;
			}
		}
		return undefined;
	};
	const attempt = (getter?: () => unknown): string | undefined => {
		if (typeof getter !== "function") return undefined;
		try {
			return read(getter());
		} catch {
			// A getter that throws is a reading this host cannot give; try the next.
			return undefined;
		}
	};
	return (
		attempt(appLike?.getPreferredSystemLanguages) ??
		attempt(appLike?.getSystemLocale) ??
		attempt(appLike?.getLocale)
	);
}

/*
 * The one tag predicate lives in `i18n/locale.ts`; it is used here to choose the
 * FIRST usable device reading (not merely the first non-empty one), while the
 * appliers validate again before writing.
 */
function asCapabilitiesAnswer(body: unknown): CapabilitiesAnswer | null {
	if (body === null || typeof body !== "object") return null;
	const result = (body as { result?: unknown }).result;
	return result !== null && typeof result === "object"
		? (result as CapabilitiesAnswer)
		: null;
}

/**
 * Build the main-process locale mirror.
 *
 * `request` is the configured transport's capabilities op (the same one
 * `backendService.requestDesktop` serves), passed rather than imported so this
 * module stays free of Electron and of the backend manager - the two hard
 * dependencies a test would otherwise have to fake wholesale.
 */
export function createMainLocale(options: {
	app: MainLocaleApp | null | undefined;
	request: (input: { op: "capabilities" }) => Promise<MainLocaleResponse>;
	log: (message: string) => void;
}): MainLocale {
	let inFlight: Promise<void> | null = null;
	let rerun = false;

	const applyDevice = (): boolean => {
		const applied = applyDeviceLocale(deviceLocaleFor(options.app));
		if (!applied) {
			options.log(
				"Main locale: no usable device language tag; keeping the current locale.",
			);
		}
		return applied;
	};

	async function readOnce(): Promise<void> {
		let response: MainLocaleResponse | null = null;
		try {
			response = await options.request({ op: "capabilities" });
		} catch {
			// Unfetchable says nothing about the backend's language.
		}
		if (!response || response.status !== 200) {
			options.log(
				"Main locale: the capabilities read failed; keeping the previous locale.",
			);
			return;
		}
		const answer = asCapabilitiesAnswer(response.body);
		if (!answer) {
			options.log(
				"Main locale: the capabilities answer was not a usable envelope; keeping the previous locale.",
			);
			return;
		}
		/*
		 * The SAME eligibility the renderer applies (`resolveLocale`): the feature
		 * gate decides whether `language` is the backend's answer at all, and an
		 * older backend falls through to the device - not to English, because the
		 * device is the renderer's pre-connection source and the two processes must
		 * agree about what a backend without the feature means.
		 */
		const enabled = Number(answer.features?.i18n ?? 0) >= 1;
		if (enabled && applyBackendLanguage(answer.language)) return;
		if (enabled) {
			options.log(
				"Main locale: the backend's language tag was not structurally usable; using the device locale.",
			);
		}
		applyDevice();
	}

	function refresh(): Promise<void> {
		if (inFlight) {
			// Invalidated mid-read: one rerun after the current attempt settles,
			// never a second concurrent request, so a slow answer cannot land after
			// a newer authoritative one.
			rerun = true;
			return inFlight;
		}
		const probe = (async () => {
			try {
				do {
					rerun = false;
					await readOnce();
				} while (rerun);
			} finally {
				inFlight = null;
				if (rerun) {
					rerun = false;
					void refresh();
				}
			}
		})();
		inFlight = probe;
		return probe;
	}

	return { refresh, applyDevice };
}

/**
 * Apply the locale a LAUNCH HOLD should speak in, before its notice and the
 * watchdog script are built.
 *
 * The hold runs before any window exists and often before a backend is
 * reachable, so the ordinary backend-ready refresh may not have happened. The
 * pending-install marker is the one record that survives the quit, and it
 * carries the BACKEND-RESOLVED tag when the version that wrote it had one.
 * A marker without the field is pre-version: nothing can reconstruct the user's
 * choice from it, so it falls back to the device reading - never to a fresh
 * parse of `config.yml`, which would be a second preference reader with its own
 * precedence bugs (and would put a user's config value in the update path).
 *
 * Returns which source answered, for the caller's log; never a value.
 */
export function applyHoldLocale(
	marker: { language?: unknown } | null,
	appLike: MainLocaleApp | null | undefined,
): "marker" | "device" | "kept" {
	if (marker && applyBackendLanguage(marker.language)) return "marker";
	if (applyDeviceLocale(deviceLocaleFor(appLike))) return "device";
	return "kept";
}
