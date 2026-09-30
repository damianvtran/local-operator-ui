import {
	browserViewSuppressed,
	useSuppressBrowserView,
} from "@shared/browser-view-policy";
import type { FirstTimeDecision } from "@shared/hooks/first-time-user";
import { showWarningToast } from "@shared/utils/toast-manager";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { shouldOfferCompanion } from "./companion-welcome-policy";
import { useCompanionSettings } from "./use-companion-settings";

const WelcomeDialog = lazy(() =>
	import("./companion-settings").then((module) => ({
		default: module.CompanionWelcomeDialog,
	})),
);

export function CompanionWelcome({
	decision,
	onboardingActive,
}: { decision: FirstTimeDecision; onboardingActive: boolean }) {
	const { settings, update } = useCompanionSettings();
	const setupThisLaunch = useRef(false);
	const dismissed = useRef(false);
	const opener = useRef<HTMLElement | null>(null);
	const [open, setOpen] = useState(false);
	if (decision === "first_time") setupThisLaunch.current = true;
	useSuppressBrowserView(
		open && !!settings && !settings.introduced,
		"companion-welcome",
	);
	useEffect(() => {
		if (
			(decision === "first_time" || setupThisLaunch.current) &&
			settings &&
			!settings.introduced
		)
			void update({ introduced: true }).catch(() => {});
	}, [decision, settings, update]);
	useEffect(() => {
		if (!settings || settings.introduced || open || dismissed.current) return;
		let timer: number | undefined;
		const offer = () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				const editing =
					document.activeElement?.matches(
						"input, textarea, [contenteditable='true']",
					) ?? false;
				const covered =
					browserViewSuppressed() ||
					!!document.querySelector(
						"[role='dialog'], [role='alertdialog'], [role='menu'], .shepherd-enabled",
					);
				if (
					shouldOfferCompanion({
						decision,
						introduced: settings.introduced,
						setupThisLaunch: setupThisLaunch.current,
						onboardingActive,
						covered,
						visible: !document.hidden,
						focused: document.hasFocus(),
						editing,
					})
				) {
					opener.current =
						document.activeElement instanceof HTMLElement
							? document.activeElement
							: null;
					setOpen(true);
				}
			}, 180);
		};
		document.addEventListener("pointerup", offer);
		document.addEventListener("keyup", offer);
		return () => {
			window.clearTimeout(timer);
			document.removeEventListener("pointerup", offer);
			document.removeEventListener("keyup", offer);
		};
	}, [decision, onboardingActive, settings, open]);
	if (!open || !settings || settings.introduced) return null;
	return (
		<Suspense fallback={null}>
			<WelcomeDialog
				settings={settings}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					if (opener.current?.isConnected) opener.current.focus();
				}}
				onChoose={async (enabled, character) => {
					try {
						await update({ enabled, character, introduced: true });
					} catch (error) {
						if (enabled) throw error;
						showWarningToast(
							"Your companion preference could not be saved. You can change it in Settings.",
						);
					}
					dismissed.current = true;
					setOpen(false);
				}}
			/>
		</Suspense>
	);
}
