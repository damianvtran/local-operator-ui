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
document.documentElement.dataset.theme = theme;
if (params.get("dir") === "rtl") document.documentElement.dir = "rtl";
if (params.get("opaque") === "1") {
	document.documentElement.dataset.opaque = "1";
}

const card = document.getElementById("approvals-card");
const countNode = document.getElementById("approvals-count");

function renderCount(count: number): void {
	if (!countNode) return;
	const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
	countNode.textContent =
		safe === 1 ? "1 approval waiting" : `${safe} approvals waiting`;
}

const initial = Number(params.get("count") ?? "0");
renderCount(initial);

window.__approvalsCard = {
	setCount: renderCount,
	naturalHeight: () => {
		if (!card) return 0;
		const rect = card.getBoundingClientRect();
		return Math.ceil(rect.height);
	},
};

export {};
