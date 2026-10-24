/**
 * S6a's card document script.
 *
 * It has one job: paint the count/theme/direction the controller puts in the
 * URL and expose the card's natural height so the controller can size the
 * native view. It deliberately imports no app module, opens no channel, reads
 * no storage and touches no focusable control: the only values it writes are
 * `textContent` and the root's `data-*` presentation attributes.
 *
 * S6b replaces this with a model-driven document and a purpose-built preload;
 * until then there is no IPC surface here to compromise.
 */
import { t } from "../../../i18n/messages";

interface ApprovalsCardBridge {
	setCount(count: number): void;
	naturalHeight(): number;
}

declare global {
	interface Window {
		__approvalsCard?: ApprovalsCardBridge;
	}
}

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
document.documentElement.dataset.theme =
	theme === "light" ? "localOperatorLight" : "localOperatorDark";
if (params.get("opaque") === "1") {
	document.documentElement.dataset.opaque = "1";
}

const card = document.getElementById("approvals-card");
const brandNode = document.getElementById("approvals-brand");
const titleNode = document.getElementById("approvals-title");
const countNode = document.getElementById("approvals-count");
const detailNode = document.getElementById("approvals-detail");

if (brandNode) {
	brandNode.textContent = t("ui.browser.browser_new_tab.wordmark");
}
if (titleNode) {
	titleNode.textContent = t("ui.browser.browser_approvals_dock.approvals");
}
if (detailNode) {
	detailNode.textContent = t(
		"ui.browser.browser_approvals_dock.waiting_requests",
	);
}

function renderCount(count: number): void {
	if (!countNode) return;
	const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
	countNode.textContent = t(
		"ui.browser.browser_approvals_tray.header_waiting",
		{
			count: safe,
		},
	);
}

/*
 * The query parameter is the first-paint fallback for a direct load; the live
 * count arrives through `setCount`. The controller omits it at zero, so a
 * hidden card never paints "0 approvals waiting".
 */
const initial = params.get("count");
if (initial !== null) renderCount(Number(initial));

window.__approvalsCard = {
	setCount: renderCount,
	naturalHeight: () => {
		if (!card) return 0;
		/*
		 * The card's max-height is its own viewport minus the insets, so the
		 * clamped rect is not the natural height: read it with the clamp lifted.
		 * The controller measures the same way and owns the real ceiling.
		 */
		const previous = card.style.maxHeight;
		card.style.maxHeight = "none";
		const height = card.getBoundingClientRect().height;
		card.style.maxHeight = previous;
		return Math.ceil(height);
	},
};
