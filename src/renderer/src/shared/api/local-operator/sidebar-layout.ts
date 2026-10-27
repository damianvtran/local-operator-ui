import {
	DEFAULT_SIDEBAR_LAYOUT,
	type SidebarLayout,
	sanitizeSidebarLayout,
	stripUnadvertisedIds,
} from "@shared/components/navigation/sidebar-destinations";
import { t } from "@shared/i18n";
import { showErrorToast } from "@shared/utils/toast-manager";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type { DesktopSidebarLayoutResponse } from "../../../../../shared/desktop-control-contract";
import { retryDesktopMutation, retryDesktopQuery } from "./backend-error";
import { desktopResult } from "./desktop-api";

/**
 * The sidebar customisation resource's read and write (design contract § 4,
 * § 7): one GET on mount, optimistic PUTs, and a rollback that puts the
 * previous layout back when the write is refused.
 *
 * WHY THE READ IS FAIL-CLOSED, and this is the part that decides the whole
 * hook's shape. The route is gated on the `sidebar_layout` capability because a
 * backend that predates it answers 404. The design contract's rule is that the
 * client then falls back to the FIXED DEFAULT order with drag and the row menu
 * ABSENT - never a local-only arrangement that looks customisable and silently
 * reverts on restart. So an absent answer (capability missing), a pending read
 * or a failed read all resolve to `DEFAULT_SIDEBAR_LAYOUT` plus
 * `canCustomise: false`; only a successful read of a backend that advertises
 * the capability unlocks editing. That also means this hook never invents a
 * write against a backend that cannot store one: `save` is a no-op unless the
 * read succeeded.
 *
 * WHY THE WRITE IS OPTIMISTIC. A drag or a menu move must land in the frame the
 * gesture ends in; waiting for a loopback round trip before the row moves would
 * make every reorder visibly lag the pointer. `onMutate` puts the gesture's
 * layout in the cache and that value IS the stored document - the route stores
 * exactly what it is sent and this client always sends a full sanitised layout
 * - so there is no `onSuccess` write to make. A failure restores the snapshot
 * and raises the one toast the design contract promises; when the LATEST queued
 * gesture settles, the backend's own answer is re-read, so the stored truth is
 * what the rail keeps once the queue drains (a newer gesture must not be undone
 * by an older failure - see the sequence ref at the mutation). Nothing is
 * written before the drop, so a cancelled gesture costs one rollback of nothing.
 */
export const sidebarLayoutKeys = {
	layout: ["desktop", "sidebar_layout"] as const,
};

/** The read's answer, sanitised before it is cached. */
async function readSidebarLayout(): Promise<SidebarLayout> {
	const result = await desktopResult<DesktopSidebarLayoutResponse>({
		op: "sidebar_layout.get",
	});
	/*
	 * Sanitised HERE, at the boundary, rather than in the component: the store
	 * can be a file an older build wrote or one a newer build extended, and the
	 * rest of the feature is written against the guarantee that a layout holds
	 * all ten ids exactly once (`sidebar-destinations.ts`). A component that
	 * had to re-sanitise would be a second copy of the merge rules.
	 */
	return sanitizeSidebarLayout(result.layout);
}

/**
 * The layout the rail should draw, whether it may be edited, and the two writes
 * the row menu and a drop share.
 *
 * `canCustomise` is the CALLER'S capability answer - the sidebar and the page
 * each already hold the capabilities query, and a hook that subscribed itself
 * would be a second reader of a query both of them have (the same argument
 * `useHubUpdates` states). It is returned alongside the layout so a component
 * reads one flag for "draw the drag affordances and the menu", already folded
 * together with "the read worked" - the two conditions a row must not have to
 * know separately.
 */
