/**
 * `src/i18n/` — the UI's i18n core (RFC §3.2).
 *
 * Three pieces, each with its own module:
 *
 * - `./keys.gen` — GENERATED typed key map and the bundled en catalogue
 *   (regenerate with `node scripts/i18n/generate.mjs`; drift fails the desktop
 *   suite, whose `scripts/i18n/typed-keys.test.mjs` runs `--check`);
 * - `./messages` — `t()` (the RFC §2.4 two-overload declaration) over the
 *   catalogue runtime, with en-fallback and `registerCatalogue` for the served
 *   `wire.*` sets;
 * - `./locale` — where the active locale comes from: the backend's resolved
 *   `language` from `GET /v1/capabilities` once it answers, the device before
 *   that;
 * - `./format` — the Intl formatter layer every migrated site calls.
 *
 * The renderer's React bindings live next door, under
 * `src/renderer/src/shared/i18n/` (they need React and the query layer; this
 * directory stays framework-free so the main process can import it later —
 * RFC §3.2's main-process catalogue slice).
 */

export type {
	MessageKey,
	MessageParams,
	WithParams,
	WithoutParams,
} from "./keys.gen";
export {
	clearRegisteredCatalogues,
	registerCatalogue,
	t,
	translate,
} from "./messages";
export type {
	LocaleCapabilities,
	LocaleSource,
	LocaleState,
} from "./locale";
export {
	applyCapabilities,
	currentLocale,
	currentLocaleState,
	DEFAULT_LOCALE,
	I18N_FEATURE,
	resolveLocale,
	setLocale,
	subscribeLocale,
} from "./locale";
export {
	formatBytes,
	formatDate,
	formatDateTime,
	formatDuration,
	formatNumber,
	formatRelativeTime,
	formatTime,
} from "./format";
