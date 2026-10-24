/**
 * S6b: the approvals card's preload — the only bridge between the card's
 * sandboxed document and main.
 *
 * THE SURFACE IS TWO VERBS, ON PURPOSE. `dismiss` and `decide` are the only
 * things the card can say to main; `More options` and `Review all` are local
 * view changes and never cross. There is no general `ipcRenderer`, no channel
 * name in the document's world, and no `sendSync`.
 *
 * WHAT THE DOCUMENT CANNOT DO: name an origin, a scope or a decision meaning
 * that main accepts. It echoes the `seq` of the model it painted and an
 * `entryId`; main re-pins the sender to this child's webContents and resolves
 * the entry against the live queue before `host.respondToConsent` is reached.
 *
 * Sandboxed preloads run in an isolated world with a subset of Electron's
 * modules; `contextBridge` and `ipcRenderer` are exactly the pair this needs.
 */

import { contextBridge, ipcRenderer } from "electron";
import {
	APPROVALS_CARD_DECIDE_CHANNEL,
	APPROVALS_CARD_DISMISS_CHANNEL,
	type ApprovalsCardDecidePayload,
	type ApprovalsCardDismissPayload,
} from "../shared/browser-approvals-overlay";

const api = Object.freeze({
	/** Close the card. Never answers the request it was showing. */
	dismiss(payload: ApprovalsCardDismissPayload): void {
		ipcRenderer.send(APPROVALS_CARD_DISMISS_CHANNEL, payload);
	},
	/** Answer the entry this card was rendered from. */
	decide(payload: ApprovalsCardDecidePayload): void {
		ipcRenderer.send(APPROVALS_CARD_DECIDE_CHANNEL, payload);
	},
});

contextBridge.exposeInMainWorld("approvalsCard", api);
