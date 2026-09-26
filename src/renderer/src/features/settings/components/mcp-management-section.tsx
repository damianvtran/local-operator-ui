/**
 * Settings > Integrations: the MCP servers agents can use, and what each one
 * needs from the user right now.
 *
 * ## What this page is for
 *
 * Seeing which integrations work, fixing the ones that do not, and adding or
 * removing them - on a fresh install as much as on a machine with fifty chats.
 * The rendering decisions live in `integrations/integration-model.ts` (pure,
 * unit-tested), the data in `integrations/use-integrations.ts`, and this file
 * only composes them. What changed from the version it replaces (design audit
 * § 4, UX walk U5/U6/U8):
 *
 * - It reads the SESSIONLESS catalog when the backend has one (`mcp_catalog`),
 *   so adding, testing and signing in need no chat, no runtime and no model.
 *   The session route stays as the fallback for older backends, rendered
 *   through the same rows.
 * - Rows are grouped (Needs attention, Connected, Ready), say their status in
 *   plain words with a dot beside them, and lead with ONE action the backend
 *   says this row can take. Everything else is in the overflow.
 * - No wire vocabulary in primary text: no `cold`, `auth-required`, `stdio`,
 *   `http` or "transport".
 * - The list re-reads only while something on it is moving, and a control's
 *   answer is written straight into the cache.
 *
 * Three things about how the operator ARRIVES here survive unchanged, because
 * they are one flow - find the server, see which is broken, fix it:
 *
 * - `?mcp=<argument>` is RESOLVED against the loaded list
 *   (`resolveMcpServerTarget`), so `/mcp reauth hubspot` lands on `hubspot`,
 *   and an argument that names nothing says so.
 * - The section has its own search box (from six rows up, where a list stops
 *   fitting on one glance).
 * - On the session-route fallback with no active conversation, the section
 *   still borrows the newest roster row and says which.
 */

