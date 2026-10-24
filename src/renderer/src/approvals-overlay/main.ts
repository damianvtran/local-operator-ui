/**
 * S6b's approvals card document script.
 *
 * IT PAINTS A MODEL AND SENDS TWO VERBS. The model arrives from main through
 * `window.__approvalsCard.setModel` — the seam S6a proved for the count — and
 * the only things this document can say back are `dismiss` and `decide`, both
 * exposed by the purpose-built preload. `More options` and `Review all` are
 * local view changes: they never cross the boundary, so two of the card's four
 * verbs have no wire representation at all.
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
const secondaryNode = document.getElementById("approvals-secondary");
const reviewNode = document.getElementById(
	"approvals-review",
) as HTMLButtonElement | null;
const rowsNode = document.getElementById("approvals-rows");
const backNode = document.getElementById(
	"approvals-back",
) as HTMLButtonElement | null;
const errorNode = document.getElementById("approvals-error");

let model: ApprovalsCardModel | null = null;
let localView: "request" | "list" = "request";
let lastEntryId: string | null = null;

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

function action(label: string, onClick: () => void): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "card-action";
	button.textContent = label;
	button.addEventListener("click", onClick);
	return button;
}

function decisionButton(
	decision: ApprovalsCardDecision,
	label: string,
	gloss: string,
): HTMLElement {
	const button = action(label, () => sendDecision(decision));
	const description = document.createElement("p");
	description.className = "card-gloss";
	description.textContent = gloss;
	const wrapper = document.createElement("div");
	wrapper.className = "card-decision";
	wrapper.append(button, description);
	return wrapper;
}

function sendDecision(decision: ApprovalsCardDecision): void {
	if (!model?.request || model.busy) return;
	if ((minutesLeft(model.request.expiresAt) ?? 1) <= 0) return;
	window.approvalsCard?.decide({
		seq: model.seq,
		entryId: model.request.entryId,
		decision,
	});
}

function dismiss(): void {
	if (!model) return;
	window.approvalsCard?.dismiss({
		seq: model.seq,
		entryId: model.request?.entryId ?? "",
	});
}

function renderSecondary(request: ApprovalsCardRequest): void {
	if (!secondaryNode) return;
	secondaryNode.replaceChildren();
	const origin = request.origin;
	secondaryNode.append(
		decisionButton(
			"session",
			t("ui.browser.browser_consent_request.allow_until_the_app_quits"),
			t("ui.browser.browser_consent_request.this_site_for_this_run_only_and"),
		),
		decisionButton(
			"site",
			t("ui.browser.browser_consent_request.always_allow_this_site"),
			t(
				"ui.browser.browser_consent_request.kept_until_you_revoke_it_and_shared",
			),
		),
		decisionButton(
			"domain",
			`${t("ui.browser.browser_consent_request.allow_all_of")}${t(
				"ui.browser.browser_consent_request.every_site_under",
			)}${origin}`,
			// The standalone gloss form: the `_shared_with` variant begins with a
			// comma because the consent card concatenates it after the origin.
			t(
				"ui.browser.browser_consent_request.kept_until_you_revoke_it_and_shared",
			),
		),
		decisionButton(
			"deny",
			t("ui.browser.browser_consent_request.don_t_allow"),
			t(
				"ui.browser.browser_consent_request.the_agent_stops_asking_about_this_site",
			),
		),
	);
}

function renderRows(pending: ReadonlyArray<ApprovalsCardRequest>): void {
	if (!rowsNode) return;
	rowsNode.replaceChildren();
	for (const entry of pending) {
		const row = document.createElement("li");
		row.className = "card-row";
		const origin = document.createElement("span");
		origin.className = "card-row-origin";
		origin.textContent = entry.origin;
		const meta = document.createElement("span");
		meta.className = "card-row-meta";
		meta.textContent = [entry.requester, expiringText(entry.expiresAt)]
			.filter(Boolean)
			.join(" · ");
		row.append(origin, meta);
		rowsNode.append(row);
	}
}

function setView(view: "request" | "list"): void {
	localView = view;
	if (requestView) requestView.hidden = view !== "request";
	if (listView) listView.hidden = view !== "list";
	if (reviewNode) reviewNode.hidden = view !== "request";
	if (backNode) backNode.hidden = view !== "list";
}

function render(): void {
	if (!model) return;
	const request = model.request;
	if (request && request.entryId !== lastEntryId) {
		lastEntryId = request.entryId;
		// A new request always opens on the request view, never on the list a
		// previous request left behind.
		setView("request");
	}
	if (request) {
		if (requesterNode) {
			requesterNode.textContent =
				request.requester || t("ui.browser.browser_consent_request.an_agent");
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
			allowOnceNode.disabled = model.busy;
			allowOnceNode.onclick = () => sendDecision("once");
		}
		renderSecondary(request);
	}
	if (reviewNode) {
		reviewNode.textContent = t(
			"ui.browser.browser_approvals_tray.open_approvals",
		);
		reviewNode.disabled = model.busy;
		reviewNode.onclick = () => setView("list");
	}
	if (backNode) {
		backNode.textContent = t("ui.browser.browser_url_bar.back");
		backNode.onclick = () => setView("request");
	}
	renderRows(model.pending);
	setView(localView);
	const disabled =
		model.busy || (request ? (minutesLeft(request.expiresAt) ?? 1) <= 0 : true);
	for (const button of secondaryNode?.querySelectorAll("button") ?? []) {
		(button as HTMLButtonElement).disabled = disabled;
	}
	card?.setAttribute("aria-busy", model.busy ? "true" : "false");
	if (errorNode) {
		errorNode.hidden = model.error === null;
		errorNode.textContent =
			model.error === null
				? ""
				: t("ui.browser.browser_surface.browser_unavailable");
	}
	if (model.focus) card?.focus();
}

window.__approvalsCard = {
	setModel(next: ApprovalsCardModel): void {
		model = next;
		// The document's language metadata follows the APP's resolved locale, not
		// the device tag (UX U2); `setLocale` makes `t()` format plurals with the
		// same catalogue the metadata names.
		setLocale(next.locale);
		document.documentElement.lang = next.locale;
		document.documentElement.dir = next.dir;
		document.documentElement.dataset.theme =
			next.theme === "light" ? "localOperatorLight" : "localOperatorDark";
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
setInterval(() => {
	if (!model?.request || !expiryNode) return;
	expiryNode.textContent = expiringText(model.request.expiresAt);
}, 30_000);
