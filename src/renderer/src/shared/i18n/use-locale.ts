/**
 * The React binding for the i18n locale store.
 *
 * `useI18nLocale` reads the active locale the way React requires — through
 * `useSyncExternalStore`, so a locale change re-renders the components that
 * format with it (the `./format` functions read the store directly at call
 * time, which is what plain functions need). This module deliberately imports
 * NOTHING but React and the store: it is bundled by every component test that
 * touches a date, and the writer hook next door would drag the desktop
 * transport into each of those bundles.
 *
 * The writer — `useI18nLocaleSync`, which mirrors the capabilities query into
 * the store — lives in `./locale-sync` and is mounted once, in `App`.
 */

import { useSyncExternalStore } from "react";

import { currentLocale, subscribeLocale } from "../../../../i18n/locale";

/** The active locale, re-rendering the caller when it changes. */
export function useI18nLocale(): string {
	return useSyncExternalStore(subscribeLocale, currentLocale, currentLocale);
}