export function useSidebarLayout(
	canCustomise: boolean,
	/*
	 * Whether the backend advertises a capability-gated id's feature. Every
	 * request body passes through `stripUnadvertisedIds` with it: an older core
	 * refuses an id it does not know (422), and the local cache keeps the id so
	 * the row's stored slot survives. Defaults to "nothing advertised", the
	 * fail-closed answer for a caller that has no capabilities read.
	 */
	advertised: (feature: string) => boolean = () => false,
) {
	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: sidebarLayoutKeys.layout,
		// The gate is also the reason the hook can be mounted unconditionally: a
		// backend without the capability is never asked for a route it 404s.
		enabled: canCustomise,
		queryFn: readSidebarLayout,
		/*
		 * `staleTime: Infinity`: the layout is a preference this client itself
		 * writes, so React Query must not spend a request per navigation. The read
		 * happens at mount plus one deliberate re-read when the latest queued write
		 * settles (`onSettled` invalidates below); nothing else refetches it.
		 */
		staleTime: Number.POSITIVE_INFINITY,
		retry: retryDesktopQuery,
	});

	const mutationSequence = useRef(0);
	const mutation = useMutation({
		/*
		 * ONE WRITE AT A TIME, IN ORDER (architecture review round 1). React Query
		 * starts a new mutation as soon as `mutate` is called; two drops inside one
		 * loopback window would put two PUTs on the wire at once, and the route is
		 * last-writer-wins - so whichever request finished LAST would win, which is
		 * not necessarily whichever drop the reader made last. A shared `scope`
		 * makes the query client serialise them: the second waits for the first, and
		 * the order on the wire is the order of the gestures. The scope id is the
		 * resource, not the layout: every writer of `/v1/desktop/sidebar-layout`
		 * shares this one chain.
		 */
		scope: { id: "sidebar-layout" },
		mutationFn: async (next: SidebarLayout) => {
			const result = await desktopResult<DesktopSidebarLayoutResponse>({
				op: "sidebar_layout.set",
				/*
				 * The BODY is stripped, never the cache: `onMutate` keeps the full
				 * layout, and the answer is re-sanitised below, which re-inserts a
				 * stripped id at its default slot (contract § 8.1 "new UI, old core").
				 */
				layout: stripUnadvertisedIds(next, advertised),
			});
			return sanitizeSidebarLayout(result.layout);
		},
		retry: retryDesktopMutation,
		onMutate: async (next: SidebarLayout) => {
			const seq = ++mutationSequence.current;
			/*
			 * Cancel in-flight reads before writing the optimistic value: a GET
			 * that was already on the wire would otherwise land after this PUT and
			 * replace the just-moved layout with the pre-move one. The rollback
			 * snapshot is the cache's current value, which is why the cancel has to
			 * happen first.
			 */
			await queryClient.cancelQueries({
				queryKey: sidebarLayoutKeys.layout,
			});
			const previous = queryClient.getQueryData<SidebarLayout>(
				sidebarLayoutKeys.layout,
			);
			queryClient.setQueryData(sidebarLayoutKeys.layout, next);
			return { previous, seq };
		},
		onError: (_error, _next, context) => {
			/*
			 * AN OLDER FAILURE MUST NOT UNDO A NEWER GESTURE (agent review round
			 * 2, R2-2). `onMutate` runs for every queued mutation at `mutate()`
			 * time, so B's optimistic layout can be in the cache while A is still
			 * on the wire; restoring A's snapshot here would erase B, and with
			 * `staleTime: Infinity` nothing would refetch it. Only the latest
			 * gesture has a snapshot that describes the cache's current intent.
			 */
			if (context?.seq === mutationSequence.current && context.previous) {
				queryClient.setQueryData(sidebarLayoutKeys.layout, context.previous);
			}
			showErrorToast(t("ui.shell.sidebar_navigation.save_failed"));
		},
		/*
		 * THE QUEUE'S LAST WORD IS THE BACKEND'S (R2-2). Only the latest gesture
		 * re-reads: it settles after every earlier scoped PUT, so this is when the
		 * stored document is final. `invalidateQueries` forces the read despite
		 * `staleTime: Infinity`; if the latest failed, its rollback (above) already
		 * restored the store's answer and this read returns the same document.
		 *
		 * THERE IS NO `onSuccess` WRITE (round 1, R1-4): the route stores what it
		 * is sent and the optimistic value is that document, so writing the answer
		 * per mutation would let an earlier save's answer replace a later
		 * gesture's optimistic layout.
		 */
		onSettled: (_data, _error, _next, context) => {
			if (context?.seq === mutationSequence.current) {
				void queryClient.invalidateQueries({
					queryKey: sidebarLayoutKeys.layout,
				});
			}
		},
	});

	/*
	 * DATA, NOT `isSuccess` (agent review round 3, R3-2). A failed BACKGROUND
	 * refetch flips `isSuccess` to false while the last good layout is still in
	 * `data`; keying editability off it would drop the rail to the default order
	 * and disable customisation until a later read succeeded. The initial failed
	 * read has no data at all, so the fail-closed contract is unchanged.
	 */
	const readSucceeded = canCustomise && query.data !== undefined;
	const layout = readSucceeded ? query.data : DEFAULT_SIDEBAR_LAYOUT;

	const save = (next: SidebarLayout) => {
		/*
		 * FAIL-CLOSED, AGAIN: no successful read means the backend either does
		 * not advertise the resource or did not answer, and the design contract
		 * forbids inventing a write from a default the user never chose.
		 */
		if (!readSucceeded) return;
		mutation.mutate(next);
	};

	const reset = () => {
		if (!readSucceeded) return;
		/*
		 * A reset is a save of the default document, not a DELETE: the route has
		 * one write verb, and storing the default explicitly is what makes "reset
		 * then restart" and "never customised" indistinguishable to every reader.
		 */
		/*
		 * A fresh copy, not the module constant: this object becomes the optimistic
		 * cache value and then the request body, and neither should alias a default
		 * every other reader of the rail falls back to.
		 */
		mutation.mutate(sanitizeSidebarLayout(DEFAULT_SIDEBAR_LAYOUT));
	};

	return {
		layout,
		canCustomise: readSucceeded,
		save,
		reset,
	};
}
