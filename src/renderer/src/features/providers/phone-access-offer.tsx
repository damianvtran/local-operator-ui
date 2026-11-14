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
import {
	Button,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@shared/components/ui";
import { requestPhoneAccessFocus } from "@shared/hooks/phone-access-navigation";
import { phoneSetupKeys } from "@shared/hooks/use-phone-setup";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { useCurrentView } from "@shared/hooks/use-route-params";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";
import { type FC, useCallback, useRef, useState } from "react";
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

/**
 * Where focus goes when the offer leaves under the person's own press (UX
 * review U3a): the next control after `anchor` in document order - the account
 * row under the card, or the gear under the collapsed strip's icon. Without
 * this, "Not now" unmounted the focused button and a keyboard user landed on
 * <body>, back at the top of the window.
 */
const FOCUSABLE =
	'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focusAfter = (anchor: Element | null): void => {
	if (!anchor) return;
	const next = Array.from(
		document.querySelectorAll<HTMLElement>(FOCUSABLE),
	).find(
		(element) =>
			!anchor.contains(element) &&
			(anchor.compareDocumentPosition(element) &
				Node.DOCUMENT_POSITION_FOLLOWING) !==
				0,
	);
	next?.focus();
};

/**
 * [Set up phone access]: navigate, and ask the Phone access block to take
 * focus when it mounts there (UX review U3c). Plain `/settings`, not the
 * `?section=radient` deep link: that link re-scrolls to the top of the Radient
 * section once the page settles, which would undo the block's own landing a
 * second later (see `PhoneAccessBody`).
 */
const useSetUp = (): (() => void) => {
	const navigate = useNavigate();
	return useCallback(() => {
		requestPhoneAccessFocus();
		navigate("/settings");
	}, [navigate]);
};

/** The card's content, shared by the docked foot and the collapsed strip. */
const OfferCard: FC<{
	onSetUp: () => void;
	onNotNow: (card: HTMLElement | null) => void;
	className?: string;
}> = ({ onSetUp, onNotNow, className }) => {
	const card = useRef<HTMLElement>(null);
	return (
		<section
			ref={card}
			className={cn("flex flex-col gap-2", className)}
			aria-label={t("ui.providers.phone.offer.title")}
			data-phone-offer=""
		>
			{/*
			 * Medium weight (design review D2): at 13px/400 over a 12px body the
			 * question read as the first sentence of the paragraph. It wraps freely
			 * - the sidebar is ~243px and the longest locale title runs to two
			 * lines - so nothing is truncated.
			 */}
			<p className="break-words font-medium text-body-sm text-ink">
				{t("ui.providers.phone.offer.title")}
			</p>
			<p className="break-words text-meta text-ink-muted">
				{t("ui.providers.phone.offer.body")}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<Button variant="primary" size="sm" onClick={onSetUp}>
					{t("ui.providers.phone.action.set_up")}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => onNotNow(card.current)}
				>
					{t("ui.providers.phone.offer.not_now")}
				</Button>
			</div>
		</section>
	);
};

/**
 * The card in the docked sidebar's foot. Renders nothing unless
 * `usePhoneAccessOffer` says so. `shrink-0` (review N2): the foot is a flex
 * column under a scrolling list, and without it a short window squeezed the
 * card instead of the list.
 */
export const PhoneAccessOffer: FC = () => {
	useI18nLocale();
	const setUp = useSetUp();
	const { show, dismiss } = usePhoneAccessOffer();
	if (!show) return null;
	return (
		<OfferCard
			className="mx-2 mb-2 shrink-0 rounded-md border border-hairline bg-surface p-3"
			onSetUp={setUp}
			onNotNow={(card) => {
				focusAfter(card);
				dismiss();
			}}
		/>
	);
};

/**
 * The same offer when the sidebar is COLLAPSED (UX review U1). The strip draws
 * no foot, and windows narrower than 1024px start collapsed, so the card alone
 * never reached a small laptop window - and it is this PR's only discovery
 * path for a fresh sign-in. A phone icon with an accent dot sits in the strip's
 * foot column beside the update icon and opens the SAME card in a non-modal
 * popover. Both read the same per-account dismissal, so Not now in either is
 * remembered for the other.
 */
export const PhoneAccessOfferIcon: FC = () => {
	useI18nLocale();
	const setUp = useSetUp();
	const { show, dismiss } = usePhoneAccessOffer();
	const trigger = useRef<HTMLButtonElement>(null);
	if (!show) return null;
	const title = t("ui.providers.phone.offer.title");
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					ref={trigger}
					type="button"
					aria-label={title}
					title={title}
					data-phone-offer-icon=""
					className={cn(
						"relative flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-muted",
						"transition-colors duration-fast ease-out-quart",
						"hover:bg-row-hover hover:text-ink",
					)}
				>
					<Smartphone className="size-4 shrink-0" aria-hidden="true" />
					<span
						aria-hidden="true"
						className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-accent"
					/>
				</button>
			</PopoverTrigger>
			<PopoverContent
				side="right"
				align="end"
				// The trigger is gone once the card is dismissed or followed, so
				// Radix's own return-focus-to-trigger would land on nothing; the
				// handlers below place focus themselves.
				onCloseAutoFocus={(event) => event.preventDefault()}
			>
				<OfferCard
					onSetUp={setUp}
					onNotNow={() => {
						focusAfter(trigger.current);
						dismiss();
					}}
				/>
			</PopoverContent>
		</Popover>
	);
};
