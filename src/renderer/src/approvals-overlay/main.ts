/**
 * S6b's approvals card document script.
 *
 * IT PAINTS A MODEL AND SENDS TWO VERBS. The model arrives from main through
 * `window.__approvalsCard.setModel` — the seam S6a proved for the count — and
 * the only things this document can say back are `dismiss` and `decide`, both
 * exposed by the purpose-built preload. The scoped decisions and the queue list
 * are local view changes: they never cross the boundary, so the card's two
 * channels remain exactly two.
 *
 * TRUST RULES THIS FILE KEEPS:
 * - every string is written with `textContent`; no `innerHTML`, no URL content;
 * - the `seq` of the model it painted is echoed on every action, so main can
 *   drop a click on a card that has moved on;
 * - `Escape` and Close dismiss and never decide; a decision is only ever the
 *   result of a named decision button.
 *
 * The locale, language tag and direction are passed in the model because this
 * is a SECOND document: it must follow the app's resolved locale, not re-read
 * the device (UX U2 — `fr-FR`/`ur-PK` fell back to English/LTR here).
 */
import { setLocale } from "../../../i18n/locale";
import { t } from "../../../i18n/messages";
import type {
	ApprovalsCardDecision,
	ApprovalsCardModel,
	ApprovalsCardRequest,
} from "../../../shared/browser-approvals-overlay";

/** The two verbs the preload exposes. Nothing else exists in this world. */
interface ApprovalsCardApi {
	dismiss(payload: { seq: number; entryId: string }): void;
	decide(payload: {
		seq: number;
		entryId: string;
		decision: ApprovalsCardDecision;
	}): void;
}

interface ApprovalsCardBridge {
	setModel(model: ApprovalsCardModel): void;
}

declare global {
	interface Window {
		approvalsCard?: ApprovalsCardApi;
		__approvalsCard?: ApprovalsCardBridge;
	}
}

const params = new URLSearchParams(window.location.search);
// The URL values are the first paint only; the model owns both once it lands.
if (params.get("theme") === "light") {
	document.documentElement.dataset.theme = "localOperatorLight";
}
if (params.get("opaque") === "1") {
	document.documentElement.dataset.opaque = "1";
}

const card = document.getElementById("approvals-card");
const brandNode = document.getElementById("approvals-brand");
const titleNode = document.getElementById("approvals-title");
const closeNode = document.getElementById(
	"approvals-close",
) as HTMLButtonElement | null;
const requestView = document.getElementById("approvals-request");
const listView = document.getElementById("approvals-list");
const requesterNode = document.getElementById("approvals-requester");
const leadNode = document.getElementById("approvals-lead");
const originNode = document.getElementById("approvals-origin");
const expiryNode = document.getElementById("approvals-expiry");
const allowOnceNode = document.getElementById(
	"approvals-allow-once",
) as HTMLButtonElement | null;
const glossNode = document.getElementById("approvals-gloss");
const secondaryNode = document.getElementById("approvals-secondary");
const reviewNode = document.getElementById(
	"approvals-review",
) as HTMLButtonElement | null;
const rowsNode = document.getElementById("approvals-rows");
const backNode = document.getElementById(
	"approvals-back",
) as HTMLButtonElement | null;
const errorNode = document.getElementById("approvals-error");
const cardBody = document.querySelector(".card-body");

let model: ApprovalsCardModel | null = null;
let localView: "request" | "list" = "request";
let lastEntryId: string | null = null;
/**
 * THE DECISIONS ARE INERT UNTIL THIS INSTANT (U3). When the request on screen
 * changes UNDER the user (withdrawn, expired, dismissed: the controller's pick
 * moved, not the user's own list selection), the card repaints the next request
 * in place in a few milliseconds with every button live. A click aimed at the
 * request the user had read then granted a durable scope for a site they never
 * saw (measured: a 724 ms click recorded the queued site). The sequence number
 * does not help, because the model carrying the new request is pushed BEFORE the
 * click, so the click carries the new `seq`. The only defence that adds no
 * channel and widens no host validation is not to let a decision leave the
 * document for a short bounded window after the swap: long enough for a pointer
 * already travelling to land on nothing, short enough not to feel broken to
 * someone who reads the new site first.
 */
