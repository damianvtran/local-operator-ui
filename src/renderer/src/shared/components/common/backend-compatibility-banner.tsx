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
	const [updating, setUpdating] = useState(false);
	const [updateError, setUpdateError] = useState<string | null>(null);

	const retry = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: desktopKeys.capabilities });
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
				if (report.phase === "update") reason = report.message;
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
				error instanceof Error ? error.message : BACKEND_UPDATE_UNEXPLAINED,
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
	if (!compatibilityBannerShown(data)) return null;

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
	});
	// Offered only where it is the actual remedy. A backend that is down or
	// refusing this app's bearer is not fixed by installing a newer one.
	const offerUpdate =
		canUpdate && backendUpdateIsRemedy({ kind, unpaired, answered });

	return (
		<div className="fixed inset-x-0 top-0 z-2100 w-full">
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
						<Button variant="secondary" size="sm" onClick={retry}>
							Retry
						</Button>
					</div>
				</div>
			</Alert>
		</div>
	);
};
