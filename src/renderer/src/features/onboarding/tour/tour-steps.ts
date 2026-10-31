import { currentLocale, t, textDirectionFor } from "@shared/i18n";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Step, StepOptions, Tour } from "shepherd.js";
import { TOUR_BODIES, renderTourBody, tourLabel } from "./tour-copy";

/**
 * The element carrying a tour tag that the user can actually see.
 *
 * Two controls can carry the same tag when a surface collapses responsively -
 * the agents header renders either its three buttons or a single overflow
 * trigger, never both - so a plain `querySelector` can return the hidden one
 * and leave the spotlight attached to a `display:none` element. `offsetParent`
 * is null for exactly that case, which is what the collapse uses.
 */
const visibleTourTarget = (tag: string): HTMLElement | null => {
	const carriers = Array.from(
		document.querySelectorAll<HTMLElement>(`[data-tour-tag="${tag}"]`),
	);
	return carriers.find((el) => el.offsetParent !== null) ?? carriers[0] ?? null;
};

/**
 * Press the control that performs a tour action, visible or not.
 *
 * Separate from `visibleTourTarget` because the two questions have different
 * answers when a surface collapses: the agents header shows either its wide
 * "Upload to hub" button or an overflow trigger, and only the wide one opens
 * the dialog - the trigger just opens a menu. The spotlight must follow what
 * the user can see; the action must follow what does the work. `click()` does
 * not require visibility, so pressing the hidden carrier is legitimate and is
 * what the tour did before it had two carriers to choose between.
 */
const pressTourAction = (action: string): void => {
	document
		.querySelector<HTMLElement>(`[data-tour-action="${action}"]`)
		?.click();
};

/**
 * The viewport width at which step 7 can stand BESIDE the command palette.
 *
 * The palette is 640 CSS px wide and centred (`w-160 max-w-[90vw]` in
 * `command-palette.tsx`), and step 7's beside-the-palette panel is capped at
 * 340 px in `onboarding-tour.css` with an 8 px arrow overhang, so
 *   640 + 2 x (340 + 8) = 1336
 * is the first viewport that can hold both with no overlap at all. 1340 is
 * that floor rounded up, which leaves 10 px between the panel and the window
 * edge at the threshold rather than the flush edge a 500 px panel had (design
 * round 1, D5). Narrower than this, the palette is not opened for step 7 at
 * all: a 500 px panel cannot fit beside a 640 px palette at any size the
 * desktop window supports, and covering the field this step tells the user to
 * type into is worse than showing the same copy centred (D1).
 */
export const STEP_BESIDE_PALETTE_MIN_WIDTH = 1340;

/**
 * Marks the step-7 panel that is pinned beside the palette, and caps its width.
 *
 * The class records the shape step 7 is CURRENTLY in, not the one the tour was
 * built in. It used to be a build-time record, which is wrong the moment the
 * window moves under the tour: `startTour` builds the steps once, so a window
 * resized from the beside width down to 900 px kept the attached shape and
 * reopened the 130 px overlap D1 removed (review round 3, R3-3).
 * `applyStepSevenShape` therefore re-decides the shape from the live viewport on
 * every hop into step 7 and on every `show`, and this class follows the
 * decision - which is also what the CSS keys its 340 px cap on.
 */
export const STEP_BESIDE_PALETTE_CLASS = "tour-beside-palette";

const STEP_SEVEN_ID = "pre-command-palette-open-canvas";

/** The palette dialog step 7 sits beside; it is mounted only while open. */
const STEP_SEVEN_ANCHOR = '[data-tour-tag="command-palette-dialog"]';

/**
 * The side a panel attaches on, mirrored when the window reads right-to-left.
 *
 * `attachTo.on` is PHYSICAL: Shepherd hands it to Floating UI as a placement, so
 * `right` means the panel starts at the target's right edge on the SCREEN. The
 * app's own layout is logical - in a right-to-left language the root carries
 * `dir="rtl"`, the sidebar and its icon column move to the right, and the free
 * side becomes the left one - so a panel pinned `right` lands on top of the
 * mirrored chrome it is describing. Every attached step shipped that way in
 * `ur` (design round 4, D6): the panel sat over the RTL sidebar's icon column.
 *
 * The direction is a property of the LANGUAGE, not of this file, so it is read
 * from the shipped manifest through `textDirectionFor` (`i18n/direction.ts`)
 * rather than from a list here: an Arabic, Hebrew or Persian catalogue added
 * later mirrors without anyone remembering this function exists. It is resolved
 * at build time because `startTour` rebuilds the steps in the language active
 * at that moment, and again wherever the shape is rewritten mid-tour.
 */