let inertUntil = 0;
const INERT_MS = 700;
/** Characters of the requester label the headline shows (D-2). */
const REQUESTER_MAX = 48;
/** Whether the previous render painted a request (a hidden card is not a swap). */
let lastShown = false;
let inertTimer: ReturnType<typeof setTimeout> | null = null;
const isInert = (): boolean => Date.now() < inertUntil;
/** A row the operator picked in the queue list; overrides the controller's pick. */
let selectedEntryId: string | null = null;

function shownRequest(): ApprovalsCardRequest | null {
	if (!model) return null;
	return (
		model.pending.find((entry) => entry.entryId === selectedEntryId) ??
		model.request
	);
}

function minutesLeft(expiresAt: number): number | null {
	if (!Number.isFinite(expiresAt) || expiresAt <= 0) return null;
	return Math.ceil((expiresAt - Date.now()) / 60_000);
}

function expiringText(expiresAt: number): string {
	const minutes = minutesLeft(expiresAt);
	if (minutes === null) return "";
	if (minutes <= 0) {
		return t(
			"ui.browser.browser_approvals_dock.expired_the_agent_has_to_ask_again",
		);
	}
	if (minutes < 1) {
		return t("ui.browser.approval_queue_model.expires_in_under_a_minute");
	}
	return t("ui.browser.approval_queue_model.expires_minutes", {
		count: minutes,
	});
}

/** Each decision button's own gloss sentence, so the tallest can be reserved. */
const glossFor = new WeakMap<HTMLButtonElement, string>();

function setGloss(text: string): void {
	if (glossNode) glossNode.textContent = text;
}

function action(
	label: string,
	onClick: () => void,
	gloss: string,
): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.textContent = label;
	glossFor.set(button, gloss);
	button.addEventListener("click", onClick);
	button.addEventListener("mouseenter", () => setGloss(gloss));
	button.addEventListener("focus", () => setGloss(gloss));
	return button;
}

/**
 * RESERVE THE TALLEST GLOSS (Q1). The one gloss line follows hover and focus, and
 * the "Don't allow" sentence wraps to two lines where the others take one. Nothing
 * re-measures on a hover, so the card grew inside a native view that stayed put:
 * the footer covered the lowest decision (measured: overdraw 9) and every button
 * slid 15 px under the pointer, so a click landed in the gap. The line is sized
 * to the tallest sentence it can show, at the width it will show them (locale and
 * card width both change the wrap), so hovering moves nothing and the host's
 * measurement already contains the worst case.
 */
let glossTexts: string[] = [];
function reserveGloss(): void {
	if (!glossNode) return;
	glossNode.style.minHeight = "";
	// A hidden view or the provisional zero-width child reports a height that is
	// not the card's: reserve nothing there; the next render, view switch or
	// resize does it at the real width.
	if (glossNode.getBoundingClientRect().width <= 0) return;
	const current = glossNode.textContent;
	let tallest = 0;
	for (const text of glossTexts) {
		glossNode.textContent = text;
		tallest = Math.max(tallest, glossNode.getBoundingClientRect().height);
	}
	glossNode.textContent = current;
	if (tallest > 0) glossNode.style.minHeight = `${Math.ceil(tallest)}px`;
}

function dismiss(): void {
	if (!model) return;
	const shown = shownRequest();
	/*
	 * A dismissal ends the local selection, and it must do so BEFORE the model
	 * advances: a presentation-dismissed entry can stay in the live queue, so
	 * `selectedEntryId` would keep passing the `pending` check and `shownRequest`
	 * would paint the request the operator just dismissed (Q-S6b-1). Clearing
	 * it here makes the next model push paint the controller's request; the
	 * request-change reset in `render` covers a dismissal that moves the pick.
	 */
	selectedEntryId = null;
	window.approvalsCard?.dismiss({
		seq: model.seq,
		entryId: shown?.entryId ?? "",
	});
}

