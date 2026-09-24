import {
	clearConsentAttention,
	isConsentAttentionLive,
	shouldForgetConsentAttention,
	useConsentAttention,
} from "@shared/browser-consent-attention";
import { showInfoToast } from "@shared/utils/toast-manager";
import { useEffect, useRef } from "react";
import { readApprovalClock } from "../model/approval-queue-model";
import {
	readBrowserProjection,
	refreshBrowserProjection,
} from "../model/browser-projection-store";
import { useBrowserProjection } from "./use-browser-chrome";

/**
 * What a banner click's memory does, decided ONCE for the whole app: how long it lasts,
 * and what the operator is told when it names something that is already gone.
 *
 * WHY THE SHELL AND NOT THE SURFACES (UX review round 1, U1). Each surface used to
 * clear the attention when the named entry was not in the list it was showing, and a
 * surface can only see its own scope: the browser PANE shows one conversation, so a
 * click naming a request that belongs to NO conversation (a subagent's own session id,
 * `call:…` — the case the rail's own count exists for) was "not here" from the pane's
 * point of view, and the pane cleared the memory while the router was still on its way
 * to the `/browser` route — the surface that can show it. The click then landed on the
 * oldest row instead of the one the banner named, reproduced twice (S3b vs S4: the same
 * payload with and without a pane mounted).
 *
 * The shell is mounted on every route and is what performs the navigation, so its read
 * is the whole projection and it is the only caller of the clear. A surface therefore
 * never decides whether the memory is stale — it only READS it, to select the request
 * it names.
 *
 * TWO MOMENTS, ONE RULE. A click is judged against a read main is asked for once per
 * click, and the memory is forgotten when the whole queue no longer holds the request —
 * the same predicate, asked once per click and then once per projection.
 */
export function useConsentAttentionLifetime(): void {
	const attention = useConsentAttention();
	const projection = useBrowserProjection();
	// `pendingConsent` is present on every state main publishes and absent only while
	// no read has landed, which is the distinction the predicates are written around.
	const pending = projection.state?.pendingConsent;
	const forget = shouldForgetConsentAttention(attention, pending);
	/**
	 * The click whose report is OWED, held independently of the memory.
	 *
	 * THIS IS THE ROUND-2 FIX (QA Q-2, UX U9), and the bug was a guard that outlived its
	 * subject: the report used to be suppressed whenever `attention` had changed by the
	 * time the read came back — and the shell's own forget effect clears the memory as
	 * soon as the freshness read says the request is gone, which is EXACTLY the case the
	 * report exists for. The click was therefore silent in both states it was filed for:
	 * a request answered between the banner and the click, and a request that expired
	 * while main still lists it. Holding the id here means the memory can be dropped —
	 * as it should be — without dropping the obligation to say what happened.
	 */
	const clickOwed = useRef<string | null>(null);

	/*
	 * A CLICK IS JUDGED AGAINST A CURRENT ANSWER, and a request that is no longer LIVE
	 * when the click lands is REPORTED rather than silently skipped (U6, U9).
	 *
	 * The click's own promise is "take me to the request I just told you about", and main
	 * is the only place that knows whether it is still live: the projection the renderer
	 * holds can be up to one change old, and a request that ran out its ten minutes is
	 * still IN `pendingConsent` (nothing in main fires at expiry), so "listed" is not
	 * "live" — hence `isConsentAttentionLive` rather than a membership test. Asking for
	 * one fresh read per click, and saying so when the answer is "gone", keeps the landing
	 * honest in the one case the surface cannot explain itself: the tray shows what is
	 * live, and this says why nothing is.
	 *
	 * IT CANNOT CRY WOLF. The report is judged once per click, against the FIRST read
	 * after it, and only when a read has LANDED (`undefined` means "not read yet" and
	 * returns). A request the operator answers themselves is answered by a press in the
	 * tray, which cannot land inside the few milliseconds between a click and its own
	 * read; a request answered a moment later clears the memory in silence, on the effect
	 * below.
	 */
	useEffect(() => {
		if (attention === null || clickOwed.current === attention) return;
		clickOwed.current = attention;
		void refreshBrowserProjection().then(() => {
			const owed = clickOwed.current;
			if (owed === null) return;
			clickOwed.current = null;
			const landed = readBrowserProjection().state?.pendingConsent;
			if (landed === undefined) return;
			if (isConsentAttentionLive(owed, landed, readApprovalClock())) return;
			showInfoToast("That request is no longer waiting.");
		});
	}, [attention]);

	useEffect(() => {
		if (attention === null || !forget) return;
		clearConsentAttention(attention);
	}, [attention, forget]);
}
