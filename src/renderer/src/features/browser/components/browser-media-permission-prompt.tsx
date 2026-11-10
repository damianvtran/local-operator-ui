import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { Camera, Mic, ShieldAlert, ShieldOff, X } from "lucide-react";
import type {
	FC,
	KeyboardEvent,
	MouseEvent,
	ReactNode,
	SyntheticEvent,
} from "react";
import {
	type MediaPermissionDecision,
	type MediaPermissionView,
	mediaKindsLabel,
} from "../../../../../shared/browser-media-permission";
import { siteOf } from "./browser-passkey-notice";

/**
 * The browser's camera/microphone band: Chrome's "<site> wants to use your
 * camera and microphone — Allow / Block", as a band in the chrome above the
 * page (the same placement as the passkey notice, so the page view is never
 * covered and no new native surface is needed). Three states, all main's facts:
 *   - `prompt`: a page is waiting for the answer (Block / Allow / ✕);
 *   - `blocked`: a remembered Block just turned the page away, so the user can
 *     see why and Allow right there (review U2) — never a silent dead end;
 *   - `system-blocked`: macOS has the app's access off; "Open System Settings"
 *     goes to the pane (review U6/D3).
 *
 * WHY THE CLICK'S `isTrusted` TRAVELS: main grants only on a decision that
 * carries `trusted: true` (`src/main/browser/media-permissions.ts`). A real
 * mouse or keyboard activation of these buttons is trusted; a scripted
 * `.click()` is not. The primary boundary is that nothing but this window's
 * renderer can reach the decision channel at all — this is defence in depth.
 *
 * NO AUTOFOCUS, deliberately: the band must not take the keyboard from the
 * page (or the address bar) the user is typing in. It is announced instead.
 * When the user DID reach it by keyboard, the answer hands focus back to the
 * page (review U5) and Escape dismisses it (review U8), so the keyboard is
 * never stranded on `<body>` once the band unmounts.
 */
export interface BrowserMediaPermissionPromptProps {
	view: MediaPermissionView | null | undefined;
	onDecide: (
		view: MediaPermissionView,
		decision: MediaPermissionDecision,
		trusted: boolean,
	) => void;
	/** The system-blocked notice's "Open System Settings". */
	onOpenSystemSettings?: (view: MediaPermissionView) => void;
	/** Return the keyboard to the page view after a keyboard answer. */
	onReturnFocus?: () => void;
}

/**
 * A private-use sentinel the site is formatted as, so the translated sentence
 * can be split around it and the host rendered at `font-medium` (review D1)
 * without an ICU rich-text tag in the audited catalogue. It carries no bidi
 * sigil, so RTL isolation wraps it like any argument and the isolates stay
 * around the emphasised span.
 */
const SITE_SENTINEL = "\uE000site\uE000";

function withSite(text: string, site: string): ReactNode {
	const parts = text.split(SITE_SENTINEL);
	if (parts.length === 1) return text;
	return parts.flatMap((part, index) =>
		index === 0
			? [part]
			: [
					// biome-ignore lint/suspicious/noArrayIndexKey: a fixed split of one sentence
					<span key={index} className="font-medium">
						{site}
					</span>,
					part,
				],
	);
}

export const BrowserMediaPermissionPrompt: FC<
	BrowserMediaPermissionPromptProps
> = ({ view, onDecide, onOpenSystemSettings, onReturnFocus }) => {
	useI18nLocale();
	if (!view) return null;
	const devices = mediaKindsLabel(view.kinds);
	const site = siteOf(view.origin);
	/** A keyboard activation is a `click` with `detail === 0`; a pointer click
	 * keeps the pointer's own focus behaviour. */
	const finish = (event: SyntheticEvent, keyboard: boolean) => {
		if (keyboard) onReturnFocus?.();
		event.stopPropagation();
	};
	const answer = (decision: MediaPermissionDecision) => (event: MouseEvent) => {
		onDecide(view, decision, event.nativeEvent.isTrusted === true);
		finish(event, event.detail === 0);
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		// Esc = ✕: dismiss denies this one request (or hides a notice) and
		// remembers nothing, so it can never grant.
		onDecide(view, "dismiss", event.nativeEvent.isTrusted === true);
		finish(event, true);
	};
	const Icon =
		view.kind === "system-blocked"
			? ShieldAlert
			: view.kind === "blocked"
				? ShieldOff
				: devices === "audio"
					? Mic
					: Camera;
	const label =
		view.kind === "system-blocked"
			? t("ui.browser.media_access.system_blocked_label", { devices })
			: view.kind === "blocked"
				? t("ui.browser.media_access.blocked_label", { devices })
				: t("ui.browser.media_access.prompt_label", { devices });
	const dismissLabel =
		view.kind === "prompt"
			? t("ui.browser.media_access.prompt_dismiss", { devices })
			: t("ui.browser.media_access.notice_dismiss");

	return (
		<output
			aria-live="polite"
			aria-label={label}
			data-tour-tag="browser-media-permission"
			data-media-permission-kind={view.kind}
			onKeyDown={onKeyDown}
			className="flex flex-wrap items-center gap-x-3 gap-y-2 border-control border-b bg-surface px-3 py-1.5"
		>
			<Icon aria-hidden className="size-4 shrink-0 text-ink-muted" />
			<p className="min-w-0 grow basis-64 text-body-sm text-ink">
				{view.kind === "system-blocked" ? (
					<>
						{t("ui.browser.media_permission.system_blocked", { devices })}{" "}
						<span className="text-ink-muted">
							{t("ui.browser.media_access.system_blocked_hint")}
						</span>
					</>
				) : view.kind === "blocked" ? (
					<>
						{withSite(
							t("ui.browser.media_access.blocked", {
								site: SITE_SENTINEL,
								devices,
							}),
							site,
						)}{" "}
						<span className="text-ink-muted">
							{t("ui.browser.media_access.blocked_hint")}
						</span>
					</>
				) : (
					<>
						{withSite(
							t("ui.browser.media_permission.message", {
								site: SITE_SENTINEL,
								devices,
							}),
							site,
						)}
						{view.ownerKind === "agent" && (
							<>
								{" "}
								<span className="text-ink-muted">
									{t("ui.browser.media_permission.agent_tab_hint")}
								</span>
							</>
						)}
					</>
				)}
			</p>
			<div className="ml-auto flex shrink-0 items-center gap-1">
				{view.kind === "prompt" && (
					<Button
						variant="outline"
						size="sm"
						onClick={answer("block")}
						data-tour-tag="browser-media-permission-block"
					>
						{t("ui.browser.media_permission.block")}
					</Button>
				)}
				{view.kind !== "system-blocked" && (
					// D2: the same variant as Block, so the pair rests AND hovers alike
					// (Chrome deliberately does not nudge toward Allow).
					<Button
						variant="outline"
						size="sm"
						onClick={answer("allow")}
						data-tour-tag="browser-media-permission-allow"
					>
						{t("ui.browser.media_permission.allow")}
					</Button>
				)}
				{view.kind === "system-blocked" && onOpenSystemSettings && (
					<Button
						variant="outline"
						size="sm"
						onClick={(event) => {
							onOpenSystemSettings(view);
							finish(event, event.detail === 0);
						}}
						data-tour-tag="browser-media-permission-settings"
					>
						{t("ui.browser.media_access.open_system_settings")}
					</Button>
				)}
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={dismissLabel}
					onClick={answer("dismiss")}
				>
					<X aria-hidden className="size-3.5" />
				</Button>
			</div>
		</output>
	);
};