function sendDecision(decision: ApprovalsCardDecision): void {
	if (!model) return;
	const request = shownRequest();
	if (!request) return;
	if (isInert()) return;
	window.approvalsCard?.decide({
		seq: model.seq,
		entryId: request.entryId,
		decision,
	});
}

/**
 * The four scoped decisions, using the band's existing copy verbatim.
 *
 * THE DOMAIN OPTION EXISTS ONLY WHEN THE QUEUE CARRIES A BROAD GRANT. Rendering
 * "allow all of every site under <origin>" from concatenated fragments was
 * ungrammatical in both shipped languages (D3/Q-1); the label is the audited
 * `allow_all_of` + the grant's own registrable-domain key, the same composition
 * the consent card uses.
 */
function renderSecondary(request: ApprovalsCardRequest): void {
	if (!secondaryNode) return;
	secondaryNode.replaceChildren();
	const buttons: HTMLButtonElement[] = [
		action(
			t("ui.browser.browser_consent_request.allow_until_the_app_quits"),
			() => sendDecision("session"),
			t("ui.browser.browser_consent_request.this_site_for_this_run_only_and"),
		),
		action(
			t("ui.browser.browser_consent_request.always_allow_this_site"),
			() => sendDecision("site"),
			t(
				"ui.browser.browser_consent_request.kept_until_you_revoke_it_and_shared",
			),
		),
	];
	if (request.broadKey) {
		buttons.push(
			action(
				`${t("ui.browser.browser_consent_request.allow_all_of")}${request.broadKey}`,
				() => sendDecision("domain"),
				`${t("ui.browser.browser_consent_request.every_site_under")}${request.broadKey}${t("ui.browser.browser_consent_request.kept_until_you_revoke_it_shared_with")}`,
			),
		);
	}
	buttons.push(
		action(
			t("ui.browser.browser_consent_request.don_t_allow"),
			() => sendDecision("deny"),
			t(
				"ui.browser.browser_consent_request.the_agent_stops_asking_about_this_site",
			),
		),
	);
	secondaryNode.append(...buttons);
}

function renderRows(pending: ReadonlyArray<ApprovalsCardRequest>): void {
	if (!rowsNode) return;
	rowsNode.replaceChildren();
	for (const entry of pending) {
		const item = document.createElement("div");
		item.setAttribute("role", "listitem");
		const row = document.createElement("button");
		row.type = "button";
		row.className = "card-row";
		const origin = document.createElement("span");
		origin.className = "card-row-origin";
		origin.textContent = entry.origin;
		const meta = document.createElement("span");
		meta.className = "card-row-meta";
		// The requester is the difference between two requests for one site; the
		// list must carry it, not just the origin and the expiry (U4).
		meta.textContent = [entry.requester, expiringText(entry.expiresAt)]
			.filter(Boolean)
			.join(" · ");
		row.append(origin, meta);
		row.addEventListener("click", () => {
			selectedEntryId = entry.entryId;
			setView("request");
			render();
		});
		item.append(row);
		rowsNode.append(item);
	}
}

/**
 * THE SCRIM MARKS A SCROLL BOUNDARY, SO IT EXISTS ONLY AT ONE. An always-on
 * shadow painted a grey band over the empty ground of a short list (D13); the
 * class follows the body's actual overflow.
 */
function syncScrim(): void {
	if (!cardBody) return;
	cardBody.classList.toggle(
		"is-scrollable",
		cardBody.scrollHeight > cardBody.clientHeight + 1,
	);
}

