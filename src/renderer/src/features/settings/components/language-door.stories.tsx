/**
 * The language door (i18n slice B2): the palette's dialog, its saved state,
 * and the external-change announcement.
 *
 * WHAT THESE FRAMES ARE FOR. The door is a palette action opening a compact
 * dialog that carries the SAME enum control and `In effect:` note as the
 * settings row. Three states need to be photographable: the dialog freshly
 * opened; the same dialog after a real pick (the footer reads `Saved`, the
 * note has moved with the capabilities answer); and the announcement a
 * language changed ELSEWHERE produces - one quiet toast, the rendering of the
 * copy `locale-sync.ts` shows when the feed says another surface moved the
 * setting (`language-live-updates.test.mjs` proves the trigger chain; this
 * story photographs the announcement).
 *
 * The transport is stubbed the way `backend-settings.stories.tsx` stubs it -
 * `window.api.desktop.request` answers the ops this surface issues and
 * REFUSES anything else by name, so a read this door grows fails loudly
 * instead of photographing a transport error. `settings.edit` mutates the
 * live payload the way the backend does, because the saved state must show
 * the write's own result.
 *
 * The `dialog-saved` play runs in the capture rig's real Chromium: Radix's
 * listbox commits to real pointer events, which is exactly what the jsdom
 * suites cannot produce and why the save seam is tested there directly.
 */
import { ThemedToastContainer } from "@shared/components/common/themed-toast-container";
import { t } from "@shared/i18n";
import { useI18nLocaleSync } from "@shared/i18n/locale-sync";
import { showInfoToast } from "@shared/utils/toast-manager";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import { useEffect, useLayoutEffect } from "react";
import configuredJson from "../../../../../../scripts/fixtures/backend-settings-registry-configured.json";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import { LanguageDialog } from "./language-dialog";
import { useLanguageDialogStore } from "./language-dialog-store";

/* --------------------------------------------------------------- bridge */

type BridgeRequest = { op: string; [key: string]: unknown };

/** The live payload `settings.edit` mutates, so the saved state is honest. */
const payload = JSON.parse(JSON.stringify(configuredJson)) as {
	settings: Array<{ key: string; value: unknown; is_default: boolean }>;
};

const ok = (result: unknown): DesktopResponse => ({
	status: 200,
	body: { status: 200, message: "ok", result },
});

/*
 * How the capabilities answer behaves, per story: `ok` is the shipped answer;
 * `loading` never settles (a backend mid-handshake) and `cold-failure` fails
 * with no data at all. The two non-ok modes are the round-2 states - loading
 * reads strictly as loading, and a cold failure reads as the pairing sentence
 * with its Retry - and they exist here so those states are photographed, not
 * just asserted.
 */
let bridgeMode: "ok" | "loading" | "cold-failure" = "ok";

const bridge = async (request: BridgeRequest): Promise<DesktopResponse> => {
	switch (request.op) {
		case "capabilities":
			if (bridgeMode === "loading") {
				return new Promise<DesktopResponse>(() => {});
			}
			if (bridgeMode === "cold-failure") {
				return {
					status: 503,
					body: { status: 503, message: "The server is not answering." },
				};
			}
			return ok({
				desktop_contract: 1,
				desktop_available: true,
				desktop_auth: "bearer",
				/* `i18n` is the gate this door sits behind. */
				features: { settings: 1, i18n: 1 },
				language: "en",
			});
		case "settings.list":
			return ok(payload);
		case "settings.edit": {
			const row = payload.settings.find((s) => s.key === request.key);
			if (row) {
				row.value = request.value;
				row.is_default = false;
			}
			return ok({});
		}
		default:
			throw new Error(`settings-language-door: unstubbed op ${request.op}`);
	}
};

if (typeof window !== "undefined") {
	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: bridge };
}

/* --------------------------------------------------------------- stories */

const Ground: FC<{
	dialog?: boolean;
	mode?: "ok" | "loading" | "cold-failure";
}> = ({ dialog = true, mode = "ok" }) => {
	/* The app mounts this once; the note reads the store it feeds. */
	useI18nLocaleSync();
	bridgeMode = mode;
	useEffect(() => {
		if (dialog) useLanguageDialogStore.getState().openLanguage();
	}, [dialog]);
	return (
		<>
			{dialog && <LanguageDialog />}
			<ThemedToastContainer />
		</>
	);
};

