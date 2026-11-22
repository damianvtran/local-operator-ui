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
		to: string;
		ticket: object;
	} | null>(null);
	const tabIntent = useRef<object>();
	const drop = useCallback((key: string) => {
		setTabs((items) => items.filter((item) => item.key !== key));
	}, []);

	const settleClose = useCallback(
		(state: ReturnType<typeof useCanonicalSessionsStore.getState>) => {
			const handoff = closeHandoff.current;
			if (!handoff) return;
			const receipt = state.sessionValidationReceipt;
			if (
				receipt?.ticket !== handoff.ticket ||
				!sameWorkspaceTarget(targetOf(state), {
					kind: "session",
					id: handoff.to,
				}) ||
				!workspaceSessionPathMatches(getCurrentPath(), handoff.to) ||
				state.forgotten[handoff.to] !== undefined
			) {
				closeHandoff.current = null;
				return;
			}
			if (receipt.confirmed) {
				closeHandoff.current = null;
				drop(handoff.from);
			}
		},
		[drop],
	);

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
		const unsubscribe = useCanonicalSessionsStore.subscribe(
			(state, previous) => {
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
				settleClose(state);
			},
		);
		const observeRoute = () =>
			settleClose(useCanonicalSessionsStore.getState());
		window.addEventListener("hashchange", observeRoute);
		window.addEventListener("popstate", observeRoute);
		return () => {
			unsubscribe();
			window.removeEventListener("hashchange", observeRoute);
			window.removeEventListener("popstate", observeRoute);
			closeHandoff.current = null;
			tabIntent.current = undefined;
		};
	}, [settleClose]);

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

	const open = ({ target }: WorkspaceTab, ticket?: object) => {
		if (target.kind === "draft") {
			const store = useCanonicalSessionsStore.getState();
			if (!store.drafts[target.id]) return false;
			store.openDraft(target.id);
			navigate("/chat");
			return true;
		}
		return openConversation(navigate, target.id, "open", ticket);
	};
	const select = async (tab: WorkspaceTab) => {
		closeHandoff.current = null;
		const intent = {};
		tabIntent.current = intent;
		if ((await open(tab)) && tabIntent.current === intent) {
			if (
				sameWorkspaceTarget(
					targetOf(useCanonicalSessionsStore.getState()),
					tab.target,
				)
			)
				setFocusRequested(true);
		}
	};
	const close = (tab: WorkspaceTab) => {
		closeHandoff.current = null;
		const ticket = {};
		tabIntent.current = ticket;
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
				tabIntent.current === ticket &&
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
		const opened = open(next, ticket);
		const state = useCanonicalSessionsStore.getState();
		if (
			opened === false ||
			tabIntent.current !== ticket ||
			!sameWorkspaceTarget(targetOf(state), next.target)
		)
			return;
		setFocusRequested(true);
		if (next.target.kind === "draft") {
			drop(tab.key);
			return;
		}
		// openConversation commits the selection and URL in this gesture; its
		// promise only acknowledges that optimistic write. Arm synchronously so a
		// replacement cannot be mistaken for this close after an async boundary.
		closeHandoff.current = { from: tab.key, to: next.target.id, ticket };
		settleClose(state);
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
