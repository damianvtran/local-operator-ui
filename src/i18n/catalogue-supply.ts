/**
 * The client half of served wire catalogues: validate, cache, register.
 *
 * WHY THIS IS SEPARATE FROM THE HOOK. The transport (desktop IPC) and the
 * renderer's mount point are both DOM/React concerns, while the rules that
 * matter are pure: what a valid bundle is, what a valid cached entry is, when a
 * registration may happen, and what a failure means. Keeping those here lets
 * the tests drive the SHIPPED rules with a fake fetcher and fake storage, and
 * lets the real-path probe use the same code against a real HTTP answer.
 *
 * FAILURE CONTRACT (design §6, and the operator's decision for this slice):
 * a 404, a network error, an empty message map or a corrupt cache entry never
 * throws, never toasts and never registers a key. The envelope renderer already
 * degrades an unknown identity to the envelope's own `text`; there is nothing
 * for this layer to add and a retry loop would only spend the error path's
 * latency. A valid cache is registered BEFORE the fresh fetch, then replaced
 * only when the served hash differs, so a slow backend shows the last known
 * catalogue instead of flashing English.
 *
 * PERSISTENCE. One locale is tens of kilobytes; all eight exceed a megabyte.
 * Cache the locales actually used (two by default, active + previous), keyed
 * and versioned, and discard anything that does not parse back into a bundle.
 * A corrupt entry is removed rather than allowed to fail startup.
 *
 * REVALIDATION. The client deliberately does not send `If-None-Match`: the
 * route's 304 path is a server-side contract exercised by the core route
 * tests, and an intermediary's 304 simply leaves the cache intact. The
 * mechanism that matters here is the full 200's `content_sha256` compared
 * with the cached identity, replacing the map when it changes — which is why
 * the bundle identity must cover the eager/deferred split (core #2724).
 */

import { registerCatalogue, replaceCatalogue } from "./messages";

/** One namespace omitted from the eager bundle, served on demand instead. */
export type DeferredCatalogue = {
	namespace: string;
	content_sha256: string;
	bytes: number;
	keys: number;
};

/** `GET /v1/i18n/catalogues/{locale}`, as the route composes it. */
export type WireCatalogueBundle = {
	locale: string;
	messages: Record<string, string>;
	namespaces: Record<string, string>;
	deferred: DeferredCatalogue[];
	content_sha256: string;
};

/**
 * The slice of Web Storage this module needs. Structural rather than `Storage`
 * so tests can pass a Map-backed object without pretending to be a browser.
 */
export type CatalogueStorage = {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
	key(index: number): string | null;
	readonly length: number;
};

/** Bumped when the stored shape changes; old entries are then discarded. */
const CACHE_VERSION = 1;
const CACHE_PREFIX = "lop.i18n.wire.v1:";
/** A single locale is 6–34 KiB eager today; this is abuse/quota headroom. */
const MAX_CACHED_BYTES = 256 * 1024;
/** Active + previous locale is what switching between two languages needs. */
const MAX_CACHED_LOCALES = 2;
const SHA256 = /^[a-f0-9]{64}$/;
const LOCALE_TAG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WIRE_NAMESPACE = /^wire(?:\.[A-Za-z0-9_]+)+$/;

/**
 * The locale the sync hook should load a catalogue for.
 *
 * Prefer the capabilities answer's OWN resolved tag. On the first answer the
 * locale-writer effect notifies the store for the NEXT render, so a hook in
 * the same commit still reads the pre-mirror device tag (`en-US`), and asking
 * the route for that tag is a guaranteed 404. Falls back to the store for the
 * no-answer and blank-tag cases, which is what that store documents anyway.
 */
export function resolveCatalogueLocale(
	backendLanguage: string | undefined,
	storeLocale: string,
): string {
	return backendLanguage && backendLanguage.trim() !== ""
		? backendLanguage
		: storeLocale;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
	return typeof value === "string" && SHA256.test(value);
}

function isMessageMap(value: unknown): value is Record<string, string> {
	// The route serves `wire.*` only, so a `ui.*`/`tui.*` key in a payload or a
	// cache entry is foreign: registering it would shadow client-owned copy.
	return (
		isRecord(value) &&
		Object.entries(value).every(
			([key, message]) =>
				key.startsWith("wire.") && typeof message === "string",
		)
	);
}