/*
 * The repo's shutter contract, not `@storybook/test`'s plays: the harness
 * photographs as soon as elements and fonts exist, which is before a live
 * interaction can finish - so a driven story holds
 * `documentElement.dataset.capturePending` from a LAYOUT effect until the
 * state it claims is on screen, and the harness's readiness probe waits for
 * it to clear. A script whose state never arrives leaves the shutter closed
 * and fails the sweep instead of committing a picture of an untouched
 * dialog. The pointer sequence is the real one (Radix's listbox commits on
 * pointerup), dispatched DOM-level, which is this repo's shape for driven
 * states.
 */
const waitForDom = async <T,>(
	check: () => T | null | undefined,
	timeoutMs = 8000,
): Promise<T> => {
	const start = Date.now();
	for (;;) {
		const value = check();
		if (value !== null && value !== undefined) return value;
		if (Date.now() - start > timeoutMs) {
			throw new Error("settings-language-door: state never arrived");
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
};

const pointerClick = (el: Element) => {
	const options = {
		bubbles: true,
		cancelable: true,
		composed: true,
		button: 0,
		isPrimary: true,
	};
	el.dispatchEvent(new PointerEvent("pointerdown", options));
	el.dispatchEvent(new PointerEvent("pointerup", options));
	el.dispatchEvent(
		new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
	);
};

/** Drive a real pick, hold the shutter until `Saved` is in the footer. */
const DrivenSave: FC = () => {
	useLayoutEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		let cancelled = false;
		const run = async () => {
			try {
				const trigger = await waitForDom(() =>
					document.querySelector('[role="combobox"]'),
				);
				pointerClick(trigger);
				const option = await waitForDom(() =>
					[...document.querySelectorAll('[role="option"]')].find(
						(el) => el.textContent?.trim() === "en",
					),
				);
				pointerClick(option);
				/*
				 * Commit on pick: there is no Save to click. The picker's own
				 * report is the write, and the footer's `Saved` is its
				 * confirmation.
				 */
				await waitForDom(() => {
					const status = document.querySelector("[data-language-status]");
					return status?.textContent?.includes("Saved") ? status : null;
				});
				await new Promise((resolve) => setTimeout(resolve, 150));
			} finally {
				if (!cancelled) delete document.documentElement.dataset.capturePending;
			}
		};
		void run();
		return () => {
			cancelled = true;
			delete document.documentElement.dataset.capturePending;
		};
	}, []);
	return <Ground />;
};

/** Hold the shutter until the announcement is up. */
const DrivenToast: FC = () => {
	useLayoutEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		let cancelled = false;
		const run = async () => {
			try {
				await new Promise((resolve) => setTimeout(resolve, 500));
				showInfoToast(
					t("ui.settings.language.external_notice", { language: "fr" }),
					{ id: "i18n-language-external" },
				);
				await waitForDom(() => document.querySelector("[data-sonner-toast]"));
				await new Promise((resolve) => setTimeout(resolve, 250));
			} finally {
				if (!cancelled) delete document.documentElement.dataset.capturePending;
			}
		};
		void run();
		return () => {
			cancelled = true;
			delete document.documentElement.dataset.capturePending;
		};
	}, []);
	return <Ground dialog={false} />;
};

const meta: Meta = {
	title: "Settings/Language door",
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

/** The dialog as the palette action opens it. */
export const DialogOpen: Story = { render: () => <Ground /> };

/**
 * The same dialog after a REAL save: pick `en` in the portalled listbox with
 * the rig's pointer, press Save, and the frame carries the in-place
 * confirmation (`Saved`). The note beside it is rendered from the store -
 * the story's stub answers `en` throughout, so the note reading `en` is the
 * store's value, not a change this story performs.
 */
export const DialogSaved: Story = {
	render: () => <DrivenSave />,
};

export const ExternalToast: Story = {
	render: () => <DrivenToast />,
};

/*
 * The two round-2 states (R2-1/U5/Q-2), photographed so the classification is
 * reviewable rather than asserted only: a backend that has not answered reads
 * STRICTLY as loading - no sentence about a backend that has not spoken - and
 * a COLD failure reads as the pairing sentence with a Retry whose arm is
 * reachable (`language-dialog.test.mjs` proves the click re-asks
 * capabilities).
 */
export const DialogLoading: Story = {
	render: () => <Ground mode="loading" />,
};

export const DialogColdFailure: Story = {
	render: () => <Ground mode="cold-failure" />,
};
