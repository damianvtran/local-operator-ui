import {
	clearConsentAttention,
	isConsentAttentionPending,
	shouldForgetConsentAttention,
	useConsentAttention,
} from "@shared/browser-consent-attention";
import { showInfoToast } from "@shared/utils/toast-manager";
import { useEffect, useRef } from "react";
import {
	readBrowserProjection,
	refreshBrowserProjection,
} from "../model/browser-projection-store";
import { useBrowserProjection } from "./use-browser-chrome";

/**
 * How long the memory of a banner click lasts, decided ONCE for the whole app.
 *
 * WHY THE SHELL AND NOT THE SURFACES (UX review round 1, U1). Each surface used to
 * clear the attention when the named entry was not in the list it was showing, and a
 * surface can only see its own scope: the browser PANE shows one conversation, so a
 * click naming a request that belongs to NO conversation (a subagent's own session
 * id, `call:…` — the case the rail's own count exists for) was "not here" from the
 * pane's point of view, and the pane cleared the memory while the router was still
 * on its way to the `/browser` route — the surface that can show it. The click then
 * landed on the oldest row instead of the one the banner named, reproduced twice
 * (S3b vs S4: the same payload with and without a pane mounted).
 *
 * The shell is mounted on every route and is what performs the navigation, so its
 * read is the whole projection and it is the only caller of the clear. A surface
 * therefore never decides whether the memory is stale — it only READS it, to select
 * the request it names.
 *
 * TWO MOMENTS, ONE RULE. `useConsentAttentionLifetime` asks main the queue's current
 * state as soon as a click names something, and forgets the memory when the request
 * is gone — which is the same rule, asked once per click and then once per
 * projection, rather than a second policy.
 */
export function useConsentAttentionLifetime(): void {
	const attention = useConsentAttention();
	const projection = useBrowserProjection();
	// `pendingConsent` is present on every state main publishes and absent only while
	// no read has landed, which is the distinction the predicates are written around.
	const pending = projection.state?.pendingConsent;
	const forget = shouldForgetConsentAttention(attention, pending);
	/** The attention main has already been asked about, so the read below runs once
	 * per click rather than once per render. */
	const asked = useRef<string | null>(null);

	/*
	 * A CLICK IS JUDGED AGAINST A CURRENT ANSWER, and a request that was answered
	 * between the banner and the click is REPORTED rather than silently skipped (UX
	 * review round 1, U6).
	 *
	 * The click's own promise is "take me to the request I just told you about", and
	 * main is the only place that knows whether it is still there: the projection the
	 * renderer holds can be up to one change old, so a click that lands on a request
	 * answered a moment ago would open the surface with nothing in it and say nothing
	 * about why. Asking for one fresh read per click, and saying so when the answer is
	 * "gone", keeps the landing honest in the one case the surface cannot explain
	 * itself: the tray shows what is live, and this says why nothing is.
	 *
	 * IT CANNOT CRY WOLF. The check runs only after a read has LANDED (`undefined`
	 * means "not read yet" and returns), and only inside the window between a click
	 * and its first settled answer, so a request the user answers themselves a moment
	 * later clears the memory in silence, on the effect below.
	 */
	useEffect(() => {
		if (attention === null) {
			asked.current = null;
			return;
		}
		if (asked.current === attention) return;
		asked.current = attention;
		void refreshBrowserProjection().then(() => {
			if (asked.current !== attention) return;
			const landed = readBrowserProjection().state?.pendingConsent;
			if (landed === undefined) return;
			if (isConsentAttentionPending(attention, landed)) return;
			showInfoToast("That request is no longer waiting.");
		});
	}, [attention]);

	useEffect(() => {
		if (attention === null || !forget) return;
		clearConsentAttention(attention);
	}, [attention, forget]);
}
