/**
 * @file tour-settings-tab.ts
 * @description
 * Revealing the Settings panel a tour step is about to spotlight.
 *
 * ## Why the tour has to click now
 *
 * Settings shows ONE panel at a time. Three of the tour's steps point inside a
 * panel (`settings-appearance-section`, `settings-radient-account-section`,
 * `settings-app-updates-section`), and the General step points at the scroller
 * itself — which stays visible whichever tab is showing. Without a click, the
 * tour reaches a step whose panel is hidden, and Shepherd either attaches to a
 * `display: none` box (a spotlight over nothing) or, on the way BACK from a
 * later step, spotlights the scroller while a different panel's content fills
 * it.
 *
 * So each of the four settings steps reveals its own tab first, through the
 * rail row that already carries the step's tag. The step's `beforeShowPromise`
 * runs before the guard's polling starts, so the click has happened by the time
 * the guard asks whether the target is present — and the guard's own wait then
 * covers the commit that unhides the panel.
 *
 * ## The click is guarded, not blind
 *
 * The rail row is a history push, so clicking the row of the tab that is
 * already showing would add a duplicate entry for nothing. `tourGearNeedsClick`
 * — the same `aria-current="page"` reading the gear uses — is the guard: the
 * row reports whether clicking it would change anything.
 *
 * The module is free of Shepherd and of the settings page, so its rules can be
 * asserted without booting a tour or a renderer.
 */
import { tourGearNeedsClick } from "./tour-gear-open";

/**
 * How long to wait for a rail row that has not painted yet.
 *
 * The row can be absent for one frame after the gear opens Settings (the page
 * mounts behind a lazy chunk). The bound matches the guard's own
 * `TOUR_TARGET_WAIT_MS` and is well above the observed paint.
 */
export const TOUR_SETTINGS_ROW_WAIT_MS = 2_000;
const TOUR_SETTINGS_ROW_POLL_MS = 100;

/**
 * Whether a tour target is on screen, as the tour means it.
 *
 * `querySelector` alone answers "is it in the document", and every settings
 * panel stays mounted (Cmd/Ctrl+F reads the rendered DOM), so a hidden panel's
 * targets are in the document and invisible. `closest("[hidden]")` is the same
 * reading the search jump and the Backend reveal loop use for "not reachable
 * yet", which keeps one definition of visible across the page.
 */
export function isTourTargetVisible(element: Element | null): boolean {
	return element !== null && element.closest("[hidden]") === null;
}

/**
 * Click the rail row that shows `tag`'s panel, once it exists.
 *
 * Resolves — never rejects — at the bound or at the click: a step whose row
 * never appears is the guard's business (it skips the step and says so), not a
 * promise the tour can hang on.
 */
export function revealSettingsTab(
	tag: string,
	options: {
		waitMs?: number;
		pollMs?: number;
		/** The document to search; the test passes a stub. */
		doc?: Pick<Document, "querySelector">;
	} = {},
): Promise<void> {
	const doc = options.doc ?? document;
	const waitMs = options.waitMs ?? TOUR_SETTINGS_ROW_WAIT_MS;
	const pollMs = options.pollMs ?? TOUR_SETTINGS_ROW_POLL_MS;
	const deadline = Date.now() + waitMs;
	return new Promise((resolve) => {
		const step = () => {
			const row = doc.querySelector(`[data-tour-tag="${tag}"]`);
			if (row) {
				if (tourGearNeedsClick(row)) (row as HTMLElement).click();
				resolve();
				return;
			}
			if (Date.now() >= deadline) {
				resolve();
				return;
			}
			setTimeout(step, pollMs);
		};
		step();
	});
}
