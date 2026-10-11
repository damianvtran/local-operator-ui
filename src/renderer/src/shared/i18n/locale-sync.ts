/**
 * The i18n locale store's WRITER: mirrors the capabilities query into it.
 *
 * Mounted once, in `App` — the `useWindowChrome` precedent, one mount because
 * the store is one value, and it renders nothing. It fires on the first
 * capabilities answer and on every re-negotiation (`useDesktopCapabilities`
 * re-polls by design, for the plane's own reasons). Before any answer, nothing
 * is applied and the store keeps the device locale: that is the RFC §2.5
 * pre-connection rule, not an oversight. An answer WITHOUT `features.i18n`
 * (an older backend) resolves the same way — the device stays — which is what
 * "ships dark" means for a client that predates the capability.
 */

import {
	desktopKeys,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useDesktopFeed } from "@shared/hooks/use-desktop-feed";
import { showInfoToast } from "@shared/utils/toast-manager";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import {
	LANGUAGE_SETTING_KEY,
	applyCapabilities,
} from "../../../../i18n/locale";
import { t } from "../../../../i18n/messages";
import { withinLocalLanguageWrite } from "./language-writes";

/** Mirror the capabilities answer (or its absence) into the locale store. */
export function useI18nLocaleSync(): void {
	const { data } = useDesktopCapabilities();
	useEffect(() => {
		if (data) applyCapabilities(data);
	}, [data]);

	/*
	 * THE LIVE HALF (slice B1): a language written from ANY origin - an agent
	 * tool, the TUI, a hand edit - arrives as a `config` frame on the desktop
	 * feed, and the interface follows within a refetch instead of waiting out
	 * the capabilities watch cadence (up to 30 s, which is the FALLBACK, not the
	 * mechanism). The frame does not say who wrote it (the contract explains
	 * why), so the own-write window in `./language-writes` distinguishes this
	 * app's own save - which already showed its result in place - from an
	 * external transition, which earns one quiet toast per window.
	 *
	 * Deduped by the frame's own identity: the effect may re-run for a frame it
	 * has already handled (the feed's state object is replaced per frame), and a
	 * redelivered frame must not toast twice. Sonner's `id` is the second belt:
	 * consecutive external transitions replace one toast rather than stacking.
	 */
	const feed = useDesktopFeed();
	const queryClient = useQueryClient();
	const handled = useRef<string | null>(null);
	useEffect(() => {
		const change = feed.configChange;
		if (!change) return;
		const stamp = `${change.epoch}:${change.seq}`;
		if (handled.current === stamp) return;
		if (!change.changedKeys.includes(LANGUAGE_SETTING_KEY)) return;
		handled.current = stamp;
		void queryClient.invalidateQueries({ queryKey: desktopKeys.capabilities });
		if (withinLocalLanguageWrite()) return;
		showInfoToast(
			t("ui.settings.language.external_notice", {
				language: change.language,
			}),
			{ id: "i18n-language-external" },
		);
	}, [feed.configChange, queryClient]);
}
