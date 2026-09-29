/**
 * Backend compatibility banner.
 *
 * `GET /v1/capabilities` decides which new surfaces the app may offer. When
 * the backend answers without the desktop contract (an older build), or when
 * this app did not start the backend and therefore holds no bearer, every
 * protected surface would otherwise be a wall of 401s or a quiet feature
 * loss. This banner says so once, at the top.
 *
 * FOUR different situations reach it, and they need different sentences and
 * different actions. It used to assert "this backend is older than the app
 * expects" for all of them and offer "Update backend", which cannot fix three:
 * a backend that is not running, one this app cannot authenticate to, and a
 * network path that is down. Per branding section 8 each state now says what
 * happened, what it means, and what to do -- and only the genuinely-old state
 * offers the update.
 *
 * There is no unauthenticated fallback behind this banner; the surfaces it
 * describes stay gated on `desktopFeatureEnabled` individually.
 *
 * ONE BAND GRAMMAR, SHARED WITH THE PANE'S STATUS STRIP (design note § 3). This
 * surface draws `Alert` wearing `NOTICE_BAND` inside the same `shrink-0 px-6
 * py-1` gutter the strip uses, so one incident's two bands read as one family
 * rather than two systems - the operator's report is exactly that stack - and
 * severity is then carried by hue, glyph and copy ONLY, never by a different
 * shape. The banner's severity follows the CAUSE (`credential-refused` is
 * `danger`: one fact may not carry two severities depending on which surface
 * shows it; everything else here is a transition, a feature limit or an
 * environment fact, which is `warning`), and it has NO dismiss - it is a setup
 * state present from first paint, and the collapse-to-pill contract is the
 * strip's alone (§ 3, A9).
 */

