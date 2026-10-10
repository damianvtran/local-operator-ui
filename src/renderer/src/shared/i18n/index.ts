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
	registerCatalogue,
	resolveLocale,
	setLocale,
	subscribeLocale,
	t,
	translate,
} from "../../../../i18n";
