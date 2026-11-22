import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { getCurrentPath } from "@shared/utils/path-utils";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { openConversation } from "../open-conversation";
import {
	type WorkspaceTab,
	makeWorkspaceTab,
	moveWorkspaceTab,
	sameWorkspaceTarget,
	saveWorkspaceTabs,
	syncWorkspaceTabs,
	workspaceNeighbor,
	workspaceSessionPathMatches,
	workspaceTarget,
} from "../workspace-tabs-model";

import { useWorkspaceTabCleanup } from "./use-workspace-tab-cleanup";

const targetOf = (
	state: ReturnType<typeof useCanonicalSessionsStore.getState>,
) => workspaceTarget(state.activeDraftKey, state.activeSessionId, state.drafts);

export function useWorkspaceTabs(
	navigate: NavigateFunction,
	startDraft: () => void,
	feedAvailable: boolean,
) {
	const [tabs, setTabs] = useState(() => {
		const state = useCanonicalSessionsStore.getState();
		const saved = useUiPreferencesStore
			.getState()
			.workspaceTabs.map(({ id, pinned }) => ({
				...makeWorkspaceTab({ kind: "session", id }),
				pinned,
			}));
		return syncWorkspaceTabs(saved, targetOf(state), state.drafts);
	});
	const [focusRequested, setFocusRequested] = useState(false);
	const focusHandled = useCallback(() => setFocusRequested(false), []);
	const closeHandoff = useRef<{
		from: string;
		to: WorkspaceTab["target"];
	} | null>(null);
	const drop = useCallback((key: string) => {
		setTabs((items) => items.filter((item) => item.key !== key));
	}, []);

	const autoClose = useUiPreferencesStore((state) => state.workspaceAutoClose);
	const setAutoClose = useUiPreferencesStore(
		(state) => state.setWorkspaceAutoClose,
	);
	const removeInactive = useCallback((keys: ReadonlySet<string>) => {
		setTabs((items) => {
			const active = targetOf(useCanonicalSessionsStore.getState());
			return items.filter(
				(tab) =>
					!keys.has(tab.key) ||
					tab.pinned ||
					sameWorkspaceTarget(tab.target, active),
			);
		});
	}, []);
	useWorkspaceTabCleanup(feedAvailable && autoClose, tabs, removeInactive);

	useLayoutEffect(() => {
		// React can batch the create receipt with draft retirement. Observe the
		// canonical pointer at its write, including sends which land off-screen.
		return useCanonicalSessionsStore.subscribe((state, previous) => {
			if (
				state.drafts !== previous.drafts ||
				state.activeDraftKey !== previous.activeDraftKey ||
				state.activeSessionId !== previous.activeSessionId
			) {
				setTabs((items) =>
					syncWorkspaceTabs(
						items,
						targetOf(state),
						state.drafts,
						previous.drafts,
					),
				);
			}
			const handoff = closeHandoff.current;
			if (!handoff || !sameWorkspaceTarget(targetOf(state), handoff.to)) {
				closeHandoff.current = null;
				return;
			}
			if (
				handoff.to.kind !== "session" ||
				state.validatingSessionId === handoff.to.id
			)
				return;
			closeHandoff.current = null;
			if (
				state.forgotten[handoff.to.id] === undefined &&
				workspaceSessionPathMatches(getCurrentPath(), handoff.to.id)
			)
				drop(handoff.from);
		});
	}, [drop]);

	useLayoutEffect(() => {
		const store = useUiPreferencesStore.getState();
		const saved = saveWorkspaceTabs(tabs);
		if (
			saved.length !== store.workspaceTabs.length ||
			saved.some(
				({ id, pinned }, i) =>
					id !== store.workspaceTabs[i].id ||
					pinned !== store.workspaceTabs[i].pinned,
			)
		) {
			store.setWorkspaceTabs(saved);
		}
	}, [tabs]);

	const open = async ({ target }: WorkspaceTab) => {
		if (target.kind === "draft") {
			const store = useCanonicalSessionsStore.getState();
			if (!store.drafts[target.id]) return false;
			store.openDraft(target.id);
			navigate("/chat");
			return true;
		}
		return openConversation(navigate, target.id);
	};
	const select = async (tab: WorkspaceTab) => {
		closeHandoff.current = null;
		if (await open(tab)) {
			if (
				sameWorkspaceTarget(
					targetOf(useCanonicalSessionsStore.getState()),
					tab.target,
				)
			)
				setFocusRequested(true);
		}
	};
	const close = async (tab: WorkspaceTab) => {
		closeHandoff.current = null;
		if (
			!sameWorkspaceTarget(
				targetOf(useCanonicalSessionsStore.getState()),
				tab.target,
			)
		) {
			drop(tab.key);
			setFocusRequested(true);
			return;
		}
		const next = workspaceNeighbor(tabs, tab.key);
		if (!next) {
			startDraft();
			if (
				!sameWorkspaceTarget(
					targetOf(useCanonicalSessionsStore.getState()),
					tab.target,
				)
			) {
				drop(tab.key);
				setFocusRequested(true);
			}
			return;
		}
		if (!(await open(next))) return;
		const state = useCanonicalSessionsStore.getState();
		if (!sameWorkspaceTarget(targetOf(state), next.target)) return;
		setFocusRequested(true);
		if (next.target.kind === "draft") {
			drop(tab.key);
		} else if (workspaceSessionPathMatches(getCurrentPath(), next.target.id)) {
			// The route switch is optimistic: don't remove the outgoing tab on a
			// 404 or a replacement selection while this candidate is validating.
			if (state.validatingSessionId === next.target.id)
				closeHandoff.current = { from: tab.key, to: next.target };
			else if (state.forgotten[next.target.id] === undefined) drop(tab.key);
		}
	};
	return {
		autoClose,
		setAutoClose,
		tabs,
		focusRequested,
		focusHandled,
		select,
		close,
		pin: (key: string) => {
			setTabs((items) =>
				items.map((item) =>
					item.key === key ? { ...item, pinned: !item.pinned } : item,
				),
			);
			setFocusRequested(true);
		},
		move: (from: string, to: string) =>
			setTabs((items) => moveWorkspaceTab(items, from, to)),
	};
}