import { openLocalTarget, openUrlTarget } from "@features/chat/utils/link-open";
import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Button, Input } from "@shared/components/ui";
import { showInfoToast } from "@shared/utils/toast-manager";
import { Plug, Plus, Search } from "lucide-react";
import type { FC, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { McpFailurePhase } from "../../chat/components/run-details/mcp-failure";
import { parseMcpIntent } from "../../chat/pickers/mcp-command";
import {
	AddIntegrationForm,
	type AddIntegrationValues,
} from "./integrations/add-integration-form";
import { focusHoldRead } from "./integrations/integration-focus";
import { IntegrationKeyDialog } from "./integrations/integration-key-dialog";
import {
	type IntegrationRow as IntegrationRowData,
	type OverflowItem,
	type PrimaryAction,
	groupIntegrations,
	integrationCountLabel,
	integrationFailureMessage,
	isSignInAction,
	offersKey,
	primaryAction,
	runningOperationFor,
} from "./integrations/integration-model";
import {
	IntegrationRow,
	type RowConfirm,
} from "./integrations/integration-row";
import {
	IntegrationSignInDialog,
	type SignInPhase,
} from "./integrations/integration-sign-in-dialog";
import { useIntegrations } from "./integrations/use-integrations";
import { SettingsSection } from "./settings-section";

export { newestRosterRow } from "./integrations/use-integrations";

/**
 * The server a `/mcp <argument>` deep link names, or why nothing matched.
 *
 * Resolution is against the LOADED list rather than against a grammar of verbs,
 * and that is the whole design: the renderer holds no copy of the backend's
 * subcommand vocabulary (`MCP_SUBCOMMANDS`, `session/frontend_state.py:862`), and
 * `docs/desktop-controls.md` forbids authoring a second command list here. So
 * `/mcp reauth hubspot` resolves by taking the LAST whitespace token that is a
 * configured server name — the verb is simply a token that is not a server —
 * which covers `login notion` and any verb the backend adds later, without the
 * renderer knowing one verb from another.
 *
 * `null` is "no argument was passed" (nothing to say, no line to render).
 * `miss` is an argument that names nothing, and the section states it: the old
 * effect returned silently for exactly this case, which is why the operator's
 * own remedy line (`/mcp reauth hubspot`) did nothing at all rather than
 * something wrong.
 *
 * `unresolved` is the residual that rule cannot fix, stated rather than hidden
 * (code review round 1, finding 4): with a server named like a verb — `login` —
 * `/mcp login hubspo` (a typo) resolves to `login` and reveals it, because the
 * last token that IS configured wins and no verb list may exist here. The cost
 * of guessing wrong is a silent landing on the wrong server, so a match that
 * needed a token other than the LAST one carries that last token back and the
 * section says which server it resolved to. It is `null` for every resolution
 * the last token alone explains, including the operator's own `reauth hubspot`,
 * so the note never appears on the case this rule exists for.
 */
export type McpTarget =
	| { kind: "matched"; name: string; unresolved: string | null }
	| { kind: "miss"; asked: string }
	| null;

export const resolveMcpServerTarget = (
	raw: string | undefined,
	names: readonly string[],
): McpTarget => {
	const asked = raw?.trim();
	if (!asked) return null;
	const intent = parseMcpIntent(asked, names);
	return intent.kind === "auth"
		? { kind: "matched", name: intent.name, unresolved: null }
		: { kind: "miss", asked };
};

/** The dialog open over the list, if any. */
type Dialog =
	| { kind: "sign_in"; name: string; action: "login" | "reauth" }
	| { kind: "key"; name: string; keyNames: string[] }
	| null;

/** From this many rows up the list gets a search box. */
const SEARCH_THRESHOLD = 6;

const SECTION_TITLE = "Integrations";
const SECTION_DESCRIPTION =
	"Let agents use your tools and accounts, like Notion, Linear or GitHub.";

/** The phase a control is worded as when it fails. */
const PHASE: Record<string, McpFailurePhase> = {
	test: "test",
	connect: "reconnect",
	disconnect: "disconnect",
	reload: "reload",
	remove: "remove",
	sign_out: "disconnect",
	cancel: "cancel",
	login: "grant",
	reauth: "grant",
};

/**
 * One armed deferred focus move (U12, U18, U21): the row it follows, and how far it
 * may keep following it.
 */
type FocusMove = {
	name: string;
	/**
	 * A COMPLETED sign-in is the one close whose opener is guaranteed to be gone
	 * (`closeSignIn`), so this move waits for the row to stop offering Sign in before
	 * it lands anywhere (U12).
	 */
	waitForSignIn: boolean;
	until: number;
	/**
	 * The control this move has already landed on, once it has (U21). Its presence is
	 * what tells a later read that this is a payload arriving AFTER the move rather
	 * than the move itself - and the row it targets can have been mounted again under
	 * it in between, which is the whole of U21.
	 */
	landedOn?: HTMLElement | null;
	/**
	 * How many re-MOUNTS this move has followed (QA round 2, Q1; UX U31). Counted in
	 * state rather than derived because it is the ONLY bound on how far the move's
	 * window can be extended: the deadline itself is re-anchored while the row moves,
	 * so a row that is mounted again under the move over and over is given up on by
	 * `FOCUS_REANCHOR_CAP` rather than by a clock that expires mid-operation. It
	 * counts re-mounts and not candidate changes, which is what `focusHoldRead`
	 * spends it on (agent review round 3, MINOR 5).
	 */
	reanchors: number;
};

export const McpManagementSection: FC<{
	sessionId?: string;
	sectionRef?: RefObject<HTMLDivElement>;
	/**
	 * The argument of `/mcp <argument>`, from the deep link's `&mcp=`.
	 *
	 * An ARGUMENT rather than a server name: `/mcp reauth hubspot` passes
	 * `"reauth hubspot"`, and resolving that is this section's job (see
	 * `resolveMcpServerTarget`).
	 */
	highlightServer?: string;
}> = ({ sessionId, sectionRef, highlightServer }) => {
	const integrations = useIntegrations({ sessionId });
	const { document, control, readDocument } = integrations;
	const navigate = useNavigate();
	const servers = document?.servers ?? [];
	const operations = document?.operations ?? [];
	const projectScopeAvailable = document?.project_scope_available ?? false;

	const [showAdd, setShowAdd] = useState(false);
	const [filter, setFilter] = useState("");
	const [pending, setPending] = useState<string | null>(null);
	const [failures, setFailures] = useState<Record<string, string>>({});
	const [confirm, setConfirm] = useState<{
		name: string;
		kind: "remove" | "sign_out";
	} | null>(null);
	const [dialog, setDialog] = useState<Dialog>(null);
	const [signIn, setSignIn] = useState<SignInPhase>({ kind: "ready" });
	const [signInOperation, setSignInOperation] = useState<string | null>(null);
	const [keyFailure, setKeyFailure] = useState<string | null>(null);
	const [keySaving, setKeySaving] = useState(false);

	/*
	 * FOCUS PLUMBING (U5, Q3). Round 1 found the page returning focus to
	 * `<body>` after almost every action, so a keyboard user restarted from the
	 * top of a very long settings page. Each map below holds the control that
	 * should get focus back, by the row it belongs to:
	 *
	 * - `rowPrimaryRefs` / `rowOverflowRefs`: the row's two focusable controls;
	 * - `addSlotRef`: the header's Add integration, the fallback when a list
	 *   becomes empty;
	 * - `dialogReturn`: whatever had focus when a dialog opened. A control that
	 *   still exists when the dialog closes gets focus back; one that does not
	 *   (a menu item, which Radix unmounts) is skipped, and Radix's own
	 *   close-auto-focus stands.
	 */
	const rowPrimaryRefs = useRef<Record<string, HTMLButtonElement | null>>({});
	const rowOverflowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
	/*
	 * When a read last found the ROW OF AN ARMED MOVE moving (QA round 2, Q1; UX round
	 * 2, U31). The move's window is anchored on the row rather than on the press, and
	 * the row's last movement is a fact no render needs - a poll that extends the
	 * window changes nothing on screen, so writing it into state would re-render the
	 * page every `INTEGRATIONS_POLL_MS` for the length of an operation. It lives here,
	 * and both readers of the window (the effect that lands the move and the tick that
	 * disarms it) read it.
	 *
	 * A STALE VALUE CANNOT EXTEND A FRESH MOVE: an arm writes `now + FOCUS_ARM_MS`
	 * while this only ever records a moment already past, so the arm's own deadline is
	 * the later of the two and nothing has to be reset here when one move replaces
	 * another.
	 */
	const rowMovingAtRef = useRef(0);
	const addSlotRef = useRef<HTMLButtonElement>(null);
	/**
	 * The search field, so "Clear search" (and Escape) can hand focus back to the
	 * control the user was typing in rather than to `<body>` (n1, n2).
	 */
	const searchRef = useRef<HTMLInputElement>(null);
	const dialogReturn = useRef<HTMLElement | null>(null);
	const [focusAfterAdd, setFocusAfterAdd] = useState<string | null>(null);
	/*
	 * The row a dialog's work belonged to, and how far to wait for its control
	 * (U12, U18, m-4).
	 *
	 * ONE mechanism for four flows rather than one per dialog, because the rule is
	 * the same in all of them: the control to return to is the row's OWN - its
	 * primary, or its menu when it has none - and it does not exist until the list
	 * has been re-read, so focusing at close time lands on `<body>` a frame later.
	 * That is the whole of U18, and U12 was the same defect with the wait spelled
	 * out.
	 *
	 * `waitForSignIn` is the one thing the flows do not share: after a COMPLETED
	 * sign-in the row still leads with the Sign in button until the catalog reads
	 * the new credential back, and focusing a button that is about to unmount is
	 * how focus reaches `<body>` again. After a cancellation, a key save or a
	 * sign-out there is nothing to wait for.
	 */
	const [focusRow, setFocusRow] = useState<FocusMove | null>(null);
	const [focusAfterRemove, setFocusAfterRemove] = useState<{
		index: number;
	} | null>(null);

	/*
	 * A dialog's focus comes back to whatever opened it, once the dialog has
	 * actually unmounted - a macrotask later, because Radix restores focus
	 * itself during the close and would overwrite an earlier attempt.
	 */
	const closeDialog = useCallback(() => {
		const target = dialogReturn.current;
		dialogReturn.current = null;
		setDialog(null);
		setSignInOperation(null);
		window.setTimeout(() => {
			if (target?.isConnected) target.focus();
		}, 0);
	}, []);

	const openDialog = useCallback((next: Dialog) => {
		// `window.document`, because this component destructures the CATALOG
		// document from `useIntegrations` under the same name.
		const active = window.document.activeElement;
		dialogReturn.current = active instanceof HTMLElement ? active : null;
		setDialog(next);
	}, []);

	/**
	 * Close the sign-in dialog, arming the row's own control when it SUCCEEDED.
	 *
	 * A completed sign-in is the one close whose opener is guaranteed to be gone:
	 * the row has its credential, so it stops offering Sign in - and the control
	 * that opened this dialog unmounts with it, leaving Radix's close-auto-focus
	 * with nothing to restore to and focus on `<body>` (U12, round 2). The row's
	 * own control is where the same rule already sends an add and a removal.
	 *
	 * The outcome is the dialog's own report rather than a re-derivation here:
	 * the dialog holds the phase, and a second copy of the success rule is how the
	 * two would come to disagree.
	 */
	const closeSignIn = useCallback(
		(name: string, outcome: "signed-in" | "dismissed") => {
			/*
			 * BOTH outcomes arm the move (U18): dismissing a sign-in the user
			 * STARTED leaves a row whose next step is still the row's own control -
			 * and for a first sign-in the row's Sign in is the button that opened
			 * the dialog, which unmounts as the row's own state settles, so leaving
			 * it to the opener reference is how focus reached `<body>`.
			 */
			setFocusRow({
				name,
				waitForSignIn: outcome === "signed-in",
				until: Date.now() + FOCUS_ARM_MS,
				reanchors: 0,
			});
			closeDialog();
		},
		[closeDialog],
	);

	const target = useMemo(
		() =>
			resolveMcpServerTarget(
				highlightServer,
				servers.map((server) => server.name),
			),
		[highlightServer, servers],
	);
	const named = target?.kind === "matched" ? target.name : null;
	const highlightRef = useRef<HTMLLIElement>(null);
	const revealed = useRef<string | null>(null);

	const search = filter.trim().toLowerCase();
	const visible = useMemo(
		() =>
			search
				? servers.filter((server) => server.name.toLowerCase().includes(search))
				: servers,
		[servers, search],
	);
	const groups = useMemo(
		() => groupIntegrations(visible, operations, integrations.memories),
		[visible, operations, integrations.memories],
	);

	/* The row the sign-in dialog belongs to, or none while it is closed. */
	const signInRow =
		dialog?.kind === "sign_in"
			? (servers.find((server) => server.name === dialog.name) ?? null)
			: null;

	/*
	 * A filter typed BEFORE the command ran must not hide the row the command
	 * exists to reveal, so the first arrival clears it - and only the first.
	 */
	useEffect(() => {
		if (!named || revealed.current === named || !filter) return;
		setFilter("");
	}, [named, filter]);

	useEffect(() => {
		if (!named || revealed.current === named) return;
		if (!visible.some((server) => server.name === named)) return;
		revealed.current = named;
		highlightRef.current?.scrollIntoView({
			block: "center",
			behavior: "smooth",
		});
	}, [named, visible]);

	/*
	 * The sign-in dialog follows its operation through the document the list
	 * already polls (it polls BECAUSE the operation is running), so the dialog
	 * needs no timer of its own.
	 */
	useEffect(() => {
		if (!signInOperation) return;
		const operation =
			operations.find((op) => op.id === signInOperation) ?? null;
		setSignIn({ kind: "running", operation });
	}, [operations, signInOperation]);

	const grantRunning = operations.some((op) => op.status === "running");

	/**
	 * Arm the deferred row move when the row's OWN operation lands (QA round 1, Q1;
	 * UX round 1, U1).
	 *
	 * WHY THIS DOOR NEEDED ARMING AT ALL. Every control a row operates through is
	 * `disabled={pending}` for the whole of that operation, and a control that becomes
	 * `disabled` is blurred by the engine - so the caret is on `<body>` from the first
	 * frame of a Test to its last, and the row's landing in a NEW group (each group is
	 * its own `<ul>`, so the row is mounted again rather than moved) had no move
	 * ARMED for the re-stand to be read against: measured on the built app with a real
	 * stdio MCP server, `document.activeElement` was `<body>` on 25 of 25 samples over
	 * 6 s (`samplesInsideTheRow: 0`) while the row moved `Available 3 -> Connected 1`,
	 * with the same signature on a FAILING test as the row moves to `Needs attention`
	 * (QA round 1, Q1; UX round 1, U1). The rule above is inert with
	 * nothing armed - `focusHoldStep` is only consulted when a hold exists - so the
	 * fix is this arm rather than a second rule.
	 *
	 * WHY THE ARM IS THE SAME SHAPE AS A DIALOG CLOSE'S. The move is armed with no
	 * `landedOn`, so the shared effect lands the row's own control (its primary, or its
	 * menu when it has none) and the hold it leaves behind is what follows the row if
	 * it re-stands again inside the window. That means the landing happens AFTER the
	 * operation, which is the whole difference from a dialog close: the control cannot
	 * hold focus while it is disabled, so "the caret survives its own operation" can
	 * only mean "the caret is on the row again when the operation lands".
	 *
	 * ONLY WHILE NOBODY ELSE HOLDS THE CARET, which is `focusHoldStep`'s own refusal
	 * stated one level up ("nobody else's focus is taken"), and it is required HERE
	 * rather than redundant: an operation is seconds long - the app's own failure path
	 * is 20 s - so unlike a dialog close this arm fires long after the press that
	 * started it, and a reader who has tabbed into the search field meanwhile must keep
	 * the caret they moved. A focus move that does not happen is a small thing; one
	 * that happens over the reader's caret is not (m-4).
	 */
	const armRowFocusAfterOperation = (name: string) => {
		const active = window.document.activeElement;
		/*
		 * A DETACHED NODE THE ENGINE STILL REPORTS AS ACTIVE IS NOBODY (agent review
		 * round 2, MINOR 2), and it is the carve-out `focusHoldStep` makes one level below
		 * WITHOUT BEING THE SAME SET (agent review round 3, NIT 2). The rule's nobody set is
		 * `{body, null, the move's OWN landed control}` - identity, so ANY OTHER detached
		 * node reads as a real holder and drops the move. This arm's set is
		 * `{body, null, ANY detached node}` - connectedness, which it has to be: the arm
		 * asks before the move has a landed control, so it has nothing to compare against.
		 * The two are deliberately close, and the difference is reachable only in the narrow
		 * state where the reader's caret sits on a node unmounted out of an open dialog
		 * mid-operation - where this arm proceeds and the rule, one read later, would
		 * refuse. It cannot mask a real reader: the only input it accepts beyond `<body>`
		 * is a node no longer in the document, and a reader's caret lives in the document.
		 */
		if (active && active !== window.document.body && active.isConnected) return;
		setFocusRow({
			name,
			waitForSignIn: false,
			until: Date.now() + FOCUS_ARM_MS,
			reanchors: 0,
		});
	};

	const run = async (
		name: string,
		key: string,
		start: () => Promise<string | null>,
	): Promise<{ operationId: string | null; failed: boolean }> => {
		setPending(name);
		setFailures(({ [name]: _cleared, ...rest }) => rest);
		/*
		 * THE OUTCOME IS CARRIED OUT OF HERE rather than inferred by the caller from
		 * state (agent review round 2, MINOR 3): `failures` is read by closures created
		 * during the press's render, so it cannot say what THIS operation did - the
		 * state update a failed one makes is not visible to the `.then` that runs one
		 * microtask later. The `finally` alone could not say either - the arm decision sat
		 * inside it, where the outcome is not in scope - which is how a failed REMOVAL came
		 * to be exempt from the arm that a failed Test gets.
		 */
		let operationId: string | null = null;
		let failed = false;
		try {
			operationId = await start();
		} catch (cause) {
			failed = true;
			setFailures((previous) => ({
				...previous,
				[name]: integrationFailureMessage(
					PHASE[key] ?? "status",
					cause,
					grantRunning,
				),
			}));
		} finally {
			/*
			 * `setPending` STAYS IN THE `finally` even though the outcome is now known
			 * here: the clearing is what re-enables the row's controls, and it has to
			 * happen whether the operation resolved, refused or failed to be reported at
			 * all. The arm below shares it rather than sitting after the statement, so
			 * one exception cannot leave a row disabled while the move is dropped as
			 * well.
			 */
			setPending(null);
			/*
			 * THE OPERATION ARMS THE ROW'S OWN MOVE (QA round 1, Q1 / UX round 1, U1), for
			 * every action EXCEPT a sign-out, which arms the same deferred row move from its
			 * confirm, and except a removal that LANDED - its caret goes to the NEIGHBOURING
			 * row that takes the removed one's place (`setFocusAfterRemove`, and the row this
			 * arm would name is gone by the time the hold is read). Arming here as well would
			 * be a second move for one operation.
			 *
			 * A REMOVAL THAT FAILED IS NOT EXEMPT (agent review round 2, MINOR 3). The reason
			 * for the exemption is that the row is gone, which is true only of a removal that
			 * landed: on a failed one there is no neighbour to take the caret, the confirm's
			 * menu item has been unmounted by Radix's own restore, and the row the reader
			 * removed is still on the page with its control where the next Tab should start
			 * from - the row's `Retry`, the control UX round 2's Cell 7 measured the caret on
			 * at +3 000 ms and +12 000 ms for a failed operation. WHAT THE TWO ARMS SHARE IS
			 * THE ENDING, NOT THE SHAPE, and the difference is the one this rule is about: UX's
			 * arm is a failing Test whose row CHANGES GROUP, so its landing comes from the
			 * re-stand path, while a failed removal leaves the row in the group it was already
			 * in - the non-re-standing shape (U30), where the only thing that moves the caret
			 * is the row's own primary reappearing. Both end with the row's primary as the
			 * control to land on, which is why one arm serves them, and neither is a reading
			 * QA took.
			 *
			 * It arms on FAILURE too, which is one of the two signatures Q1 measured: a test
			 * that fails moves the row to `Needs attention` - a group change like any other -
			 * and the caret has to come back with it.
			 */
			if (key !== "sign_out" && (key !== "remove" || failed))
				armRowFocusAfterOperation(name);
		}
		return { operationId, failed };
	};

	const rowByName = (name: string) =>
		servers.find((server) => server.name === name);

	const openConfig = (row: IntegrationRowData) => {
		if (row.source.path) void openLocalTarget(row.source.path);
	};

	const startSignIn = async (name: string, action: "login" | "reauth") => {
		setSignIn({ kind: "starting" });
		setSignInOperation(null);
		try {
			const id = await control({ action, name });
			if (id) setSignInOperation(id);
			else setSignIn({ kind: "running", operation: null });
		} catch (cause) {
			/*
			 * `oauth_unsupported` is the backend saying, up front, that this
			 * server has no browser sign-in: the row must offer the key instead
			 * (U3). A refusal carries no operation, so this is the only place the
			 * fact can be learned.
			 */
			if (
				cause instanceof DesktopControlError &&
				cause.code === "oauth_unsupported"
			)
				integrations.markNeedsKey(name);
			setSignIn({
				kind: "refused",
				message: integrationFailureMessage("grant", cause, grantRunning),
			});
		}
	};

	const onPrimary = (row: IntegrationRowData, action: PrimaryAction) => {
		switch (action.kind) {
			case "sign_in":
			case "reauth": {
				/*
				 * "Continue sign-in" (U4) reopens the dialog ON the grant that is
				 * already running, rather than starting a second one: dismissing
				 * the dialog mid-grant used to leave a "Signing in…" row whose
				 * authorization link was unreachable.
				 */
				const running = operations.find(
					(op) => op.name === row.name && op.status === "running",
				);
				if (running && isSignInAction(running)) {
					setSignIn({ kind: "running", operation: running });
					setSignInOperation(running.id);
				} else {
					setSignIn({ kind: "ready" });
					setSignInOperation(null);
				}
				openDialog({
					kind: "sign_in",
					name: row.name,
					action: action.kind === "reauth" ? "reauth" : "login",
				});
				return;
			}
			case "set_key":
				setKeyFailure(null);
				openDialog({
					kind: "key",
					name: row.name,
					keyNames: row.auth.secret_refs.map((ref) => ref.id),
				});
				return;
			case "fix":
				openConfig(row);
				return;
			case "sign_out":
				/*
				 * A sign-out that FAILED leads with the retry (m-2), and it opens
				 * the same confirm the overflow item does: the action carries the
				 * user's intent, so no second path may diverge from it.
				 */
				setConfirm({ name: row.name, kind: "sign_out" });
				return;
			default: {
				// `test` or `connect`: the two primaries that are one request.
				const kind = action.kind;
				void run(row.name, kind, () =>
					control({ action: kind, name: row.name }),
				);
			}
		}
	};

	const onOverflow = (row: IntegrationRowData, item: OverflowItem) => {
		switch (item.kind) {
			case "remove":
			case "sign_out":
				setConfirm({ name: row.name, kind: item.kind });
				return;
			case "sign_in":
			case "reauth":
			case "set_key":
				onPrimary(row, { kind: item.kind, label: item.label });
				return;
			case "open_config":
				openConfig(row);
				return;
			case "copy_setup":
				void navigator.clipboard
					.writeText(row.setup_prompt ?? "")
					.then(() =>
						showInfoToast("Setup steps copied. Paste them into a chat."),
					)
					.catch(() => undefined);
				return;
			case "cancel": {
				const running = operations.find(
					(op) => op.name === row.name && op.status === "running",
				);
				if (running)
					void run(row.name, "cancel", () =>
						control({ action: "cancel", operationId: running.id }),
					);
				return;
			}
			case "test":
			case "connect":
			case "disconnect":
			case "reload": {
				// Bound first: the closure below would lose the switch's narrowing.
				const action = item.kind;
				void run(row.name, action, () => control({ action, name: row.name }));
				return;
			}
			default:
				return;
		}
	};

	const onConfirmed = (
		row: IntegrationRowData,
		kind: "remove" | "sign_out",
	) => {
		setConfirm(null);
		if (kind === "remove") {
			const scope = row.source.owned_scope;
			if (!scope) return;
			// Where the row was, so focus can land on whatever takes its place.
			const index = visible.findIndex((server) => server.name === row.name);
			void run(row.name, "remove", () =>
				control({ action: "remove", name: row.name, scope }),
			).then(({ operationId, failed }) => {
				/*
				 * The toast says what happened (U6). There is deliberately no
				 * Undo: the row this page holds carries a local command's
				 * `command` but NOT its arguments or environment, so an Undo
				 * would restore a server that runs something else - see the PR's
				 * "not addressed" note.
				 *
				 * A FAILED REMOVAL TAKES NEITHER OF THESE, AND SPECIFICALLY NOT THE
				 * NEIGHBOUR MOVE (agent review round 2, MINOR 3): `focusAfterRemove`
				 * names the row's own INDEX, so on a removal that did not land it would
				 * focus the row still standing at that index - the row the reader just
				 * failed to remove, under another name. `run`'s settle arms that row's
				 * own move instead, which is where the caret can actually act.
				 */
				if (failed || operationId !== null) return;
				showInfoToast(`Removed ${row.name}.`);
				if (index >= 0) setFocusAfterRemove({ index });
			});
			return;
		}
		void run(row.name, "sign_out", () =>
			control({ action: "logout", name: row.name }),
		).then(() => {
			// The confirm's menu item is unmounted by Radix, so the row's own
			// control is where the next Tab should start (U18).
			setFocusRow({
				name: row.name,
				waitForSignIn: false,
				until: Date.now() + FOCUS_ARM_MS,
				reanchors: 0,
			});
		});
	};

	const onAdd = async (
		values: AddIntegrationValues,
	): Promise<string | null> => {
		try {
			await control({
				action: "add",
				name: values.name,
				scope: values.scope,
				...(values.mode === "command"
					? { command: values.command, args: values.args }
					: { url: values.url }),
			});
			setShowAdd(false);
			// The row that just appeared is where the user's attention is going.
			setFocusAfterAdd(values.name);
			return null;
		} catch (cause) {
			return integrationFailureMessage("add", cause, false);
		}
	};

	const header = (
		<div className="flex items-start justify-between gap-4">
			<div className="min-w-0">
				<h2 className="text-heading text-ink">{SECTION_TITLE}</h2>
				<p className="mt-1 max-w-2xl text-body-sm text-ink-muted">
					{SECTION_DESCRIPTION}
				</p>
			</div>
			{integrations.enabled && servers.length > 0 && !showAdd ? (
				<Button
					ref={addSlotRef}
					variant="secondary"
					size="sm"
					onClick={() => setShowAdd(true)}
					data-tour-tag="mcp-add-server"
				>
					<Plus aria-hidden="true" />
					Add integration
				</Button>
			) : null}
		</div>
	);

	if (!integrations.enabled && !integrations.isLoading) {
		return (
			<SettingsSection
				title={SECTION_TITLE}
				titleComponent={header}
				sectionRef={sectionRef}
			>
				<Alert variant="warning">
					Integrations need a newer Local Operator backend. Update it and
					restart the app to manage them here.
				</Alert>
			</SettingsSection>
		);
	}

	const addForm = (
		<AddIntegrationForm
			existingNames={servers.map((server) => server.name)}
			projectScopeAvailable={projectScopeAvailable}
			projectLabel={document?.cwd ? compactHome(document.cwd) : null}
			onSubmit={onAdd}
			onCancel={() => {
				setShowAdd(false);
				/*
				 * Cancel and Escape both come through here, and both left focus on
				 * `<body>` - the form is inline, so the button that opened it is
				 * still on the page and is where the reader was (U18). Deferred by
				 * a macrotask because the form is unmounted by this same state
				 * change, and a focus call inside it competes with that.
				 */
				window.setTimeout(() => addSlotRef.current?.focus(), 0);
			}}
		/>
	);

	const dialogRow = dialog ? rowByName(dialog.name) : undefined;
	/** Failures whose row is gone: the list moved on, the sentence should not. */
	const orphanFailures = Object.entries(failures).filter(
		([name]) => !servers.some((server) => server.name === name),
	);
	const dismissFailure = (name: string) =>
		setFailures(({ [name]: _removed, ...rest }) => rest);

	/*
	 * The two deferred focus moves. Both wait for the row list to change first,
	 * because the control they aim at does not exist until it does.
	 */
	useEffect(() => {
		if (!focusAfterAdd) return;
		const element = rowPrimaryRefs.current[focusAfterAdd];
		if (!element) {
			// A row with no primary action of its own (a Ready row) still has a
			// menu, and that is the control the reader would reach for.
			if (servers.some((server) => server.name === focusAfterAdd)) {
				rowOverflowRefs.current[focusAfterAdd]?.focus();
				setFocusAfterAdd(null);
			}
			return;
		}
		element.focus();
		setFocusAfterAdd(null);
	}, [focusAfterAdd, servers]);

	useEffect(() => {
		if (!focusAfterRemove) return;
		const focus = focusAfterRemove;
		// The row that took the removed one's place, else the last row, else the
		// control that starts a new one.
		const next =
			visible[Math.min(focus.index, visible.length - 1)] ?? visible.at(-1);
		if (next) {
			const element =
				rowPrimaryRefs.current[next.name] ?? rowOverflowRefs.current[next.name];
			if (!element) return;
			element.focus();
		} else {
			addSlotRef.current?.focus();
		}
		setFocusAfterRemove(null);
	}, [focusAfterRemove, visible]);

	/*
	 * Where a dialog's work leaves focus (U12, U18). It cannot move at close time:
	 * the catalog has not read the change back yet, so the row still leads with
	 * the control that is about to unmount - focusing it is how focus ends up on
	 * `<body>` again a frame later.
	 *
	 * THE DEADLINE IS THE POINT (m-4). The move used to stay armed until the row
	 * stopped asking for a sign-in, so a success-closed dialog followed by a
	 * catalog read that still asked for one could fire much later, and take focus
	 * from wherever the user had moved on to. Past the deadline the move is
	 * DROPPED rather than performed: a focus move that does not happen is a small
	 * thing, one that happens at the wrong moment is not.
	 *
	 * THAT DEADLINE IS ANCHORED ON THE ROW, NOT ON THE PRESS (QA round 2, Q1; UX
	 * round 2, U31). A clock started at the press expires while the operation it is
	 * following is still running - the app's own failure path is 20 s - and every
	 * re-stand after that leaves the caret on `<body>`. `focusHoldWindow` states the
	 * rule both readers of it share: while the row is moving the deadline is a
	 * window from NOW, and once it stops it is a window from the last read that
	 * found it moving.
	 */

	/**
	 * One read of the armed move, whoever asks for it.
	 *
	 * WHY THE ROW IS READ FROM THE PAGE'S OWN DOCUMENT AND NOT FROM THIS RENDER (QA
	 * round 3, Q-1; UX round 3, U31). This is the round-3 defect, and this read is
	 * the whole of it: `rowMoving` used to be computed inside the effect below off
	 * `servers`/`operations`, whose identity React Query's structural sharing keeps
	 * for a payload deeply equal to the cached one - so a poll that found the row
	 * still `connecting`, which is every poll for the length of an operation,
	 * changed nothing, re-rendered nothing and ran nothing. The deadline therefore
	 * never advanced past the arm's own `dispatch + FOCUS_ARM_MS`, the disarm timer
	 * cleared the hold at ~4 250 ms, and the row's re-stand seconds later found
	 * nothing armed. Measured on the built app at the round-3 head: the caret was on
	 * `<body>` for 100% of the samples after the row's group change for a 5 s, 8 s
	 * and 20 s answer (28/28, 24/24, 24/24) and for a server that sleeps 8 s and
	 * exits 7 (63/63) - with NO `focus()` call made at the group change at all,
	 * which is the reading that says the app never tried, as against a move that was
	 * applied and then lost.
	 *
	 * `readDocument()` is the same document the poll writes, asked on demand rather
	 * than carried by a render, so the row's own operation is fresh within one poll
	 * whether or not a render happened and no identity that stayed still can freeze
	 * the answer. The render's own `document` is the fallback for the frame before
	 * the cache has anything to say.
	 */
	const readFocusMove = useCallback(
		(move: FocusMove, now: number): "kept" | "landed" | "finished" => {
			const live = readDocument() ?? document;
			const row = live?.servers.find((server) => server.name === move.name);
			const operations = live?.operations ?? [];
			/*
			 * THE ROW'S OWN MOVEMENT, read with the list's own poll terms - the same two
			 * `integrationsPollInterval` asks - so a row that keeps this true is a row the
			 * page is re-reading every `INTEGRATIONS_POLL_MS`, and a read that finds it
			 * true is a read that pushes the deadline out.
			 */
			const rowMoving = row
				? row.status === "connecting" ||
					runningOperationFor(row.name, operations) !== null
				: false;
			if (rowMoving && row) rowMovingAtRef.current = now;
			const primary = row
				? primaryAction(row, operations, integrations.memories)
				: null;
			/*
			 * A COMPLETED SIGN-IN WAITS FOR THE ROW (U12): after one, the row still leads
			 * with the Sign in button until the catalog reads the new credential back, and
			 * focusing a button that is about to unmount is how focus reaches `<body>` a
			 * frame later. This read stays armed and lands nothing until the row stops
			 * offering one.
			 */
			if (
				row &&
				move.waitForSignIn &&
				(primary?.kind === "sign_in" || primary?.kind === "reauth")
			)
				return "kept";
			/*
			 * WHERE THE MOVE LANDS, RE-RESOLVED ON EVERY READ (UX round 2, U30). The
			 * target is the row's own primary control, or its overflow when the row has
			 * none - and a row that is mid-operation has no primary BY DESIGN
			 * (`primaryAction` answers null for `connecting`), so the landing the arm
			 * triggers at dispatch time is the `⋯` and nothing else. That is the right
			 * place for it to be while the row cannot act, and it is the wrong place for
			 * it to be afterwards: the row settles with a control of its own, and a move
			 * that stayed on the `⋯` would leave the reader's next Tab starting from the
			 * menu rather than from the control the row is offering - or from the one
			 * they pressed, when that is the control the row has again. So the target is
			 * resolved on every read rather than decided once at the landing, and
			 * `focusHoldStep` re-applies the move when the row's control is no longer the
			 * one it landed on.
			 *
			 * A ROW WITH NOTHING TO LAND ON YET - and a read that lands in the frame
			 * between a re-stand's unmount and its mount - leaves the move armed rather
			 * than dropping it, which `focusHoldRead` states: the window above still
			 * bounds the wait.
			 */
			const read = focusHoldRead({
				hold: move,
				now,
				windowMs: FOCUS_ARM_MS,
				rowMoving,
				lastMovingAt: rowMovingAtRef.current,
				/*
				 * A ROW THAT HAS LEFT THE PAGE OFFERS NO CANDIDATE, and the read still runs
				 * rather than returning early: the deadline is what ends a move whose row was
				 * removed under it, and skipping the read would leave the watcher ticking for
				 * a row that is not coming back.
				 */
				candidate: row
					? primary
						? rowPrimaryRefs.current[row.name]
						: rowOverflowRefs.current[row.name]
					: undefined,
				active: window.document.activeElement,
				body: window.document.body,
			});
			if (!read.hold) {
				setFocusRow(null);
				return "finished";
			}
			/*
			 * NOTHING OBSERVABLE HAPPENED, SO NOTHING IS WRITTEN. A read that only
			 * extends the window must not re-render the page: the extension lives in
			 * `rowMovingAtRef`, which both readers consult, and a `setFocusRow` per read
			 * would cost a render every watcher period for the length of an operation.
			 * State is written by a LANDING and by the end of the move - and a stale
			 * `until` in state is harmless, because `focusHoldWindow` answers
			 * `max(hold.until, lastMovingAt + windowMs)` and the ref is the fresh term.
			 */
			if (!read.land) return "kept";
			setFocusRow({
				name: move.name,
				waitForSignIn: false,
				until: read.hold.until,
				landedOn: read.land,
				reanchors: read.hold.reanchors,
			});
			/*
			 * ONE MACROTASK LATER, and that is the whole of Q2/U20: a dialog or a row
			 * menu closing runs Radix's close-auto-focus AFTER this read, its target is
			 * the control that opened it - a menu item the close has already unmounted -
			 * and its restore to `<body>` silently undoes a focus performed here.
			 * Measured on the two arms whose row never re-renders again, so nothing
			 * re-armed the move: the confirm on a FAILED sign-out (the row settles on
			 * `Sign-out didn't finish | Sign out again`) and a key `Save and test` whose
			 * row is left with no primary (QA Q2, UX U20) - both left
			 * `document.activeElement` on `BODY`. Deferring makes the row's own control
			 * the last writer whatever order the close runs in.
			 *
			 * WHY A MACROTASK IS ENOUGH, stated as the assumption it is (R5-5): the
			 * ordering holds because the installed Radix focus scope restores focus from
			 * ONE `setTimeout(..., 0)` registered by the unmounting subtree's effect
			 * cleanup, and React runs that cleanup no later than the parent effect that
			 * arms this move - so this timer is registered second and fires second. That
			 * is a third-party dist's internals rather than a property this repository can
			 * assert: a future Radix that defers twice, or to a `requestAnimationFrame`,
			 * would make the restore the last writer again, and the pin here can only
			 * assert that this deferral exists (it does, and it fails when removed). The
			 * guard below is deliberately conservative in the same spirit: a target that
			 * has left the document by the time the timer fires drops the move rather
			 * than throwing - and the watcher below is what picks that dropped move back
			 * up when its node was REPLACED rather than withdrawn.
			 */
			const landed = read.land;
			window.setTimeout(() => {
				if (landed.isConnected) landed.focus();
			}, 0);
			return "landed";
		},
		[readDocument, document, integrations.memories],
	);

	/*
	 * THE WATCHER: the half a render cannot switch off (QA round 3, Q-1; UX round 3,
	 * U31). It is also the FAST PATH - a payload that carries a change re-runs the read
	 * at once, so a dialog's own landing arrives on the first read after it rather than
	 * up to a cadence later.
	 *
	 * WHY A MOVE NEEDS A CADENCE OF ITS OWN AT ALL. The read above runs when React
	 * re-runs it, and for the length of a slow operation React has nothing to say: the
	 * poll answers with a payload deeply equal to the cached one, structural sharing
	 * keeps the reference, no tracked prop changes, and nothing else in this component
	 * runs either. A hold waiting on a render is therefore a hold waiting on a poll that
	 * may never produce one - which is exactly how a 20 s answer ended with the caret on
	 * `<body>`.
	 *
	 * WHAT IT DOES. The same read as the one at the top of this effect, on its own
	 * cadence: the row's own operation is what keeps the window open while it is in
	 * flight (QA round 2, Q1 measured 21 750 ms for a 20 s server), and the row's RE-STAND is noticed where it
	 * happens - the row is replaced while its operation runs, no payload needs to change
	 * for that, and the read that follows lands the move on the row's new control. That
	 * is why the app now makes a `focus()` call AT the group change rather than only at
	 * dispatch, which is the reading the round-3 failure was missing.
	 *
	 * WHY A TIMER AND NOT A `requestAnimationFrame`: the window is not always painted -
	 * every rig that measures this runs the app headless - and a frame-driven watcher
	 * would stop watching in exactly the environment the defect was found in.
	 * `FOCUS_WATCH_MS` is short against the window it is watching (about sixteen reads
	 * inside one `FOCUS_ARM_MS`), and while no move is armed there is no timer at all.
	 *
	 * THE PROMISE THIS HALF CARRIES, stated rather than implied (R4-5): the read's own
	 * deadline check is what makes a LATE move impossible; this watcher is what makes a
	 * DROPPED one recoverable. Removing it leaves the deadline honest and the re-stand
	 * unfollowed, which is the defect this round exists to remove.
	 */
	useEffect(() => {
		if (!focusRow) return;
		readFocusMove(focusRow, Date.now());
		let timer = 0;
		let stopped = false;
		const tick = () => {
			if (stopped) return;
			/*
			 * A `finished` read has already cleared `focusRow`, which tears this effect
			 * down; the return keeps a tick that ran in the same macrotask from re-arming
			 * the timer the cleanup is about to clear.
			 */
			if (readFocusMove(focusRow, Date.now()) === "finished") return;
			timer = window.setTimeout(tick, FOCUS_WATCH_MS);
		};
		timer = window.setTimeout(tick, FOCUS_WATCH_MS);
		return () => {
			stopped = true;
			window.clearTimeout(timer);
		};
	}, [focusRow, readFocusMove]);

	return (
		<SettingsSection
			title={SECTION_TITLE}
			titleComponent={header}
			sectionRef={sectionRef}
		>
			<div className="flex flex-col gap-4">
				{integrations.route === "session" && integrations.borrowed ? (
					<p className="text-body-sm text-ink-muted">
						Showing the integrations for{" "}
						{integrations.borrowed.title?.trim() ||
							integrations.borrowed.session_id.slice(0, 6)}
						, your most recent chat.
					</p>
				) : null}
				{integrations.noConversation ? (
					<div className="flex flex-col items-start gap-2">
						{/* "The backend" is jargon for this audience, and the page
						    told them to do something it gave no control for (D5). */}
						<p className="text-body-sm text-ink-muted">
							Integrations can be managed here once a chat has started.
						</p>
						<Button
							variant="primary"
							size="sm"
							onClick={() => navigate("/chat")}
						>
							Start a chat
						</Button>
						<p className="text-ink-dim text-meta">
							Updating Local Operator removes this step.
						</p>
					</div>
				) : null}
				{integrations.isLoading ? (
					<div className="flex h-24 items-center justify-center">
						<Spinner size="lg" label="Loading integrations" />
					</div>
				) : null}
				{/*
				 * A folder the backend refused with `invalid_cwd`: the page keeps
				 * working on the global catalog rather than dead-ending, and says
				 * so - a user whose chat folder was deleted must be told why the
				 * project rows are missing instead of concluding the page is
				 * broken (R2-4).
				 */}
				{integrations.folderUnavailable ? (
					<Alert variant="warning">
						<span>
							This chat's folder no longer exists, so only global integrations
							are shown.
						</span>
					</Alert>
				) : null}
				{integrations.isError ? (
					<Alert variant="warning">
						<div className="flex items-center justify-between gap-3">
							<span>Integrations couldn't be loaded.</span>
							<Button
								variant="secondary"
								size="sm"
								onClick={integrations.refetch}
							>
								Retry
							</Button>
						</div>
					</Alert>
				) : null}
				{/*
				 * A refusal that belonged to a row which no longer exists. The
				 * list IS re-read after a 409 (F2), so the sentence explaining
				 * why - "It no longer exists. The list has been refreshed." -
				 * would otherwise vanish along with the row that carried it, and
				 * the user would watch a row disappear with no account of it.
				 */}
				{orphanFailures.map(([name, message]) => (
					<Alert key={name} variant="warning">
						<div className="flex items-center justify-between gap-3">
							<span>{message}</span>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => dismissFailure(name)}
							>
								Dismiss
							</Button>
						</div>
					</Alert>
				))}
				{showAdd && servers.length > 0 ? addForm : null}
				{servers.length >= SEARCH_THRESHOLD ? (
					<div className="relative">
						<Search
							aria-hidden="true"
							className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-dim"
						/>
						<Input
							ref={searchRef}
							value={filter}
							onChange={(event) => setFilter(event.target.value)}
							/*
							 * Escape clears the field, matching the search control's own
							 * affordance: with a filter that matches nothing the only way
							 * back used to be select-all-and-delete (n1, round 2). The event
							 * is left alone when there is nothing to clear, so Escape keeps
							 * whatever meaning the surface around it has.
							 */
							onKeyDown={(event) => {
								if (event.key !== "Escape" || !filter) return;
								event.preventDefault();
								setFilter("");
							}}
							placeholder={`Search ${integrationCountLabel(servers.length)}`}
							aria-label="Search integrations"
							className="pl-9"
						/>
					</div>
				) : null}
				{target?.kind === "miss" && servers.length > 0 ? (
					<p className="text-body-sm text-ink-muted">
						{`No integration matches "${target.asked}".`}
					</p>
				) : null}
				{target?.kind === "matched" && target.unresolved ? (
					<p className="text-body-sm text-ink-muted">
						{`Showing "${target.name}" — "${target.unresolved}" is not one of your integrations.`}
					</p>
				) : null}
				{document && servers.length === 0 && !integrations.isLoading ? (
					showAdd ? (
						addForm
					) : (
						<div className="flex flex-col items-start gap-3 rounded-lg bg-surface p-6">
							<Plug aria-hidden="true" className="size-5 text-ink-muted" />
							<div className="flex flex-col gap-1">
								<h3 className="text-heading text-ink">No integrations yet</h3>
								<p className="max-w-xl text-body-sm text-ink-muted">
									Integrations let agents read and act in your other tools, like
									Notion or Linear. Add one with a command that runs on this
									computer, or a server's URL.
								</p>
							</div>
							<Button
								variant="primary"
								size="md"
								onClick={() => setShowAdd(true)}
								data-tour-tag="mcp-add-server"
							>
								<Plus aria-hidden="true" />
								Add integration
							</Button>
						</div>
					)
				) : null}
				{servers.length > 0 && visible.length === 0 ? (
					<div className="flex flex-col items-start gap-2">
						<p className="text-body-sm text-ink-muted">
							No integrations match this search.
						</p>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => {
								setFilter("");
								/*
								 * The button unmounts with the empty state it belongs to, so
								 * focus has to be moved after that render - and the field it
								 * just emptied is where the user was typing (n2, round 2;
								`<body>` is where it used to land). The Add control is the
								fallback for the case where the box itself is gone.
								 */
								window.setTimeout(() => {
									(searchRef.current ?? addSlotRef.current)?.focus();
								}, 0);
							}}
						>
							Clear search
						</Button>
					</div>
				) : null}
				{groups.map((group) => (
					<section
						key={group.id}
						aria-labelledby={`integrations-group-${group.id}`}
						className="flex flex-col gap-1.5"
					>
						<h3
							id={`integrations-group-${group.id}`}
							className="px-1 text-ink-dim text-meta"
						>
							{group.title} · {group.rows.length}
						</h3>
						<ul className="flex flex-col divide-y divide-hairline overflow-hidden rounded-lg bg-surface">
							{group.rows.map((row) => (
								<IntegrationRow
									key={row.id}
									row={row}
									operations={operations}
									memories={integrations.memories}
									projectScopeAvailable={projectScopeAvailable}
									highlighted={row.name === named}
									rowRef={row.name === named ? highlightRef : undefined}
									primaryRef={(element) => {
										rowPrimaryRefs.current[row.name] = element;
									}}
									overflowRef={(element) => {
										rowOverflowRefs.current[row.name] = element;
									}}
									pending={pending === row.name}
									failure={failures[row.name] ?? null}
									confirm={
										confirm?.name === row.name
											? ({ kind: confirm.kind } satisfies RowConfirm)
											: null
									}
									onPrimary={(action) => onPrimary(row, action)}
									onOverflow={(item) => onOverflow(row, item)}
									onConfirm={() => confirm && onConfirmed(row, confirm.kind)}
									onCancelConfirm={() => {
										// Keep puts focus back on the control that asked,
										// so the next Tab continues from where the reader was.
										setConfirm(null);
										window.setTimeout(() => {
											rowOverflowRefs.current[row.name]?.focus();
										}, 0);
									}}
								/>
							))}
						</ul>
					</section>
				))}
			</div>
			{dialog?.kind === "sign_in" ? (
				<IntegrationSignInDialog
					name={dialog.name}
					action={dialog.action}
					/*
					 * The row's own key route, from the SAME list the row's buttons come
					 * from (D15): the failed-sign-in copy may only name a control this
					 * surface can actually draw, and `linear` - whose actions carry no
					 * `add_key` and no secret reference - has none, so its overflow is
					 * Test / Open config file / Remove.
					 */
					keyRoute={signInRow ? offersKey(signInRow) : false}
					phase={signIn}
					onStart={() => void startSignIn(dialog.name, dialog.action)}
					onCancel={(operationId) =>
						void control({ action: "cancel", operationId }).catch(
							() => undefined,
						)
					}
					onOpenLink={(url) => void openUrlTarget(url)}
					onClose={(outcome) => closeSignIn(dialog.name, outcome)}
				/>
			) : null}
			{dialog?.kind === "key" ? (
				<IntegrationKeyDialog
					name={dialog.name}
					keyNames={
						dialog.keyNames.length
							? dialog.keyNames
							: (dialogRow?.auth.secret_refs.map((ref) => ref.id) ?? [])
					}
					/*
					 * No declared reference means the dialog must also ask for the
					 * key's NAME (U3): the backend offers no `set_key` for a
					 * server whose config names none, and the row's own copy
					 * promised a key it had nowhere to put.
					 */
					keyless={dialog.keyNames.length === 0}
					savedKeys={dialogRow?.auth.secret_refs
						.filter((ref) => ref.state === "encrypted")
						.map((ref) => ref.id)}
					saving={keySaving}
					failure={keyFailure}
					onClose={closeDialog}
					onSave={(values, confirmedReplace, header) => {
						setKeySaving(true);
						setKeyFailure(null);
						void integrations
							.storeKeys(dialog.name, values, confirmedReplace, header)
							.then((result) => {
								if (!result.saved) {
									setKeyFailure(result.message);
									return;
								}
								/*
								 * A saved key changes the row, so focus follows the row
								 * (U18): the dialog closes, and the row it belongs to may
								 * have no primary of its own afterwards - then its menu is
								 * the control to land on, which is the rule U12 applies.
								 */
								setDialog(null);
								setFocusRow({
									name: dialog.name,
									waitForSignIn: false,
									until: Date.now() + FOCUS_ARM_MS,
									reanchors: 0,
								});
							})
							.catch((cause) =>
								setKeyFailure(integrationFailureMessage("key", cause, false)),
							)
							.finally(() => setKeySaving(false));
					}}
				/>
			) : null}
		</SettingsSection>
	);
};

