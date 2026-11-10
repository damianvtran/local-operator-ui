import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { Camera, Mic, ShieldAlert, X } from "lucide-react";
import type { FC, MouseEvent } from "react";
import {
	type MediaPermissionDecision,
	type MediaPermissionView,
	mediaKindsLabel,
} from "../../../../../shared/browser-media-permission";
import { siteOf } from "./browser-passkey-notice";

/**
 * The browser's camera/microphone prompt: Chrome's "<site> wants to use your
 * camera and microphone — Allow / Block", as a band in the chrome above the
 * page (the same placement as the passkey notice, so the page view is never
 * covered and no new native surface is needed).
 *
 * WHY THE CLICK'S `isTrusted` TRAVELS: main grants only on a decision that
 * carries `trusted: true` (`src/main/browser/media-permissions.ts`). A real
 * mouse or keyboard activation of these buttons is trusted; a scripted
 * `.click()` is not. The primary boundary is that nothing but this window's
 * renderer can reach the decision channel at all — this is defence in depth.
 *
 * NO AUTOFOCUS, deliberately: the prompt must not take the keyboard from the
 * page (or the address bar) the user is typing in. It is announced instead.
 */
export interface BrowserMediaPermissionPromptProps {
	view: MediaPermissionView | null | undefined;
	onDecide: (
		view: MediaPermissionView,
		decision: MediaPermissionDecision,
		trusted: boolean,
	) => void;
}

export const BrowserMediaPermissionPrompt: FC<
	BrowserMediaPermissionPromptProps
> = ({ view, onDecide }) => {
	useI18nLocale();
	if (!view) return null;
	const devices = mediaKindsLabel(view.kinds);
	const site = siteOf(view.origin);
	const answer = (decision: MediaPermissionDecision) => (event: MouseEvent) =>
		onDecide(view, decision, event.nativeEvent.isTrusted === true);
	const Icon =
		view.kind === "system-blocked"
			? ShieldAlert
			: devices === "audio"
				? Mic
				: Camera;

	return (
		<output
			aria-live="polite"
			aria-label={t("ui.browser.media_permission.label")}
			data-tour-tag="browser-media-permission"
			className="flex flex-wrap items-center gap-x-3 gap-y-2 border-control border-b bg-surface px-3 py-1.5"
		>
			<Icon aria-hidden className="size-4 shrink-0 text-ink-muted" />
			<p className="min-w-0 grow basis-64 text-body-sm text-ink">
				{view.kind === "system-blocked" ? (
					<>
						{t("ui.browser.media_permission.system_blocked", { devices })}{" "}
						<span className="text-ink-muted">
							{t("ui.browser.media_permission.system_blocked_hint")}
						</span>
					</>
				) : (
					<>
						{t("ui.browser.media_permission.message", { site, devices })}
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
					<>
						<Button
							variant="outline"
							size="sm"
							onClick={answer("block")}
							data-tour-tag="browser-media-permission-block"
						>
							{t("ui.browser.media_permission.block")}
						</Button>
						<Button
							size="sm"
							onClick={answer("allow")}
							data-tour-tag="browser-media-permission-allow"
						>
							{t("ui.browser.media_permission.allow")}
						</Button>
					</>
				)}
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={t("ui.browser.media_permission.dismiss")}
					onClick={answer("dismiss")}
				>
					<X aria-hidden className="size-3.5" />
				</Button>
			</div>
		</output>
	);
};