const attachSide = (side: "left" | "right"): "left" | "right" => {
	if (textDirectionFor(currentLocale()) !== "rtl") return side;
	return side === "left" ? "right" : "left";
};

/** Is step 7 currently in its beside-the-palette shape? */
const stepSevenSitsBesidePalette = (tour: Tour): boolean =>
	(tour.getById(STEP_SEVEN_ID)?.options.classes ?? "")
		.split(" ")
		.includes(STEP_BESIDE_PALETTE_CLASS);

/**
 * Re-decide step 7's shape from the live viewport, and apply it to the step.
 *
 * Called before every hop into or out of step 7 and from the tour's `show`
 * listener (`syncStepSevenShapeOnShow`), so the panel a user is looking at
 * always matches the window it renders in. Shepherd rebuilds a step's element
 * and re-resolves `attachTo` on every `_show`, so writing the options just
 * before a show is enough - no re-layout of a panel that is already on screen is
 * attempted, which is the one resize case this deliberately does not chase
 * (a resize while standing on step 7 is corrected by the next Back/Next).
 *
 * Returns whether the shape is beside after the decision, which is what the hop
 * helpers need before they touch the palette.
 */
/** Write step 7's shape onto the step, when it differs from the one it has. */
const writeStepSevenShape = (tour: Tour, beside: boolean): void => {
	const step = tour.getById(STEP_SEVEN_ID);
	if (!step || stepSevenSitsBesidePalette(tour) === beside) return;
	/*
	 * Write both fields together: the class alone would cap a centred panel
	 * at 340 px, and `attachTo` alone would pin a panel that cannot fit.
	 */
	step.updateStepOptions(
		beside
			? {
					attachTo: { element: STEP_SEVEN_ANCHOR, on: attachSide("right") },
					classes: STEP_BESIDE_PALETTE_CLASS,
				}
			: { attachTo: undefined, classes: undefined },
	);
};

/**
 * Re-decide step 7's shape from the live viewport, and apply it to the step.
 *
 * Called before every hop into or out of step 7 and from the tour's `show`
 * listener (`syncStepSevenShapeOnShow`), so the panel a user is looking at
 * always matches the window it renders in. Shepherd rebuilds a step's element
 * and re-resolves `attachTo` on every `_show`, so writing the options just
 * before a show is enough - no re-layout of a panel that is already on screen is
 * attempted, which is the one resize case this deliberately does not chase
 * (a resize while standing on step 7 is corrected by the next Back/Next).
 *
 * Returns whether the shape is beside after the decision, which is what the hop
 * helpers need before they touch the palette.
 */
const applyStepSevenShape = (tour: Tour): boolean => {
	const beside = window.innerWidth >= STEP_BESIDE_PALETTE_MIN_WIDTH;
	writeStepSevenShape(tour, beside);
	return beside;
};

/**
 * The palette's close generation, and the generation each tour's claim was
 * taken in.
 *
 * R3-2 is a contract about ownership: the tour closes the palette IT opened and
 * leaves a palette the user opened alone. That cannot be answered by asking
 * whether the palette is open - it is open in both cases - so each tour records
 * its own claim here. A WeakMap keeps a tour that disappears without a complete
 * or cancel from leaving state behind.
 *
 * A claim on its own answers a weaker question than the contract asks: "this
 * tour opened a palette at some point", not "the palette on screen is the one it
 * opened". `Cmd+K` is a window-level shortcut the tour does not intercept, so a
 * user standing on step 7 can close the tour's palette and open their own; a
 * claim that survives that close makes the tour shut a dialog it never opened
 * (review round 4, R4-1). The store's flag is the only place that transition is
 * observable, and a WeakMap cannot be enumerated to clear, so a claim records
 * the generation it was taken in and expires when the generation moves on.
 * Module state because the claim outlives any mount: the buttons that read it
 * are Shepherd's, not React's.
 */
let paletteCloseGeneration = 0;
const paletteClaimGeneration = new WeakMap<Tour, number>();

useUiPreferencesStore.subscribe((state, previous) => {
	if (previous.isCommandPaletteOpen && !state.isCommandPaletteOpen) {
		paletteCloseGeneration += 1;
	}
});