function setView(view: "request" | "list"): void {
	/*
	 * KEEP THE CARD'S HEIGHT STABLE ACROSS THE LOCAL VIEWS (D11). The native view
	 * follows the card's measured height, and only a model push re-measures; a
	 * shorter list would otherwise shrink the card inside a view that stays tall,
	 * leaving the ring in the wrong place. The list inherits the request view's
	 * height instead.
	 */
	if (card) {
		if (view === "list" && localView !== "list") {
			card.style.minHeight = `${Math.ceil(card.getBoundingClientRect().height)}px`;
		} else if (view === "request") {
			card.style.minHeight = "";
		}
	}
	localView = view;
	if (requestView) requestView.hidden = view !== "request";
	if (listView) listView.hidden = view !== "list";
	if (reviewNode) reviewNode.hidden = view !== "request";
	if (backNode) backNode.hidden = view !== "list";
	if (view === "request") reserveGloss();
	setTimeout(syncScrim, 0);
}

function render(): void {
	if (!model) return;
	/* A CONTROLLER PICK REPLACES THE LOCAL SELECTION. `selectedEntryId` is only
	 * an explicit row choice; the current request is `model.request`. The two
	 * used to be the same field, so after a dismissal advanced the controller
	 * the document kept the dismissed entry selected (it stays in the live
	 * queue) and painted it again (Q-S6b-1). Reset on every controller pick, and
	 * clear on an empty pick, so the painted request always follows main. */
	if (model.request && model.request.entryId !== lastEntryId) {
		// Inert only when the pick moved under a card that was already showing a
		// request. The first request after a hide is not a swap, and the user's own
		// list selection (`selectedEntryId`) never goes through here.
		if (lastEntryId !== null && lastShown) {
			inertUntil = Date.now() + INERT_MS;
			if (inertTimer) clearTimeout(inertTimer);
			inertTimer = setTimeout(() => {
				inertTimer = null;
				render();
			}, INERT_MS + 20);
		}
		lastEntryId = model.request.entryId;
		selectedEntryId = null;
		// A new request always opens on the request view, never on the list a
		// previous request left behind.
		setView("request");
	}
	if (!model.request) selectedEntryId = null;
	const request = shownRequest();
	if (request) {
		if (requesterNode) {
			const label =
				request.requester || t("ui.browser.browser_consent_request.an_agent");
			// BOUND THE HEADLINE (D-2). The requester is a conversation title: arbitrary
			// text the model caps at 256 characters. Unbounded, it wraps to many lines
			// at the narrowest width and pushes the decisions past the 480 DIP height
			// cap, where the sticky footer covers the lowest one (measured overdraw 2.1
			// at 264, 98 characters). The question is "which site", not "which title",
			// so the headline is clipped and the full label stays reachable as a tooltip.
			const clipped = [...label];
			requesterNode.textContent =
				clipped.length > REQUESTER_MAX
					? `${clipped.slice(0, REQUESTER_MAX - 1).join("")}\u2026`
					: label;
			requesterNode.title = clipped.length > REQUESTER_MAX ? label : "";
		}
		if (leadNode) {
			leadNode.textContent = t(
				"ui.browser.browser_consent_request.wants_to_open",
			);
		}
		if (originNode) originNode.textContent = request.origin;
		if (expiryNode) expiryNode.textContent = expiringText(request.expiresAt);
		if (allowOnceNode) {
			allowOnceNode.textContent = t(
				"ui.browser.browser_consent_request.allow_once",
			);
			// The primary ignores the expiry no more than the scoped decisions do
			// (round-2 minor): an expired request cannot be answered from a stale
			// card.
			allowOnceNode.disabled =
				model.busy || isInert() || (minutesLeft(request.expiresAt) ?? 1) <= 0;
			allowOnceNode.onclick = () => sendDecision("once");
			setGloss(
				t(
					"ui.browser.browser_consent_request.one_navigation_for_that_conversation_up_to",
				),
			);
		}
		renderSecondary(request);
		glossTexts = [
			t(
				"ui.browser.browser_consent_request.one_navigation_for_that_conversation_up_to",
			),
			...[...(secondaryNode?.querySelectorAll("button") ?? [])].map(
				(button) => glossFor.get(button) ?? "",
			),
		];
	}
	lastShown = request !== null;
	if (reviewNode) {
		// The count says what the list holds (D9), and the accessible name says
		// what pressing it does, so the visible status text is still a known
		// action for a screen reader and for the U9 "reads as status" nit.
		reviewNode.textContent = t(
			"ui.browser.browser_approvals_tray.header_waiting",
			{ count: model.count },
		);
		reviewNode.setAttribute(
			"aria-label",
			t("ui.browser.browser_approvals_tray.open_approvals"),
		);
		reviewNode.disabled = model.busy;
		reviewNode.onclick = () => {
			setView("list");
			// The pressed button is hidden by the view switch; without this the
			// document's focus fell to <body> and the next Tab started over (U11).
			backNode?.focus();
		};
	}
	if (backNode) {
		backNode.textContent = t("ui.browser.browser_url_bar.back");
		backNode.onclick = () => {
			setView("request");
			reviewNode?.focus();
		};
	}
	renderRows(model.pending);
	setView(localView);
	const disabled =
		model.busy ||
		isInert() ||
		(request ? (minutesLeft(request.expiresAt) ?? 1) <= 0 : true);
	for (const button of secondaryNode?.querySelectorAll("button") ?? []) {
		button.disabled = disabled;
	}
	card?.setAttribute("aria-busy", model.busy ? "true" : "false");
	if (errorNode) {
		errorNode.hidden = model.error === null;
		errorNode.textContent =
			model.error === "stale"
				? t(
						"ui.browser.browser_approvals_dock.expired_the_agent_has_to_ask_again",
					)
				: model.error === "unavailable"
					? t("ui.browser.browser_surface.browser_unavailable")
					: "";
	}
	if (model.focus) card?.focus();
	// After the view switch and the model paint; a timer, not rAF, because the
	// card's window is hidden and runs no animation frames.
	setTimeout(syncScrim, 0);
}