function isHashMap(value: unknown): value is Record<string, string> {
	return (
		isRecord(value) &&
		Object.entries(value).every(
			([namespace, hash]) => WIRE_NAMESPACE.test(namespace) && isSha256(hash),
		)
	);
}

function deferredEntry(value: unknown): DeferredCatalogue | null {
	if (!isRecord(value)) return null;
	const { namespace, content_sha256, bytes, keys } = value;
	if (
		typeof namespace !== "string" ||
		!WIRE_NAMESPACE.test(namespace) ||
		!isSha256(content_sha256) ||
		typeof bytes !== "number" ||
		!Number.isFinite(bytes) ||
		bytes < 0 ||
		typeof keys !== "number" ||
		!Number.isInteger(keys) ||
		keys < 0
	) {
		return null;
	}
	return { namespace, content_sha256, bytes, keys };
}

/**
 * A bundle ready to register, or `null` for anything that is not one.
 *
 * This is deliberately strict about `content_sha256` and the per-namespace
 * hashes: the bundle hash is also the cache identity, so a payload with a
 * malformed one could overwrite a good cache entry with unversioned bytes.
 * A single bad message value rejects the WHOLE bundle rather than registering
 * a partial map — a half-typed catalogue is what the server-side `CatalogueInvalid`
 * path refuses to serve in the first place.
 */
export function parseWireCatalogueBundle(
	value: unknown,
): WireCatalogueBundle | null {
	if (!isRecord(value)) return null;
	const { locale, messages, namespaces, deferred, content_sha256 } = value;
	if (
		typeof locale !== "string" ||
		!LOCALE_TAG.test(locale) ||
		!isMessageMap(messages) ||
		!isHashMap(namespaces) ||
		!Array.isArray(deferred) ||
		!isSha256(content_sha256)
	) {
		return null;
	}
	const deferredEntries: DeferredCatalogue[] = [];
	for (const entry of deferred) {
		const parsed = deferredEntry(entry);
		if (parsed === null) return null;
		deferredEntries.push(parsed);
	}
	return {
		locale,
		messages: { ...messages },
		namespaces: { ...namespaces },
		deferred: deferredEntries,
		content_sha256,
	};
}

function cacheKey(locale: string): string {
	return `${CACHE_PREFIX}${locale}`;
}

/** The valid cached bundle for `locale`, or `null`; corrupt entries are removed. */
export function readCachedBundle(
	storage: CatalogueStorage | null | undefined,
	locale: string,
): WireCatalogueBundle | null {
	if (!storage) return null;
	const key = cacheKey(locale);
	let raw: string | null;
	try {
		raw = storage.getItem(key);
	} catch {
		return null;
	}
	if (raw === null) return null;
	const discard = (): null => {
		try {
			storage.removeItem(key);
		} catch {
			/* Storage that cannot remove is already unusable; nothing to do. */
		}
		return null;
	};
	if (raw.length > MAX_CACHED_BYTES) return discard();
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return discard();
	}
	if (!isRecord(parsed) || parsed.version !== CACHE_VERSION) return discard();
	// `bundle` lives under its own key so the version wrapper is always visible
	// to a reader; a payload that is a bare map is NOT a cache entry.
	const bundle = parseWireCatalogueBundle(parsed.bundle);
	if (bundle === null || bundle.locale !== locale) return discard();
	/*
	 * A cache read is a USE of that locale. Refresh `savedAt` so eviction keeps
	 * the two most recently opened locales, not the two most recently written;
	 * best effort, because read-only storage still serves a valid bundle.
	 */
	try {
		storage.setItem(
			key,
			JSON.stringify({
				version: CACHE_VERSION,
				savedAt: Date.now(),
				bundle,
			}),
		);
	} catch {
		/* Quota/blocked storage: the read itself already succeeded. */
	}
	return bundle;
}