/**
 * Close the palette if THIS tour opened it, and do nothing otherwise.
 *
 * Called when a tour ends (the hook's cancel/complete listener) and when a hop
 * out of step 7 leaves. `WeakMap.delete` doubles as the atomic "claim was
 * there" test, so a second call - a hop that already closed it, then a cancel -
 * cannot close a palette the user has opened in between. Returns whether it
 * actually closed the palette, which is the difference between waiting for the
 * palette's unmount and moving on immediately.
 */
export const releaseTourCommandPalette = (tour: Tour): boolean => {
	const claimed = paletteClaimGeneration.get(tour);
	if (claimed === undefined) return false;
	paletteClaimGeneration.delete(tour);
	/*
	 * A claim from an earlier generation belongs to a palette the user has since
	 * replaced, so it is spent rather than ours - and it is dropped on the way
	 * out so it cannot be spent a second time.
	 */
	if (claimed !== paletteCloseGeneration) return false;
	useUiPreferencesStore.getState().closeCommandPalette();
	return true;
};

/**
 * Open the command palette on the way INTO step 7, but only when the panel will
 * sit beside it.
 *
 * The palette is step 7's context: the step points at the field that takes the
 * `#`/`@`/`,`/`>` prefixes. Below the breakpoint the step is centred and the
 * palette is deliberately left closed, so opening it anyway would put a modal
 * over a panel that is not attached to it - and, because the palette is a modal
 * Radix dialog, under a body-wide pointer lock the panel would not even be
 * clickable. The 500 ms is the palette's mount before the panel positions
 * against it.
 */
const openCommandPaletteForStepSeven = (tour: Tour, go: () => void): void => {
	if (!applyStepSevenShape(tour)) {
		go();
		return;
	}
	/*
	 * Only a palette this tour opens is a palette this tour may close: a user's
	 * palette that is already up must outlive the tour, so it is neither opened
	 * nor claimed here.
	 */
	const store = useUiPreferencesStore.getState();
	if (!store.isCommandPaletteOpen) {
		store.openCommandPalette();
		paletteClaimGeneration.set(tour, paletteCloseGeneration);
	}
	/*
	 * The wait is skipped when the tour has ended in the meantime. Without the
	 * guard the deferred `next()`/`back()` resumes a cancelled tour: the X is a
	 * live target during the wait since the panel re-admitted pointer events
	 * (review round 3, R3-1).
	 */
	setTimeout(() => {
		if (tour.isActive()) go();
	}, 500);
};

/**
 * The mirror of the above: close the palette a step-7 approach opened, then
 * continue. Below the breakpoint nothing was opened, so waiting 500 ms for a
 * dialog that is not there would be a visible stall on Back/Next.
 *
 * The predicate is ownership, not the shape: a window resized to the narrow
 * shape while step 7 is on screen still leaves a palette the tour opened behind,
 * and that one has to close. The wait follows the same answer - a palette the
 * user closed and replaced is not one this hop has to wait for, and stalling on
 * it is the second half of R4-1.
 */
const closeCommandPaletteAfterStepSeven = (
	tour: Tour,
	go: () => void,
): void => {
	if (!releaseTourCommandPalette(tour)) {
		go();
		return;
	}
	setTimeout(() => {
		if (tour.isActive()) go();
	}, 500);
};

/**
 * Shepherd's tour-level `show` listener: re-decide step 7's shape for the window
 * the step is about to render in.
 *
 * The hop helpers make the same decision before they touch the palette, but a
 * show can also come from anywhere else - a direct `tour.show(id)`, or a resize
 * inside the 500 ms the palette takes to mount. Deciding here, right before
 * Shepherd rebuilds the panel, is what keeps "the shape" and "the palette on
 * screen" one decision rather than two that can disagree.
 *
 * The event payload is Shepherd's (`{ step }`), which is what lets this be a
 * stable module-scope listener the hook can `off()` before re-adding.
 */