window.__approvalsCard = {
	setModel(next: ApprovalsCardModel): void {
		model = next;
		// A selected row that left the queue must not keep the request view on a
		// stale entry; fall back to the controller's current request.
		if (
			selectedEntryId &&
			!next.pending.some((entry) => entry.entryId === selectedEntryId)
		) {
			selectedEntryId = null;
		}
		// The document's language metadata follows the APP's resolved locale, not
		// the device tag (UX U2); `setLocale` makes `t()` format plurals with the
		// same catalogue the metadata names.
		setLocale(next.locale);
		document.documentElement.lang = next.locale;
		document.documentElement.dir = next.dir;
		document.documentElement.dataset.theme =
			next.palette ??
			(next.theme === "light" ? "localOperatorLight" : "localOperatorDark");
		if (brandNode) {
			brandNode.textContent = t("ui.browser.browser_new_tab.wordmark");
		}
		if (titleNode) {
			titleNode.textContent = t("ui.browser.browser_approvals_dock.approvals");
		}
		if (closeNode) {
			const label = t("ui.common.actions.close");
			closeNode.textContent = label;
			closeNode.setAttribute("aria-label", label);
			closeNode.onclick = dismiss;
		}
		render();
	},
};

// Escape dismisses without deciding. The handler lives in this document on
// purpose: main swallows no input for the card (unlike S2's passive list), so
// Escape is one keypress and returns the keyboard in the same gesture.
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") {
		event.preventDefault();
		dismiss();
	}
});

// The expiry line is the one value that changes without a model push. A local
// tick repaints it; it crosses no boundary and decides nothing.
window.addEventListener("resize", () => {
	syncScrim();
	reserveGloss();
});

setInterval(() => {
	const request = shownRequest();
	if (!request || !expiryNode) return;
	expiryNode.textContent = expiringText(request.expiresAt);
}, 30_000);
