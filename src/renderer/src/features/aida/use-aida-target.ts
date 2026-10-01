/**
 * Aida's control plane: the read, the control op, and the one open.
 *
 * WHY ONE MODULE, when three surfaces ask questions about her. The rail's row
 * ("should she be offered, and where does she live"), the row's own press and
 * the composer's `/aida` ("open her, and for the command, address the text that
 * follows") are one flow through one route pair (`aida.status` / `aida.control`,
 * frozen in `design.md` § 4). Split across the surfaces, the capability gate,
 * the session resolution and the failure sentence each get two spellings, and
 * the one that matters is the resolution: a second open written anywhere else is
 * a second thing that can forget the cached null is stale.
 *
 * THE CAPABILITY IS PASSED IN, NOT READ HERE. `features.aida` gates whether the
 * route may be called AT ALL (§ 3.4: "0/absent ⇒ no row, no command handling;
 * UI must not call the route below"), and a hook that resolved its own gate
 * could re-open a door a caller deliberately closed. Callers read
 * `desktopFeatureEnabled(capabilities, "aida", 1)` and pass the answer.
 *
 * The pure half — the reserved words of `/aida` and the sentences of its
 * receipts and refusals — lives in `aida-control.ts`.
 */

import { openConversation } from "@features/chat/open-conversation";
import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { NavigateFunction } from "react-router-dom";
import type {
	DesktopAidaControlResult,
	DesktopAidaState,
} from "../../../../shared/desktop-control-contract";
import type { AidaControlAction } from "./aida-control";

/**
 * The read's cache key. One key for one document, so every reader (the rail and
 * the dispatcher) shares the answer and a control's invalidation reaches both.
 */
export const aidaStatusKey = ["desktop", "aida"] as const;

/**
 * The REGISTRY name of her seat: the attachment key, never a label.
 *
 * The Agents view lists her like any other role, under the name the registry
 * knows her by, and that name is what the profile routes address her with — so
 * the roster, the detail pane and the receipts all keep addressing her by it
 * while PRINTING whatever `useAidaDisplayName` answers. Measured on the
 * operator's install (core's `agent_profiles.py`): the row is the `aida` row,
 * whatever she is called.
 */
export const AIDA_SEAT_NAME = "aida";

/**
 * Her display name, for the surfaces that print it.
 *
 * WHY THIS IS A READ AND NOT A STRING. The name is the operator's
 * (`local_operator.aida.naming`), the desktop publishes it on `aida.status`
 * (`DesktopAidaState.name`), and the sidebar's seat row already renders it from
 * that field. The Agents view lists the same seat, so it reads the same field
 * rather than printing the registry key: a roster row saying `aida` beside a
 * rail row saying the configured name is one agent wearing two names.
 *
 * THE FALLBACK IS THE SHIPPED DEFAULT, not a literal this module invents: an
 * absent field (a backend older than the rename slice), a null, or the read
 * still in flight all answer "Aida", exactly as the seat row does.
 */
export function useAidaDisplayName(): string {
	const capabilities = useDesktopCapabilities();
	const aida = useAidaTarget(
		desktopFeatureEnabled(capabilities.data, "aida", 1),
	);
	return aida.data?.name ?? "Aida";
}

/**
 * The name to PRINT for a row: her configured name for her seat, its own for
 * every other row.
 *
 * Split as a pure function because two surfaces need the same decision (the
 * roster's rows and the open record's heading, plus the receipt a switch shows)
 * and a second inline ternary is how one of them drifts.
 */
export function displayNameFor(registryName: string, aidaName: string): string {
	return registryName === AIDA_SEAT_NAME ? aidaName : registryName;
}

/**
 * Her control state, read while the caller's capability gate is open.
 *
 * THE READ NEVER CREATES (§ 4): `session_id` is null until someone ensures her,
 * which is why the open flow below is the only writer of the id and why a null
 * here is a normal answer rather than an error. `staleTime` is short enough
 * that a pause performed in the TUI is seen on the next reader mount, and the
 * control ops invalidate the key rather than patching it (see `useAidaControl`).
 */
export function useAidaTarget(enabled: boolean) {
	return useQuery({
		queryKey: aidaStatusKey,
		queryFn: () => desktopResult<DesktopAidaState>({ op: "aida.status" }),
		enabled,
		staleTime: 30_000,
		retry: retryDesktopQuery,
	});
}

/** One control op, unwrapped from the transport. */
export async function requestAidaControl(
	action: AidaControlAction,
): Promise<DesktopAidaControlResult> {
	return desktopResult<DesktopAidaControlResult>({
		op: "aida.control",
		action,
	});
}

/**
 * The control op, with the shared cache kept honest.
 *
 * THE INVALIDATION IS NOT TIDINESS. `aida.status` is one document read by two
 * surfaces; `open` is the only writer of `session_id` and `pause`/`resume` the
 * only writers of `paused`, so a control whose answer we hold while the cached
 * read still says `null` (or the old pause state) leaves the NEXT reader — the
 * row, a second press, the dispatcher — acting on a fact the backend has
 * already replaced. Invalidating rather than patching keeps the route the one
 * source of the document.
 */
export function useAidaControl() {
	const queryClient = useQueryClient();
	return useCallback(
		async (action: AidaControlAction): Promise<DesktopAidaControlResult> => {
			const state = await requestAidaControl(action);
			void queryClient.invalidateQueries({ queryKey: aidaStatusKey });
			return state;
		},
		[queryClient],
	);
}

/**
 * Resolve her session id, ensuring on first use.
 *
 * The cached read's `session_id` is used when it exists (the common press on a
 * backend where she already lives); otherwise `open` ensures and answers with
 * the id. `open` is idempotent server-side, so a stale cached null costs one
 * POST and can never create a second conversation — the single-session rule is
 * the backend's, not this module's.
 */
export function useAidaResolver() {
	const control = useAidaControl();
	return useCallback(
		async (known: DesktopAidaState | undefined): Promise<string> => {
			const existing = known?.session_id ?? null;
			const created = existing ? null : await control("open");
			const sessionId = existing ?? created?.session_id ?? null;
			if (!sessionId) {
				/*
				 * A 200 whose `open` produced no session id. Unreachable by the
				 * contract (`open` ensures), and stated as a failure rather than
				 * navigated on: `/chat/null` would be a pane showing nothing, which
				 * is the dead end the honest error a toast renders avoids.
				 */
				throw new Error("Aida's conversation could not be opened.");
			}
			return sessionId;
		},
		[control],
	);
}

/**
 * Resolve her session and move the view onto it — the sidebar row's whole press.
 *
 * THE ORDER (resolve → open) is the same one the composer's `/aida <text>` needs
 * between its three steps, and it is stated once here: a caller that opened the
 * conversation FIRST and then sent cannot — `openSession` commits a validation
 * window the send store refuses to write through (`isSessionUnvalidated`), so a
 * message admitted behind the switch is rejected by the app's own guard for the
 * whole read window. The composer therefore resolves, ADMITS, then opens
 * (`slash-dispatch.ts`), and this hook is the resolve-then-open tail both
 * surfaces share (the composer reaches the same tail one line later, after its
 * admission).
 */
export function useAidaOpener() {
	const resolve = useAidaResolver();
	return useCallback(
		async (
			navigate: NavigateFunction,
			known: DesktopAidaState | undefined,
		): Promise<string> => {
			const sessionId = await resolve(known);
			void openConversation(navigate, sessionId);
			return sessionId;
		},
		[resolve],
	);
}