export const syncStepSevenShapeOnShow = (event: { step?: Step }): void => {
	const step = event?.step;
	if (step?.id !== STEP_SEVEN_ID) return;
	const beside = applyStepSevenShape(step.tour);
	/*
	 * A WIDE WINDOW IS NOT THE SAME FACT AS A PALETTE TO SIT BESIDE.
	 *
	 * Shepherd resolves `attachTo` when the step is shown, and a target that is
	 * not in the DOM is not a placement: it warns (`The element for this Shepherd
	 * step was not found`), drops the attachment and centres the panel. With this
	 * class still on it that is a 340 px column in the middle of the window whose
	 * arrow points at nothing - which is the shape design round 4 measured as D9
	 * (520-860 in a 1380 window, `tour-beside-palette` AND `shepherd-centered`).
	 *
	 * The palette really can be absent here, and not only because a hop went
	 * wrong: the hop opens it and waits a fixed 500 ms for the mount, so a Cmd+K
	 * between the two (a window-level shortcut the tour does not intercept) leaves
	 * the claim spent and nothing on screen, and any future caller of
	 * `tour.show(STEP_SEVEN_ID)` reaches the step with no palette opened at all.
	 * The shape therefore follows the ANCHOR, not the viewport alone: no dialog,
	 * no beside shape - the copy and the footer are the same, only centred.
	 *
	 * The CLAIM is deliberately left alone here. It records who opened the palette,
	 * which is a different fact from whether its dialog has painted yet: a palette
	 * this tour opened one frame ago is still mounting, and releasing the claim on
	 * a missing element would shut it (and skip the hop's own wait) on the
	 * strength of a timing accident. Ending the tour still releases it.
	 */
	if (!beside || document.querySelector(STEP_SEVEN_ANCHOR) === null) {
		writeStepSevenShape(step.tour, false);
	}
};

/**
 * Step 7, in the shape this window can hold.
 *
 * Above the breakpoint the panel is pinned to the palette's right edge, so the
 * focused search field this step is about stays uncovered; the narrow width
 * lives in `onboarding-tour.css` (`STEP_BESIDE_PALETTE_CLASS`), which is also
 * how the neighbouring steps learn which shape was built. Below it the palette
 * is never opened, so there is nothing to attach to and Shepherd centres the
 * same copy instead - a 500 px panel over a 640 px palette covered the field at
 * every width the window supports (design round 1, D1).
 *
 * The shape is decided when the tour's steps are built AND re-decided by
 * `applyStepSevenShape` on every hop and every show, so Back and Next always
 * agree with the panel the user is actually looking at, including after a
 * mid-tour resize across the breakpoint (review round 3, R3-3).
 */
const commandPaletteStep = (): StepOptions => {
	const besidePalette = window.innerWidth >= STEP_BESIDE_PALETTE_MIN_WIDTH;
	return {
		id: STEP_SEVEN_ID,
		...(besidePalette
			? {
					attachTo: {
						element: '[data-tour-tag="command-palette-dialog"]',
						on: attachSide("right"),
					},
					classes: STEP_BESIDE_PALETTE_CLASS,
				}
			: {}),
		title: tourLabel(
			"ui.onboarding.tour.pre_command_palette_open_canvas.title",
		),
		text: renderTourBody(TOUR_BODIES.pre_command_palette_open_canvas),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					closeCommandPaletteAfterStepSeven(this, () => this.back());
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					closeCommandPaletteAfterStepSeven(this, () => this.next());
				},
			},
		],
	};
};

/**
 * Build the walkthrough's steps in the active language.
 *
 * WHY THIS IS A FACTORY, NOT A MODULE-SCOPE ARRAY. `t()` resolves at call
 * time; a module-scope array would freeze the first language the module was
 * imported in and never follow a language switch. `startTour` calls this while
 * starting, so every tour opens in the language current at that moment.
 *
 * The copy and body structure live in `./tour-copy`; this module owns the
 * mechanics — spotlights, navigation, and the action each step's buttons run.
 */
