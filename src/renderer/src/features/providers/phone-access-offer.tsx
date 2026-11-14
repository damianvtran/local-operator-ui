/**
 * The first-sign-in offer for phone access (spec v2 §3b/§4.1, Q2, D6, U9).
 *
 * ## Why it exists
 *
 * The operator's ask: a non-technical person signed in to Radient gets phone
 * access with no terminal. The backend (local-operator #3945) brings an EXISTING
 * tunnel back on its own after a sign-in, but it never creates one silently
 * (Q2): creating it can bill, and nothing is created until a person asks. So a
 * person who signed in on a machine with no phone access has to be told the
 * option exists, once, in the app - this card.
 *
 * ## What it may and may not do
 *
 * - In-app and non-modal, in the sidebar foot: never an OS notification, never a
 *   dialog that blocks the window.
 * - [Set up phone access] only NAVIGATES to Settings -> Radient account, where the
 *   Phone access block plans on mount and shows any monthly price inline before
 *   anything is billed. The card never sends `tunnel.setup.run` (it cannot
 *   activate anything, by construction: the only request it makes is the
 *   read-only `tunnel.setup.read`).
 * - [Not now] is remembered per machine AND account: `localStorage` is this
 *   installation's own, and the key carries the Radient account id, so a second
 *   account on the same machine is still asked once.
 *
 * ## Gates
 *
 * `features.tunnel_setup` AND `features.tunnel_remedy_kinds` (the backend that
 * pairs the offer with the post-sign-in reconnect), a signed-in Radient account,
 * and a local read that says this machine has no phone access configured
 * (`configured: false`, no run live). Without any of them nothing renders and,
 * before the account and the capabilities are known, nothing is asked.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { Button } from "@shared/components/ui";
import { phoneSetupKeys } from "@shared/hooks/use-phone-setup";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { useCurrentView } from "@shared/hooks/use-route-params";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { RADIENT_ACCOUNT_SETTINGS_ROUTE } from "@shared/utils/radient-account-copy";
import { useQuery } from "@tanstack/react-query";
import { type FC, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { phoneSetupResultSchema } from "../../../../shared/desktop-contract";

/**
 * One key, a JSON list of the Radient account ids that answered "Not now" on
 * this installation. A list rather than a key per account so clearing it is
 * one entry, and it never grows past the accounts a person has signed in with.
 */
export const PHONE_OFFER_DISMISSED_KEY = "local-operator.phone-offer.dismissed";

const readDismissed = (): string[] => {
	try {
		const raw = window.localStorage.getItem(PHONE_OFFER_DISMISSED_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed)
			? parsed.filter((id): id is string => typeof id === "string")
			: [];
	} catch {
		// Unreadable storage (private mode, a corrupt value): treat as never
		// dismissed. The cost is one more offer, never a hidden charge.
		return [];
	}
};

export const isPhoneOfferDismissed = (accountId: string): boolean =>
	readDismissed().includes(accountId);

export const dismissPhoneOffer = (accountId: string): void => {
	const ids = readDismissed();
	if (ids.includes(accountId)) return;
	try {
		window.localStorage.setItem(
			PHONE_OFFER_DISMISSED_KEY,
			JSON.stringify([...ids, accountId]),
		);
	} catch {
		// Storage full or refused: the card still hides for this session below.
	}
};

/** Whether the offer should show now, and the one action that hides it. */
export function usePhoneAccessOffer(): {
	show: boolean;
	dismiss: () => void;
} {
	const capabilities = useDesktopCapabilities();
	const enabled =
		desktopFeatureEnabled(capabilities.data, "tunnel_setup") &&
		desktopFeatureEnabled(capabilities.data, "tunnel_remedy_kinds");
	const { user, authStatus } = useRadientAuth();
	const accountId =
		authStatus === "authenticated"
			? (user?.radientUser.account.id ?? null)
			: null;
	// Session-local mirror so the card hides on the press even when storage
	// refuses the write.
	const [dismissedNow, setDismissedNow] = useState<string | null>(null);
	const dismissed =
		accountId !== null &&
		(dismissedNow === accountId || isPhoneOfferDismissed(accountId));
	const currentView = useCurrentView();

	// The SAME key and request as the block's local read, so the two share one
	// cache entry: the block's run poll updates it, and the card leaves the moment
	// setup configures phone access.
	const local = useQuery({
		queryKey: phoneSetupKeys.local(null),
		queryFn: async () =>
			phoneSetupResultSchema.parse(
				await desktopResult<unknown>({ op: "tunnel.setup.read" }),
			),
		enabled: enabled && accountId !== null && !dismissed,
		retry: false,
		staleTime: 0,
		refetchOnWindowFocus: false,
	});

	const dismiss = useCallback(() => {
		if (accountId === null) return;
		dismissPhoneOffer(accountId);
		setDismissedNow(accountId);
	}, [accountId]);

	const data = local.data;
	const show =
		enabled &&
		accountId !== null &&
		!dismissed &&
		// Already in Settings, where the block itself is the offer.
		currentView !== "settings" &&
		data !== undefined &&
		data.configured === false &&
		!data.in_progress;
	return { show, dismiss };
}

/** The card. Renders nothing unless `usePhoneAccessOffer` says so. */
export const PhoneAccessOffer: FC = () => {
	useI18nLocale();
	const navigate = useNavigate();
	const { show, dismiss } = usePhoneAccessOffer();
	if (!show) return null;
	return (
		<section
			className="mx-2 mb-2 flex flex-col gap-2 rounded-md border border-hairline bg-surface p-3"
			aria-label={t("ui.providers.phone.offer.title")}
			data-phone-offer=""
		>
			<p className="text-body-sm text-ink">
				{t("ui.providers.phone.offer.title")}
			</p>
			<p className="break-words text-meta text-ink-muted">
				{t("ui.providers.phone.offer.body")}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					variant="primary"
					size="sm"
					onClick={() => navigate(RADIENT_ACCOUNT_SETTINGS_ROUTE)}
				>
					{t("ui.providers.phone.action.set_up")}
				</Button>
				<Button variant="ghost" size="sm" onClick={dismiss}>
					{t("ui.providers.phone.offer.not_now")}
				</Button>
			</div>
		</section>
	);
};
