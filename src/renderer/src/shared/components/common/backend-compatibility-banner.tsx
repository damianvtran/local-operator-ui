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
 */

import {
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
import { Alert, AlertDescription, Button } from "@shared/components/ui";
import { useServerHealth } from "@shared/hooks/use-connectivity-status";
import {
	serverUpdateFailureReason,
	updateMessageOf,
} from "@shared/utils/update-error-copy";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

const REQUIRED_FEATURES = REQUIRED_BACKEND_FEATURES;

/**
 * What the banner says when the updater refused and said nothing else.
 *
 * Every failing branch of `update-backend` writes its own sentence to
 * `backend-update-error` first, and this banner now reads it, so this is the
 * backstop for an answer that arrived without one. It names the next step because
 * that is what the banner is for: the buttons beside it re-probe, and the failure
 * is recorded in the app's own update log (design D4, review R1-5).
 */
const BACKEND_UPDATE_UNEXPLAINED =
	"The backend update could not start. Retry, or update from Settings, under Application updates.";

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
		 * rationale.
		 */
		<div className="w-full">
			<Alert
				variant="warning"
				// Setup state, not an interruption: it is present from first paint
				// so it does not need the assertive announcement the connectivity
				// banner uses.
				className="items-center rounded-none border-x-0 border-t-0"
			>
				<div className="flex w-full items-center justify-between gap-4">
					<AlertDescription>
						{message}
						{updateError ? ` ${updateError}` : null}
					</AlertDescription>
					<div className="flex shrink-0 items-center gap-2">
						{offerUpdate && (
							<Button
								variant="primary"
								size="sm"
								onClick={() => void update()}
								disabled={updating}
							>
								{updating ? "Updating" : "Update backend"}
							</Button>
						)}
						{offerRetry && (
							<Button
								variant="secondary"
								size="sm"
								onClick={() => void retry()}
							>
								Retry
							</Button>
						)}
					</div>
				</div>
			</Alert>
		</div>
	);
};