export const createTourSteps = (): StepOptions[] => [
	{
		id: "welcome",
		title: tourLabel("ui.onboarding.tour.welcome.title"),
		text: renderTourBody(TOUR_BODIES.welcome),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "agent-list",
		attachTo: {
			element: '[data-tour-tag="agent-list-panel"]',
			on: attachSide("right"),
		},
		title: tourLabel("ui.onboarding.tour.agent_list.title"),
		text: renderTourBody(TOUR_BODIES.agent_list),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "select-agent",
		// Targets the first AgentListItemButton within the AgentsList using the new data-tour-tag
		attachTo: {
			element: '[data-tour-tag="agent-list-item-button-0"]',
			on: attachSide("right"),
		},
		title: tourLabel("ui.onboarding.tour.select_agent.title"),
		text: renderTourBody(TOUR_BODIES.select_agent),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="agent-list-item-button-0"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "chat-input",
		attachTo: {
			element: '[data-tour-tag="chat-input-textarea"]',
			on: "top",
		},
		title: tourLabel("ui.onboarding.tour.chat_input.title"),
		text: renderTourBody(TOUR_BODIES.chat_input),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "attachments",
		attachTo: {
			element: 'button[data-tour-tag="chat-input-attach-file-button"]',
			on: "top",
		},
		title: tourLabel("ui.onboarding.tour.attachments.title"),
		text: renderTourBody(TOUR_BODIES.attachments),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "agent-capabilities",
		attachTo: { element: '[data-tour-tag="chat-header"]', on: "top" },
		title: tourLabel("ui.onboarding.tour.agent_capabilities.title"),
		text: renderTourBody(TOUR_BODIES.agent_capabilities),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					openCommandPaletteForStepSeven(this, () => this.next());
				},
			},
		],
	},
	commandPaletteStep(),
	{
		id: "canvas-open-button",
		attachTo: {
			element: 'button[data-tour-tag="open-canvas-button"]',
			on: attachSide("left"),
		},
		title: tourLabel("ui.onboarding.tour.canvas_open_button.title"),
		text: renderTourBody(TOUR_BODIES.canvas_open_button),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					openCommandPaletteForStepSeven(this, () => this.back());
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="open-canvas-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "canvas-feature",
		attachTo: {
			element: '[data-tour-tag="canvas-container"]',
			on: attachSide("left"),
		},
		title: tourLabel("ui.onboarding.tour.canvas_feature.title"),
		text: renderTourBody(TOUR_BODIES.canvas_feature),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="close-canvas-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.back();
					}, 500);
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="canvas-documents-view-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "canvas-documents-view",
		attachTo: {
			element: 'button[data-tour-tag="canvas-documents-view-button"]',
			on: "top",
		},
		title: tourLabel("ui.onboarding.tour.canvas_documents_view.title"),
		text: renderTourBody(TOUR_BODIES.canvas_documents_view),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="canvas-files-view-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "canvas-files-view",
		attachTo: {
			element: 'button[data-tour-tag="canvas-files-view-button"]',
			on: "top",
		},
		title: tourLabel("ui.onboarding.tour.canvas_files_view.title"),
		text: renderTourBody(TOUR_BODIES.canvas_files_view),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="canvas-documents-view-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.back();
					}, 500);
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="canvas-variables-view-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "canvas-variables-view",
		attachTo: {
			element: 'button[data-tour-tag="canvas-variables-view-button"]',
			on: "top",
		},
		title: tourLabel("ui.onboarding.tour.canvas_variables_view.title"),
		text: renderTourBody(TOUR_BODIES.canvas_variables_view),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="canvas-files-view-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.back();
					}, 500);
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					const closeButton = document.querySelector(
						'button[data-tour-tag="close-canvas-button"]',
					);
					if (closeButton) {
						(closeButton as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "agent-options",
		attachTo: {
			element: 'button[data-tour-tag="agent-options-button"]',
			on: attachSide("right"),
		},
		title: tourLabel("ui.onboarding.tour.agent_options.title"),
		text: renderTourBody(TOUR_BODIES.agent_options),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="open-canvas-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.back();
					}, 500);
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="agent-options-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the menu to open before clicking the next button
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "click-view-settings-from-chat",
		// Assumes Agent Options menu is open from the previous step
		attachTo: {
			element:
				'[role="menuitem"][data-tour-tag="view-agent-settings-menu-item"]',
			on: attachSide("right"),
		},
		title: tourLabel("ui.onboarding.tour.click_view_settings_from_chat.title"),
		text: renderTourBody(TOUR_BODIES.click_view_settings_from_chat),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'[role="menuitem"][data-tour-tag="view-agent-settings-menu-item"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "view-agent-settings",
		// Targets the DetailsPaper component in AgentSettings
		attachTo: {
			element: 'div[data-tour-tag="agent-settings-details-paper"]',
			on: attachSide("left"),
		},
		title: tourLabel("ui.onboarding.tour.view_agent_settings.title"),
		text: renderTourBody(TOUR_BODIES.view_agent_settings),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-chat"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}

					setTimeout(() => {
						const settingsButton = document.querySelector(
							'button[data-tour-tag="agent-options-button"]',
						);
						if (settingsButton) {
							(settingsButton as HTMLButtonElement).click();
						}
					}, 500);

					// Wait for the menu to open before clicking the back button
					setTimeout(() => {
						this.back();
					}, 1000);
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			}, // Will go to select-provider
		],
	},
	{
		id: "select-provider",
		attachTo: {
			element: '[data-tour-tag="agent-settings-hosting-select"]',
			on: attachSide("left"),
		},
		title: tourLabel("ui.onboarding.tour.select_provider.title"),
		text: renderTourBody(TOUR_BODIES.select_provider),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			}, // Goes to view-agent-settings
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			}, // Goes to select-model
		],
	},
	{
		id: "select-model",
		attachTo: {
			element: '[data-tour-tag="agent-settings-model-select"]',
			on: attachSide("left"),
		},
		title: tourLabel("ui.onboarding.tour.select_model.title"),
		text: renderTourBody(TOUR_BODIES.select_model),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			}, // Goes to select-provider
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			}, // Goes to modify-security-prompt
		],
	},
	{
		id: "modify-security-prompt",
		attachTo: {
			element: '[data-tour-tag="agent-settings-security"]',
			on: attachSide("left"),
		}, // Attaching to the broader "Model Settings" card as a proxy
		title: tourLabel("ui.onboarding.tour.modify_security_prompt.title"),
		text: renderTourBody(TOUR_BODIES.modify_security_prompt),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			}, // Goes to select-model
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			}, // Goes to modify-agent-prompt
		],
	},
	{
		id: "modify-agent-prompt",
		attachTo: {
			element: '[data-tour-tag="agent-settings-system-prompt"]',
			on: attachSide("left"),
		},
		title: tourLabel("ui.onboarding.tour.modify_agent_prompt.title"),
		text: renderTourBody(TOUR_BODIES.modify_agent_prompt),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			}, // Goes to modify-security-prompt
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "create-new-agent",
		attachTo: {
			element: 'button[data-tour-tag="create-new-agent-button"]',
			on: "bottom",
		},
		title: tourLabel("ui.onboarding.tour.create_new_agent.title"),
		text: renderTourBody(TOUR_BODIES.create_new_agent),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					// We are on the main page (agent list/chat). Need to go to agent settings page.
					// This assumes an agent is selected and we can navigate to its settings.
					// Attempt to click the first agent to ensure context, then options, then settings.
					const agentButton = document.querySelector(
						'[data-tour-tag="agent-list-item-button-0"]',
					);
					if (agentButton) {
						// Check if we are already on the chat page for this agent, if not, click it.
						// This logic might need refinement based on actual app state management.
						// For now, we assume clicking it is safe or sets the context.
						(agentButton as HTMLButtonElement).click();
					}

					setTimeout(() => {
						const agentOptionsButton = document.querySelector(
							'button[data-tour-tag="agent-options-button"]',
						);
						if (agentOptionsButton) {
							(agentOptionsButton as HTMLButtonElement).click();
						}
					}, 500); // Wait for agent selection/navigation

					setTimeout(() => {
						const viewSettingsMenuItem = document.querySelector(
							'[role="menuitem"][data-tour-tag="view-agent-settings-menu-item"]',
						);
						if (viewSettingsMenuItem) {
							(viewSettingsMenuItem as HTMLButtonElement).click();
						}
					}, 1000); // Wait for options menu

					setTimeout(() => {
						this.back();
					}, 1500); // Go to modify-agent-prompt (now on agent settings page)
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="create-new-agent-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.next();
					}, 1000);
				},
			},
		],
	},
	{
		id: "agent-naming-guidelines",
		attachTo: {
			element: '[data-tour-tag="create-agent-dialog"]',
			on: attachSide("right"),
		},
		title: tourLabel("ui.onboarding.tour.agent_naming_guidelines.title"),
		text: renderTourBody(TOUR_BODIES.agent_naming_guidelines),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="create-agent-dialog-cancel-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.back();
					}, 500);
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="create-agent-dialog-cancel-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "navigate-agent-hub",
		// Targets the NavItemButton for Agent Hub via its icon's aria-label
		attachTo: {
			element: '[data-tour-tag="nav-item-agent-hub"]',
			on: attachSide("right"),
		},
		title: tourLabel("ui.onboarding.tour.navigate_agent_hub.title"),
		text: renderTourBody(TOUR_BODIES.navigate_agent_hub),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-agents"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						const newAgentButton = document.querySelector(
							'[data-tour-tag="create-new-agent-button"]',
						);
						if (newAgentButton) {
							(newAgentButton as HTMLButtonElement).click();
						}
					}, 500);
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.back();
					}, 1000);
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-agent-hub"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "agent-hub-view",
		// Targets the SidebarContainer in AgentHubPage that wraps AgentCategoriesSidebar
		attachTo: {
			element: '[data-tour-tag="agent-hub-sidebar-container"]',
			on: attachSide("right"),
		},
		title: tourLabel("ui.onboarding.tour.agent_hub_view.title"),
		text: renderTourBody(TOUR_BODIES.agent_hub_view),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "download-agent",
		// Targets the first download button using its data-testid, assuming it's within the first relevant card context
		attachTo: {
			element: 'button[data-tour-tag="agent-hub-download-button"]',
			on: "bottom",
		},
		title: tourLabel("ui.onboarding.tour.download_agent.title"),
		text: renderTourBody(TOUR_BODIES.download_agent),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-agents"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.next();
					}, 1000);
				},
			},
		],
	},
	{
		id: "upload-agent-hub",
		// Targets the "Upload to Hub" menu item, assuming the parent menu is open
		attachTo: {
			element: () => visibleTourTarget("upload-to-hub-header-button"),
			on: "bottom",
		},
		title: tourLabel("ui.onboarding.tour.upload_agent_hub.title"),
		text: renderTourBody(TOUR_BODIES.upload_agent_hub),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-agent-hub"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.back();
					}, 500);
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					pressTourAction("open-upload-dialog");
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "upload-agent-hub-dialog",
		// Targets the UploadAgentDialog modal, which should be open after clicking "Upload to Hub"
		attachTo: {
			element: '[data-tour-tag="upload-agent-dialog"]',
			on: attachSide("right"),
		},
		title: tourLabel("ui.onboarding.tour.upload_agent_hub_dialog.title"),
		/*
		 * The same correction the dialog itself carries: this step used to
		 * promise that "any conversation history and learnings for this agent
		 * will be part of its training and will be visible to the public",
		 * which stopped being true when the publish path started shipping an
		 * instruction set and nothing else. Two surfaces describing one
		 * publication cannot disagree about what leaves the machine, and the
		 * wrong one here was the more alarming of the two.
		 */
		text: renderTourBody(TOUR_BODIES.upload_agent_hub_dialog),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="upload-agent-dialog-cancel-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.back();
					}, 500);
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="upload-agent-dialog-cancel-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "navigate-schedules",
		attachTo: {
			element: '[data-tour-tag="nav-item-schedules"]',
			on: attachSide("right"),
		},
		title: tourLabel("ui.onboarding.tour.navigate_schedules.title"),
		text: renderTourBody(TOUR_BODIES.navigate_schedules),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-agents"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						pressTourAction("open-upload-dialog");
					}, 500);
					setTimeout(() => {
						this.back();
					}, 1000);
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-schedules"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "schedules-overview",
		title: tourLabel("ui.onboarding.tour.schedules_overview.title"),
		text: renderTourBody(TOUR_BODIES.schedules_overview),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "create-schedule",
		// Targets the "Create Schedule" button within the PageHeader
		attachTo: {
			element: 'button[data-tour-tag="create-schedule-button"]',
			on: "bottom",
		},
		title: tourLabel("ui.onboarding.tour.create_schedule.title"),
		text: renderTourBody(TOUR_BODIES.create_schedule),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="create-schedule-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "create-schedule-dialog",
		attachTo: {
			element: '[data-tour-tag="create-schedule-dialog"]',
			on: attachSide("right"),
		},
		title: tourLabel("ui.onboarding.tour.create_schedule_dialog.title"),
		text: renderTourBody(TOUR_BODIES.create_schedule_dialog),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					// Close dialog if open, then go back
					const closeButton = document.querySelector(
						'[data-tour-tag="create-schedule-dialog-cancel-button"]',
					);
					if (closeButton) {
						(closeButton as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.back();
					}, 500);
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					// Optionally close dialog before moving on
					const closeButton = document.querySelector(
						'[data-tour-tag="create-schedule-dialog-cancel-button"]',
					);
					if (closeButton) {
						(closeButton as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "navigate-settings",
		attachTo: {
			element: '[data-tour-tag="nav-item-settings"]',
			on: attachSide("right"),
		},
		title: tourLabel("ui.onboarding.tour.navigate_settings.title"),
		text: renderTourBody(TOUR_BODIES.navigate_settings),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-schedules"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						const button = document.querySelector(
							'button[data-tour-tag="create-schedule-button"]',
						);
						if (button) {
							(button as HTMLButtonElement).click();
						}
					}, 500);
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.back();
					}, 1000);
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-settings"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "general-settings",
		// Targets the "General Settings" item in settings sidebar via its icon
		attachTo: {
			element: 'div[data-tour-tag="settings-general-section"]',
			on: attachSide("right"),
		},
		title: tourLabel("ui.onboarding.tour.general_settings.title"),
		text: renderTourBody(TOUR_BODIES.general_settings),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "appearance-settings",
		attachTo: {
			element: '[data-tour-tag="settings-appearance-section"]',
			on: attachSide("right"),
		},
		title: tourLabel("ui.onboarding.tour.appearance_settings.title"),
		text: renderTourBody(TOUR_BODIES.appearance_settings),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "radient-account-settings",
		attachTo: {
			element: '[data-tour-tag="settings-radient-account-section"]',
			on: attachSide("right"),
		},
		title: tourLabel("ui.onboarding.tour.radient_account_settings.title"),
		text: renderTourBody(TOUR_BODIES.radient_account_settings),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "integrations-settings",
		attachTo: {
			element: '[data-tour-tag="settings-integrations-section"]',
			on: attachSide("right"),
		},
		title: tourLabel("ui.onboarding.tour.integrations_settings.title"),
		text: renderTourBody(TOUR_BODIES.integrations_settings),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "application-updates-settings",
		attachTo: {
			element: '[data-tour-tag="settings-app-updates-section"]',
			on: attachSide("right"),
		},
		title: tourLabel("ui.onboarding.tour.application_updates_settings.title"),
		text: renderTourBody(TOUR_BODIES.application_updates_settings),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: tourLabel("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "tour-complete",
		title: tourLabel("ui.onboarding.tour.tour_complete.title"),
		text: renderTourBody(TOUR_BODIES.tour_complete),
		buttons: [
			{
				text: tourLabel("ui.onboarding.tour.action.finish"),
				classes: "shepherd-button-primary",
				action: function () {
					this.complete();
				},
			},
		],
	},
];

