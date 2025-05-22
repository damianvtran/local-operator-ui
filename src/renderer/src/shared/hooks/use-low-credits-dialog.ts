import { useCallback, useEffect, useState } from "react";
import { useRadientAuth } from "./use-radient-auth";
import { createRadientClient } from "@shared/api/radient";
import type { CreditBalanceResult } from "@shared/api/radient/types";
import { useLowCreditsStore } from "@shared/store/low-credits-store";
import { apiConfig } from "@shared/config";

const LOW_CREDITS_THRESHOLD = 1;

export const useLowCreditsDialog = () => {
	const { isAuthenticated, user, sessionToken } = useRadientAuth();
	const { hasBeenNotified, setHasBeenNotified } = useLowCreditsStore();
	const [isDialogOpen, setIsDialogOpen] = useState(false);
	const [currentCredits, setCurrentCredits] = useState<number | null>(null);

	const fetchCredits = useCallback(async () => {
		if (
			!isAuthenticated ||
			!user?.radientUser?.account?.tenant_id ||
			!sessionToken
		) {
			return;
		}

		try {
			const radientClient = createRadientClient(
				apiConfig.radientBaseUrl, // Use apiConfig
				apiConfig.radientClientId, // Use apiConfig
			);
			const response = await radientClient.billing.getCreditBalance(
				user.radientUser.account.tenant_id,
				sessionToken,
			);

			if (!response || typeof response.result?.balance !== "number") {
				throw new Error("Invalid credit balance response format");
			}
			const creditBalance: CreditBalanceResult = response.result;
			setCurrentCredits(creditBalance.balance);
		} catch (error) {
			console.error("Failed to fetch Radient credits:", error);
			setCurrentCredits(null);
		}
	}, [isAuthenticated, user?.radientUser?.account?.tenant_id, sessionToken]);

	useEffect(() => {
		if (isAuthenticated) {
			fetchCredits();
		}
	}, [isAuthenticated, fetchCredits]);

	useEffect(() => {
		if (
			isAuthenticated &&
			!hasBeenNotified &&
			currentCredits !== null &&
			currentCredits < LOW_CREDITS_THRESHOLD
		) {
			setIsDialogOpen(true);
		} else {
			setIsDialogOpen(false);
		}
	}, [isAuthenticated, hasBeenNotified, currentCredits]);

	const openRadientConsole = () => {
		if (window.api?.openExternal) {
			window.api.openExternal("https://console.radienthq.com");
		} else {
			// Fallback for web environment or if shell is not available
			window.open("https://console.radienthq.com", "_blank");
		}
		setHasBeenNotified(true); // Mark as notified when console is opened
		setIsDialogOpen(false);
	};

	const closeDialog = () => {
		setIsDialogOpen(false);
		// Optionally, you can setHasBeenNotified(true) here as well,
		// depending on whether "Maybe Later" should count as being notified.
		// For now, only explicit actions (going to console or closing after seeing) mark as notified.
	};

	// This function is called when the dialog's internal close logic runs (e.g. clicking "Maybe Later")
	const onDialogClose = () => {
		setHasBeenNotified(true);
		setIsDialogOpen(false);
	};

	return {
		isLowCreditsDialogOpen: isDialogOpen,
		openRadientConsole,
		closeLowCreditsDialog: closeDialog, // Renamed for clarity
		onLowCreditsDialogClose: onDialogClose, // For the dialog's own close handler
		currentCredits, // Expose current credits if needed elsewhere
	};
};
