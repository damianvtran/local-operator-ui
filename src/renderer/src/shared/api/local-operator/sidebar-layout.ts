import {
	DEFAULT_SIDEBAR_LAYOUT,
	type SidebarLayout,
	sanitizeSidebarLayout,
} from "@shared/components/navigation/sidebar-destinations";
import { t } from "@shared/i18n";
import { showErrorToast } from "@shared/utils/toast-manager";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
 * make every reorder visibly lag the pointer. The cache is updated in
 * `onMutate`, the answered layout (the route normalises) replaces it in
 * `onSuccess`, and `onError` restores the snapshot and raises the one toast the
 * design contract promises. Nothing is written before the drop, so a cancelled
 * gesture costs one rollback of nothing.
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
	 * all nine ids exactly once (`sidebar-destinations.ts`). A component that
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
export function useSidebarLayout(canCustomise: boolean) {
	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: sidebarLayoutKeys.layout,
		// The gate is also the reason the hook can be mounted unconditionally: a
		// backend without the capability is never asked for a route it 404s.
		enabled: canCustomise,
		queryFn: readSidebarLayout,
		/*
		 * `staleTime: Infinity`: the layout is a preference this client itself
		 * writes, and the design contract says the read happens ONCE per mount.
		 * React Query remounts the sidebar on route changes; a finite stale time
		 * would spend a request per navigation on a document that cannot change
		 * under this window (last writer wins, single-window app).
		 */
		staleTime: Number.POSITIVE_INFINITY,
		retry: retryDesktopQuery,
	});

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
				layout: next,
			});
			return sanitizeSidebarLayout(result.layout);
		},
		retry: retryDesktopMutation,
		onMutate: async (next: SidebarLayout) => {
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
			return { previous };
		},
		onError: (_error, _next, context) => {
			if (context?.previous) {
				queryClient.setQueryData(sidebarLayoutKeys.layout, context.previous);
			}
			showErrorToast(t("ui.shell.sidebar_navigation.save_failed"));
		},
		onSuccess: (saved) => {
			/*
			 * The route's answer wins over the optimistic guess. The route VALIDATES
			 * and stores the document it was sent; it does not fill missing ids or
			 * drop unknown ones — `sanitizeSidebarLayout` owns that merge on this
			 * side of the wire. Replacing the cache with the answered document is
			 * what makes the next read of this resource return exactly what the
			 * backend holds, including the subset a local sanitizer would have
			 * completed.
			 */
			queryClient.setQueryData(sidebarLayoutKeys.layout, saved);
		},
	});

	const readSucceeded =
		canCustomise && query.isSuccess && query.data !== undefined;
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
		isSaving: mutation.isPending,
		/*
		 * A failed write is a surface state, not only a toast: the row menu's
		 * disabled/pending state has to stop showing the optimistic move as saved
		 * once the rollback happened. `isSuccess` rather than "has errored ever"
		 * would clear it on the next save, which `mutation.isError` also does
		 * because React Query resets the mutation's status on `mutate`.
		 */
		saveFailed: mutation.isError,
	};
}
