/**
 * The renderer's door to the i18n core.
 *
 * The core lives at `src/i18n/` (RFC §3.2) so the main process can import it
 * later; this directory is the renderer half — this re-export plus the React
 * bindings beside it (`./use-locale`) — and the reason renderer code has one
 * specifier to remember (`@shared/i18n`) that every bundler and test harness
 * already resolves.
 */

export type {
	LocaleCapabilities,
	LocaleSource,
	LocaleState,
	MessageKey,
	MessageParams,
	WithParams,
	WithoutParams,
} from "../../../../i18n";
export {
	applyCapabilities,
	clearRegisteredCatalogues,
	currentLocale,
	currentLocaleState,
	DEFAULT_LOCALE,
	formatBytes,
	formatDate,
	formatDateTime,
	formatDuration,
	formatNumber,
	formatRelativeTime,
	formatTime,
	I18N_FEATURE,
	LANGUAGE_SETTING_KEY,
	registerCatalogue,
	resolveLocale,
	setLocale,
	subscribeLocale,
	t,
	translate,
} from "../../../../i18n";

/* Direction is a property of the language (see `i18n/direction.ts`), and the
 * native card document needs the same `lang`/`dir` pair the app root carries. */
export {
	resolveLanguage,
	textDirectionFor,
} from "../../../../i18n/direction";
export type { TextDirection } from "../../../../i18n/direction";

/*
 * The renderer-half's own module (not part of the core: it holds the query
 * client's renegotiation and the own-write window, which are renderer
 * concerns). Re-exported here so callers keep ONE specifier.
 */
export {
	markLocalLanguageWrite,
	renegotiateLanguage,
	withinLocalLanguageWrite,
} from "./language-writes";