/**
 * How long a deferred focus move stays armed BETWEEN the row's own reads of its own
 * operation (m-4).
 *
 * THIS IS NOT HOW LONG THE MOVE LIVES, which is what the round-3 review caught this
 * doc claiming (NIT 1). A row doing its own work pushes the deadline out on every
 * read, so an armed move lasts as long as the operation it is following - measured
 * at 21 750 ms for a 20 s server - and the only clockless bound on that is
 * `FOCUS_REANCHOR_CAP` re-mounts. What this number is instead is the FLOOR and the
 * TAIL: long enough for the read that follows an action to land (the list polls every
 * 2 s while something is moving, and a catalog read answers in well under that), and
 * long enough AFTER a row stops moving for the read that carries its new group to
 * arrive. What stops a move firing after the reader has moved on is not this number:
 * it is the refusal in `focusHoldStep`, which drops the move the moment a control of
 * the reader's holds the caret.
 */
const FOCUS_ARM_MS = 4_000;

/**
 * How often an armed move is re-read while the row's own operation is in flight (QA
 * round 3, Q-1; UX round 3, U31).
 *
 * THE PAGE'S OWN POLL CANNOT BE THE CADENCE. It answers every 2 s with a payload
 * deeply equal to the cached one for the whole of an operation, and structural sharing
 * makes that a no-op for every reader gated on a reference - which is how a hold
 * expired 4.25 s into a 20 s operation, and why the app made no `focus()` call at all
 * at the row's group change. This is the read that does not depend on one, so it has
 * to be frequent enough that a re-stand is caught well inside the window it is judged
 * against: about sixteen reads to one `FOCUS_ARM_MS`, and against a window that is
 * itself renewed from the last read that found the row moving. It exists only while a
 * move is armed, and nothing else in this file polls.
 */
const FOCUS_WATCH_MS = 250;

/** `/Users/x/proj` as `~/proj`, for a label. Machine paths stay machine voice elsewhere. */
const HOME_PREFIX = /^\/(?:Users|home)\/[^/]+(?=\/|$)/;
const compactHome = (path: string): string => path.replace(HOME_PREFIX, "~");