import { useChatStatusStripPresent } from "@features/chat/chat-status-presence";
import {
	type BackendErrorKind,
	REQUIRED_BACKEND_FEATURES,
	backendCompatibilityMessage,
	backendErrorKind,
	backendUpdateIsRemedy,
	compatibilityBannerShown,
} from "@shared/api/local-operator/backend-error";
import {
	desktopKeys,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { NOTICE_BAND } from "@shared/components/common/notice-band";
import { Alert, Button } from "@shared/components/ui";
import { useServerHealth } from "@shared/hooks/use-connectivity-status";
import {
	serverUpdateFailureReason,
	updateMessageOf,
} from "@shared/utils/update-error-copy";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { DaemonPairingCause } from "../../../../../shared/backend-status";

const REQUIRED_FEATURES = REQUIRED_BACKEND_FEATURES;

/**
 * What the banner says when the updater refused and said nothing else.
 *
 * Every failing branch of `update-backend` writes its own sentence to
 * `backend-update-error` first, and this banner now reads it, so this is the
 * backstop for an answer that arrived without one. It names the next step because
 * that is what the banner is for: the buttons beside it re-probe, and the failure
 * is recorded in the app's own update log (design D4, review R1-5).
 *
 * EXPORTED so the story that photographs the update-failed suffix renders the
 * SAME string the container sets, rather than a second copy of it drifting in a
 * story file (`backend-compatibility-banner.stories.tsx`, `UpdateFailed`).
 */
export const BACKEND_UPDATE_UNEXPLAINED =
	"The backend update could not start. Retry, or update from Settings, under Application updates.";

export type BackendCompatibilityBannerViewProps = {
	message: string;
	severity: "danger" | "warning";
	offerUpdate: boolean;
	offerRetry: boolean;
	updating: boolean;
	updateError: string | null;
	onRetry: () => void;
	onUpdate: () => void;
};

/**
 * The band, split from its readings so each state is a story.
 *
 * WHY THE SPLIT (design note § 5.1; the `ChatStatusStripView` precedent): the
 * banner's states are conditions of a running daemon, so a frame cannot arrange
 * them through the hooks - but they are exactly the states the operator's
 * report and this fix are about. The container keeps the hooks and the
 * suppression; this takes props and renders.
 *
 * THE ONE BAND GRAMMAR applies here as it does in the strip: `Alert` wearing
 * `NOTICE_BAND` inside the pane's own `shrink-0 px-6 py-1` gutter. The old
 * shape - full-bleed, squared, a bottom rule only - read as a second system
 * stacked under the strip's inset rounded band. No `role` and no dismiss: this
 * is a callout present from first paint, and the pill contract is the strip's
 * alone (design note § 3, A9).
 *
 * AT MOST ONE `primary` PER BAND: where both acts are offered, `Update backend`
 * is the remedy the state calls for and `Retry` renders `ghost`; where
 * re-claiming is the only act, `Retry` is the primary itself (design note § 3,
 * F4). A `secondary` control here had no boundary that clears the file's own
 * 3:1 floor on either wash (measured: 2.09:1 worst on `warningWash`, 2.98:1 on
 * `dangerWash`), which is why the remedy is a filled control and any second
 * control is text-only.
 */
export const BackendCompatibilityBannerView = ({
	message,
	severity,
	offerUpdate,
	offerRetry,
	updating,
	updateError,
	onRetry,
	onUpdate,
}: BackendCompatibilityBannerViewProps) => (
	<div className="shrink-0 px-6 py-1">
		<Alert variant={severity} className={NOTICE_BAND}>
			<div className="flex w-full min-w-0 items-center gap-2">
				<span className="min-w-0 flex-1 text-body-sm text-ink">
					{message}
					{updateError ? ` ${updateError}` : null}
				</span>
				{(offerUpdate || offerRetry) && (
					<span className="flex shrink-0 items-center gap-2">
						{offerUpdate && (
							<Button
								variant="primary"
								size="sm"
								onClick={onUpdate}
								disabled={updating}
							>
								{updating ? "Updating" : "Update backend"}
							</Button>
						)}
						{offerRetry && (
							<Button
								variant={offerUpdate ? "ghost" : "primary"}
								size="sm"
								onClick={onRetry}
							>
								Retry
							</Button>
						)}
					</span>
				)}
			</div>
		</Alert>
	</div>
);

/**
 * Whether the compatibility banner yields this state to the pane's status strip.
 *
 * ONE VOICE PER FACT (design note § 2.3, where D29's arm is kept verbatim and
 * the `!answered` arm is added). The strip owns the facts it already states; the
 * banner keeps every fact it alone owns:
 *
 * - `credential-refused` - the strip's row states the refusal in the pane, and
 *   the banner speaks only where the strip is NOT mounted (its presence is the
 *   input, so that is one comparison rather than a route table);
 * - `cause === null && !answered` with an outage-shaped kind - no pairing cause
 *   and no capabilities payload: the strip's `unreachable` row states it one
 *   element up, and this banner's "did not answer" sentence would be a second
 *   band for the same outage. `unauthorized` is deliberately NOT included: a
 *   401 is a refusal fact the strip has no row for unless main publishes the
 *   cause, and suppressing it would recreate the sidebar's old failure in
 *   reverse - the fix for two voices producing zero voices;
 * - everything else: no suppression. A pairing cause the strip never states
 *   (successor etc.) is banner-only by construction after the strip's row-1
 *   cause gate.
 *
 * PURE AND EXPORTED SO IT CAN BE DRIVEN DIRECTLY. A static render
 * (`renderToStaticMarkup` - the desktop suite's renderer) reads
 * `useSyncExternalStore`'s SERVER snapshot for `stripPresent`, which is
 * deliberately `false` (see `chat-status-presence.ts`), so a rendered banner
 * cannot observe the presence store at all: a test that set it and rendered
 * would pass or fail with the input stuck false whatever it did. This function
 * is the half that CAN be driven; the banner's own call site is pinned to it by
 * source, after `kind` is computed, in `scripts/backend-error-surfaces.test.mjs`.
 */
export function bannerYieldsToStrip(input: {
	stripPresent: boolean;
	cause: DaemonPairingCause | null;
	answered: boolean;
	kind: BackendErrorKind;
}): boolean {
	const { stripPresent, cause, answered, kind } = input;
	return (
		stripPresent &&
		(cause === "credential-refused" ||
			(cause === null &&
				!answered &&
				(kind === "unreachable" || kind === "deadline" || kind === "unknown")))
	);
}

export const BackendCompatibilityBanner = () => {
	const capabilities = useDesktopCapabilities();
	const queryClient = useQueryClient();
	const { data: serverHealth } = useServerHealth();
	const [updating, setUpdating] = useState(false);
	const [updateError, setUpdateError] = useState<string | null>(null);

	/*
	 * The pairing cause comes from MAIN, not from the capability answer.
	 *
	 * `/v1/capabilities` admits nobody by design, so the same answer arrives before
	 * and after this app claims a plane - which is why a surface reading only that
	 * payload cannot tell "the server is old" from "this app holds no credential"
	 * (the operator's chat pane said the first about the second). Main is the
	 * process that knows: it holds the bearer, it claims the plane, and it is the
	 * only one that can see the answering process is not the one it attached to
	 * (design § 2, § 5.2).
	 */
	const snapshot = serverHealth?.snapshot ?? null;
	const cause =
		snapshot && !snapshot.pairing.available
			? (snapshot.pairing.cause ?? "unpaired")
			: null;
	/*
	 * WHETHER THE STRIP IS ON SCREEN (design round 3, D29, generalised by the
	 * design note's § 2.3). In the refusal state the strip and this banner state
	 * the same fact one row apart, with two sentences and two controls labelled
	 * `Retry` - and the credential cause is reachable while the server ANSWERS,
	 * so the strip's presence is unrelated to `online` and cannot be inferred
	 * from the connection state. The strip is the voice where it is mounted: it
	 * is the pane's own live region, its Retry is the same `backend.reconnect`
	 * verb this banner's is, and the sidebar's three paragraphs already stand
	 * down to it. The full rule - this arm plus the `!answered` outage arm - is
	 * the exported `bannerYieldsToStrip` below, so the render path reads it once
	 * and a test can drive it directly.
	 */
	const stripPresent = useChatStatusStripPresent();
	/*
	 * Whether THIS app holds the install serving it, from main's own answer.
	 *
	 * The banner may not infer it: `installKind` and the serve record describe ANY
	 * daemon on the machine, and offering to update a `lop` the user installed for
	 * themselves - one this app may read but not move - is the failure § 10.1 warns
	 * about. `owned` is main's "this app spawned the daemon, and is the only process
	 * that may stop it", i.e. exactly the permission an update-then-restart needs.
	 */
	const servedByThisApp = snapshot?.owned === true;

	/**
	 * The banner's Retry, wired to the verb that can change the condition.
	 *
	 * `invalidateQueries` alone was INERT in the states that offer this control:
	 * the capability route is public, so it answers identically before and after a
	 * refetch, and nothing about the pairing moves (design § 0(a)).
	 * `BACKEND_RECONNECT_CHANNEL` clears main's recovery pacing and runs the claim
	 * path - the one act that can re-pair - and it is the same IPC the connectivity
	 * banner's Retry already uses, so the two controls cannot mean different things.
	 * The invalidation stays BESIDE it: the verb answers with a snapshot and the
	 * push subscription follows, but this banner reads the capability query, and a
	 * control that changes the state without the surface re-reading it would leave
	 * the sentence it just acted on on screen.
	 */
	const retry = useCallback(async () => {
		await window.api?.backend?.reconnect?.();
		await queryClient.invalidateQueries({ queryKey: desktopKeys.capabilities });
	}, [queryClient]);

	const update = useCallback(async () => {
		setUpdating(true);
		setUpdateError(null);
		/*
		 * The reason the main process wrote about THIS attempt.
		 *
		 * `update-backend` reports failure by RESOLVING false, and the sentence that
		 * explains it is sent on `backend-update-error` before that promise settles -
		 * so "the update could not start" was shown while the cause was already in
		 * hand on the channel (design D4, review R1-5). The listener is scoped to the
		 * attempt rather than mounted with the banner, and it takes only the `update`
		 * phase: the same channel also carries a CHECK's own failures ("Unable to
		 * determine backend version."), which are not this press's outcome and must
		 * never become its sentence (review R2-1).
		 */
		let reason: string | null = null;
		const removeBackendUpdateErrorListener =
			window.api.updater.onBackendUpdateError((report) => {
				/*
				 * The machine's own words on this channel are errno forms (the
				 * operator's log holds `getaddrinfo ENOTFOUND pypi.org`), so the
				 * sentence comes from the shared update copy rather than from the
				 * transport.
				 */
				if (report.phase === "update") {
					/*
					 * VERBATIM, not classified: an attempt's report is the app's own composed
					 * sentence, and the classifier's 400-character reading of a long string as
					 * a machine dump deleted it on this surface while the notification panel
					 * had been fixed (review round 5, M1). `serverUpdateFailureReason` is the
					 * one place that rule lives now.
					 */
					reason = serverUpdateFailureReason(report);
				}
			});
		try {
			const started = await window.api.updater.updateBackend();
			// The invoke RESOLVES false when the update was refused or failed, so a
			// resolved promise is not success: taking it for one told the user the
			// update had been started and left them on a server that never moved.
			if (started === false) {
				setUpdateError(reason ?? BACKEND_UPDATE_UNEXPLAINED);
				return;
			}
			retry();
		} catch (error) {
			setUpdateError(
				// The machine's own words, cleaned: this panel's own copy says what
				// failed, and a sentence from `updateErrorCopy` here would describe a
				// check rather than the update the user pressed.
				error instanceof Error
					? updateMessageOf(error)
					: BACKEND_UPDATE_UNEXPLAINED,
			);
		} finally {
			removeBackendUpdateErrorListener();
			setUpdating(false);
		}
	}, [retry]);

	// Still negotiating: say nothing rather than flash a warning that may
	// clear a moment later.
	if (capabilities.isLoading) return null;

	const data = capabilities.data;
	const missing = data
		? REQUIRED_FEATURES.filter((feature) => (data.features?.[feature] ?? 0) < 1)
		: [...REQUIRED_FEATURES];
	const unpaired = Boolean(data) && !data?.desktop_available;
	if (!compatibilityBannerShown(data, cause)) return null;

	// The probe's HTTP status is what separates "old" from "not running" from
	// "cannot authenticate", and the providers grid reads the same field to reach
	// the same conclusion. Both now go through the shared classification so they
	// cannot answer that question differently: the grid's own two-way split used
	// to send a 401 user to a backend install this banner deliberately withholds.
	const kind = backendErrorKind(capabilities.error);
	const answered = Boolean(data);
	/*
	 * THE YIELD, WHERE THE NOTE PUTS IT: `compatibilityBannerShown` above decided
	 * whether the banner may speak AT ALL; this decides whether the pane's strip
	 * is already speaking for the same fact. It reads AFTER `kind` is computed so
	 * the outage-shaped kinds can be told from `unauthorized`, and it calls the
	 * one exported predicate rather than restating the rule in the render path.
	 */
	if (bannerYieldsToStrip({ stripPresent, cause, answered, kind })) return null;

	const canUpdate = Boolean(window.api?.updater?.updateBackend);
	const message = backendCompatibilityMessage({
		kind,
		unpaired,
		missing,
		answered,
		cause,
	});
	// Offered only where it is the actual remedy, and for a pairing cause the answer
	// depends on WHO holds the install: S3 can be repaired by an install this app
	// owns, and every other pairing cause cannot be repaired by one at all.
	const offerUpdate =
		canUpdate &&
		backendUpdateIsRemedy({ kind, unpaired, answered, cause, servedByThisApp });
	/*
	 * NO CONTROL WHERE NO REMEDY EXISTS (design § 2 S2/S3, § 10.2).
	 *
	 * S2 is another program's plane - the daemon refuses a second claim even with
	 * the correct key, so a Retry would be a button that provably cannot work. S3
	 * is a daemon that predates the handshake, where the only act that helps is the
	 * update, and only for an install this app holds. A refused control is worse
	 * than none: it spends the user's attention on the app's own failure. Every
	 * other state keeps Retry, because re-claiming is what can change it.
	 */
	const offerRetry =
		cause !== "governed-elsewhere" && cause !== "pre-handshake";

	return (
		/*
		 * IN FLOW, beside the connectivity band, rather than `fixed inset-x-0 top-0
		 * z-2100` (D9). The two bands can be up at once, and two `fixed` strips both
		 * pinned to y 0 OVERLAP rather than stack - so the case that decided the shape
		 * (`docs/evidence/band-occlusion/before/before-two-bands.png`) could not even
		 * be photographed as two bands before this change. `app.tsx` carries the full
		 * rationale. The band itself is `BackendCompatibilityBannerView` now; this
		 * call is the container's whole render path.
		 */
		<BackendCompatibilityBannerView
			message={message}
			/*
			 * ONE FACT, ONE SEVERITY (design note § 0.2): `credential-refused` is the
			 * same refusal the strip paints `danger`, so this banner paints it danger
			 * too; every other state here is a transition, a feature limit or an
			 * environment fact, which is the doctrine's `warning`.
			 */
			severity={cause === "credential-refused" ? "danger" : "warning"}
			offerUpdate={offerUpdate}
			offerRetry={offerRetry}
			updating={updating}
			updateError={updateError}
			onRetry={() => void retry()}
			onUpdate={() => void update()}
		/>
	);
};