/**
 * The close icon's accessible name, resolved in the active language.
 *
 * Shepherd sets `cancelIcon.label` with `setAttribute`, not `innerHTML`, so it
 * takes the raw `t()` value - an HTML-escaped entity would be announced
 * literally by a screen reader. The title/button sinks use `tourLabel` instead.
 */
export const tourCancelIcon = (): NonNullable<StepOptions["cancelIcon"]> => ({
	enabled: true,
	label: t("ui.onboarding.tour.action.close"),
});

const appliedLocaleByTour = new WeakMap<Tour, string>();

/**
 * Record the locale a tour's steps were just built in.
 *
 * `applyTourLocale` is idempotent per (tour, locale); without this, a tour
 * restarted after a locale round would keep the OLD entry and skip the first
 * transition back to that locale, leaving the new steps in the wrong language.
 */
export const rememberTourLocale = (tour: Tour, locale: string): void => {
	appliedLocaleByTour.set(tour, locale);
};

/**
 * Re-render an OPEN tour in the current language without restarting it.
 *
 * Locale can change while the walkthrough is open: the settings door writes the
 * backend setting, and another window can change it through the desktop feed.
 * Rebuilding the tour would lose the user's position, so this updates each
 * existing step's copy in place through Shepherd's supported
 * `Step.updateStepOptions`. The step object, its id and the step list stay
 * untouched; the footer's button elements are updated in place (their action
 * closures are rebuilt from the same definitions), so keyboard focus stays
 * where the user left it. Only the copy-bearing fields and the close label are
 * assigned; `attachTo`, `when` and the step list are not touched.
 *
 * Keyed by tour and locale because `useOnboardingTour` has two consumers (the
 * app-root initiator and Settings); neither may apply one transition twice.
 */
export const applyTourLocale = (tour: Tour, locale: string): void => {
	if (appliedLocaleByTour.get(tour) === locale) return;
	const fresh = new Map(
		createTourSteps()
			.filter((step) => step.id)
			.map((step) => [step.id as string, step]),
	);
	const cancelIcon = tourCancelIcon();
	for (const step of tour.steps) {
		const next = step.id ? fresh.get(step.id) : undefined;
		if (!next) continue;
		step.updateStepOptions({
			title: next.title,
			text: next.text,
			buttons: next.buttons,
			cancelIcon,
		});
	}
	tour.options.defaultStepOptions = {
		...tour.options.defaultStepOptions,
		cancelIcon,
	};
	appliedLocaleByTour.set(tour, locale);
};
