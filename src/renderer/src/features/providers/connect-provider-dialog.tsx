/**
 * @file connect-provider-dialog.tsx
 * @description
 * The provider list in a dialog over whatever the user is doing, opened from
 * the empty-chat card, the composer's status line, the backend's
 * "No model provider is configured yet" notice and the command palette
 * (`connect-provider-store.ts`).
 *
 * It is the onboarding list's shape (featured rows, "More providers") because
 * it answers the same question for the same person: someone with nothing
 * connected who wants the shortest path to a working chat. Dismissible by
 * Escape, the close button or an outside click -- it is an offer, never a
 * gate. On success its action reads "Continue" and closes it, leaving the
 * user in the chat with a default already set by the backend.
 */

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@shared/components/ui";
import type { FC } from "react";
import { useNavigate } from "react-router-dom";
import { useConnectProviderStore } from "./connect-provider-store";
import { ProviderGrid } from "./provider-grid";

export const ConnectProviderDialog: FC = () => {
	const { open, focusGroup, providerId, closeConnect } =
		useConnectProviderStore();
	// The receipt's Change sends the user to the settings section that owns the model
	// (the same destination Settings' own provider panel uses).
	const navigate = useNavigate();
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) closeConnect();
			}}
		>
			<DialogContent
				className="max-h-[calc(100vh-4rem)] max-w-[min(40rem,calc(100vw-4rem))] gap-4 overflow-y-auto"
				data-connect-provider-dialog=""
			>
				<div className="flex flex-col gap-1">
					<DialogTitle className="text-title">
						Connect a model provider
					</DialogTitle>
					<DialogDescription className="text-body-sm text-ink-muted">
						Your agents need a model to think with. Sign in with an account you
						already have, or add an API key.
					</DialogDescription>
				</div>
				{open ? (
					<ProviderGrid
						context="dialog"
						featuredOnly
						focusGroup={focusGroup}
						initialProviderId={providerId}
						onDone={closeConnect}
						/*
						 * The receipt's Change. Onboarding step 1 and Settings both pass one;
						 * this dialog did not, so the path the PR's discoverability item names
						 * showed a receipt with no way to change it (review round 2 R2-m4).
						 * General owns the model settings, which is where Settings' own panel
						 * sends the same press.
						 */
						onChangeModel={() => {
							closeConnect();
							navigate("/settings");
						}}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
};
