import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { getCurrentPath } from "@shared/utils/path-utils";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { NavigateFunction } from "react-router-dom";
import { openConversation } from "../open-conversation";
import {
	type WorkspaceTab,
	makeWorkspaceTab,
	moveWorkspaceTab,
	sameWorkspaceTarget,
	saveWorkspaceTabsWithTitles,
	savedWorkspaceTabsDiffer,
	savedWorkspaceTitle,
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
	const removeInactive = useCallback(
		(keys: ReadonlySet<string>, stillCurrent: () => boolean) => {
			// Only a matching expiry reply takes this synchronous path. React can
			// cache an eager updater before commit; commit the strip and its layout-
			// effect preference write before input, feed, or opt-out can interleave.
			flushSync(() => {
				if (
					!stillCurrent() ||
					!useUiPreferencesStore.getState().workspaceAutoClose
				)
					return;
				const active = targetOf(useCanonicalSessionsStore.getState());
				// Keep the updater pure if React replays it over earlier tab actions.
				setTabs((items) =>
					items.filter(
						(tab) =>
							!keys.has(tab.key) ||
							tab.pinned ||
							sameWorkspaceTarget(tab.target, active),
					),
				);
			});
		},
		[],
	);
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

	/*
	 * EVERY REAL NAME A TAB HAS SHOWN THIS RUN, keyed by tab key. The strip
	 * records the open conversation's real header title and each catalogue row
	 * it saw here (`rememberTitle`), so a tab whose row later falls off the head
	 * page - activity reordering, the operator's mid-session "New chat" husks -
	 * keeps the name it showed. It lives in the hook rather than the page so a
	 * newly seen header title also re-saves (`seenRevision`): a conversation
	 * below page one has no catalogue row, and the header is its only name
	 * (QA #2099 Q1C-F1).
	 */
	const titles = useRef<Record<string, string>>({});
	const [seenRevision, setSeenRevision] = useState(0);
	const rememberTitle = useCallback((key: string, text: string | null) => {
		const title = savedWorkspaceTitle(text);
		if (!title || titles.current[key] === title) return;
		titles.current[key] = title;
		setSeenRevision((revision) => revision + 1);
	}, []);

	/*
	 * Re-save when the catalogue or a seen title changes too, not only the
	 * strip: that is how a tab's remembered title follows a rename or the first
	 * answer, so the NEXT launch draws real names before any page lands. A tab
	 * whose row is absent from the current page never has its saved title
	 * overwritten with nothing (`saveWorkspaceTabsWithTitles` states the order).
	 */
	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	useLayoutEffect(() => {
		void seenRevision;
		const store = useUiPreferencesStore.getState();
		const saved = saveWorkspaceTabsWithTitles(tabs, {
			rows: new Map(sessions.map((row) => [row.session_id, row.title])),
			seen: titles.current,
			prior: store.workspaceTabs,
		});
		if (savedWorkspaceTabsDiffer(saved, store.workspaceTabs)) {
			store.setWorkspaceTabs(saved);
		}
	}, [tabs, sessions, seenRevision]);

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
	// `among` lets a bulk close reuse this exact handoff: the successor is picked
	// from the tabs that survive the bulk close, never one it is removing.
	const close = (tab: WorkspaceTab, among: readonly WorkspaceTab[] = tabs) => {
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
		const next = workspaceNeighbor(among, tab.key);
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
		titles: titles.current,
		rememberTitle,
		focusRequested,
		focusHandled,
		select,
		close,
		/**
		 * Bulk close (others/left/right/all). Inactive tabs only leave the strip
		 * (as a single inactive close does); the active one, if included, goes
		 * through `close` so navigation, the confirmed-open handoff and the
		 * no-successor draft fallback stay one implementation.
		 */
		closeMany: (keys: readonly string[]) => {
			const closing = new Set(keys);
			const current = targetOf(useCanonicalSessionsStore.getState());
			const active = tabs.find(
				(tab) =>
					closing.has(tab.key) && sameWorkspaceTarget(tab.target, current),
			);
			const keep = (tab: WorkspaceTab) =>
				!closing.has(tab.key) || tab.key === active?.key;
			setTabs((items) => items.filter(keep));
			if (active) close(active, tabs.filter(keep));
			else setFocusRequested(true);
		},
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