function evictOldest(storage: CatalogueStorage): void {
	const entries: { key: string; savedAt: number }[] = [];
	for (let index = 0; index < storage.length; index += 1) {
		const key = storage.key(index);
		if (key === null || !key.startsWith(CACHE_PREFIX)) continue;
		let savedAt = 0;
		try {
			const parsed: unknown = JSON.parse(storage.getItem(key) ?? "");
			if (isRecord(parsed) && typeof parsed.savedAt === "number") {
				savedAt = parsed.savedAt;
			}
		} catch {
			/* An unreadable sibling is the first candidate for eviction. */
		}
		entries.push({ key, savedAt });
	}
	if (entries.length <= MAX_CACHED_LOCALES) return;
	entries.sort((left, right) => left.savedAt - right.savedAt);
	for (const entry of entries.slice(0, entries.length - MAX_CACHED_LOCALES)) {
		try {
			storage.removeItem(entry.key);
		} catch {
			/* One failed removal must not stop the others. */
		}
	}
}

/** Persist a fetched bundle; quota/private-mode failures are silent. */
export function writeCachedBundle(
	storage: CatalogueStorage | null | undefined,
	bundle: WireCatalogueBundle,
): void {
	if (!storage) return;
	const serialized = JSON.stringify({
		version: CACHE_VERSION,
		savedAt: Date.now(),
		bundle,
	});
	if (serialized.length > MAX_CACHED_BYTES) return;
	try {
		storage.setItem(cacheKey(bundle.locale), serialized);
		evictOldest(storage);
	} catch {
		/* Quota or a blocked storage: the fetch still registered the map. */
	}
}

export type CatalogueSupplyOptions = {
	/** Fetch the eager bundle; rejects/404s are a normal "nothing to register". */
	fetchBundle: (locale: string) => Promise<unknown>;
	storage?: CatalogueStorage | null;
	/** Overridable for tests; production registers into the message runtime. */
	register?: (locale: string, messages: Record<string, string>) => void;
	/**
	 * Overridable for tests. Replaces a locale's whole map when a fetched
	 * bundle's identity changes: the served bundle is complete, so keys a
	 * newer backend removed must not survive from the previous registration.
	 */
	replace?: (locale: string, messages: Record<string, string>) => void;
	/** A MALFORMED payload is an integration bug worth a console line, not a toast. */
	warn?: (message: string) => void;
};

export type CatalogueSupply = {
	/**
	 * Cache-first load for `locale`. Never rejects: every failure leaves the
	 * catalogue state as it was (or empty), and the envelope path falls back to
	 * the wire's own `text` for any identity it cannot render.
	 */
	load(locale: string): Promise<void>;
};

export function createCatalogueSupply(
	options: CatalogueSupplyOptions,
): CatalogueSupply {
	const register = options.register ?? registerCatalogue;
	const replace = options.replace ?? replaceCatalogue;
	const warn =
		options.warn ?? ((message: string) => console.warn(`[i18n] ${message}`));
	const memory = new Map<string, WireCatalogueBundle>();
	const pending = new Map<string, Promise<void>>();

	async function loadOnce(locale: string): Promise<void> {
		const cached =
			memory.get(locale) ?? readCachedBundle(options.storage, locale);
		if (cached !== null) {
			memory.set(locale, cached);
			register(cached.locale, cached.messages);
		}
		let fetched: WireCatalogueBundle | null;
		try {
			fetched = parseWireCatalogueBundle(await options.fetchBundle(locale));
		} catch {
			// Unreachable backend / 404 / unshipped locale: keep the cached map.
			return;
		}
		if (fetched === null || fetched.locale !== locale) {
			warn(
				`ignoring a malformed catalogue bundle for ${locale}; keeping the last known copy`,
			);
			return;
		}
		const known = memory.get(locale);
		if (known?.content_sha256 === fetched.content_sha256) return;
		memory.set(locale, fetched);
		/*
		 * A changed identity means the whole served map was re-derived: replace
		 * rather than merge, or a key the backend removed keeps rendering its old
		 * text for the rest of the session.
		 */
		replace(fetched.locale, fetched.messages);
		writeCachedBundle(options.storage, fetched);
	}

	function load(locale: string): Promise<void> {
		const existing = pending.get(locale);
		if (existing !== undefined) return existing;
		const run = loadOnce(locale).finally(() => {
			pending.delete(locale);
		});
		pending.set(locale, run);
		return run;
	}

	return { load };
}
