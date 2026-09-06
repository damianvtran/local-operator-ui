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

import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import {
	desktopKeys,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { Alert, AlertDescription, Button } from "@shared/components/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

const REQUIRED_FEATURES = [
	"auth",
	"settings",
	"commands",
	"catalogues",
	"lifecycle",
	"mcp",
	"radient",
] as const;

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
		try {
			await window.api.updater.updateBackend();
			retry();
		} catch (error) {
			setUpdateError(
				error instanceof Error
					? error.message
					: "The backend update could not start.",
			);
		} finally {
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
	if (data?.desktop_available && missing.length === 0) return null;

	// The probe's HTTP status is what separates "old" from "not running" from
	// "cannot authenticate". 404 is the only one an update fixes: the route is
	// absent, so this backend predates the contract.
	//
	// `null` means the request produced no status at all -- the transport failed
	// and no backend was reached -- which reads as unreachable below. The
	// transport now RAISES that state as a typed `DesktopControlError` with
	// `status: null`, so this is a stated fact rather than the fallback for an
	// unrecognised error type.
	const status =
		capabilities.error instanceof DesktopControlError
			? capabilities.error.status
			: null;
	const outdated = Boolean(!data && status === 404);
	const unreachable = Boolean(!data && (status === null || status === 503));
	const unauthorized = Boolean(!data && (status === 401 || status === 403));

	const canUpdate = Boolean(window.api?.updater?.updateBackend);
	const message = unreachable
		? "The backend is not answering. Provider sign-in, settings, slash commands and MCP management need it running. Retry once it has started."
		: unauthorized
			? "This app cannot authenticate to the running backend, so protected controls are unavailable. Restart the app so it starts and pairs with its own backend."
			: outdated
				? "This backend is older than the app expects. Provider sign-in, settings, slash commands and MCP management stay off until it is updated."
				: unpaired
					? "This app is not paired with the running backend, so protected controls are unavailable. Restart the app so it can manage its own backend."
					: `The backend is missing ${missing.join(", ")} support. Update it to enable those surfaces.`;
	// Offered only where it is the actual remedy. A backend that is down or
	// refusing this app's bearer is not fixed by installing a newer one.
	const offerUpdate = canUpdate && !unpaired && !unreachable && !unauthorized;

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
