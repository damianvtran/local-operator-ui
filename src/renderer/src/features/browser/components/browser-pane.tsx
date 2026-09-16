import {
	Button,
	Tabs,
	TabsList,
	TabsTrigger,
	Tooltip,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	type BrowserPaneScope,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import { PanelRightClose } from "lucide-react";
import { type FC, useMemo } from "react";
import type { SurfaceScope } from "../model/tab-index-model";
import { paneApprovalHeaderLabel } from "./browser-approvals-tray";
import { BrowserSurface } from "./browser-surface";

/**
 * The conversation's browser: the same surface as the route, hosted in the chat's
 * right slot, narrowed to one conversation's tabs.
 * Design: docs/design/browser-approval-ux.md 7.1 (one implementation, two hosts),
 * 7.2 (the scope switch), 7.3 (opening it, and how it composes with the pane
 * stack), 7.4 (the states the pane adds).
 *
 * WHY THIS IS A HOST AND NOT A SECOND BROWSER. The operator asked for the browser
 * "from the right in that conversation only, similar to the canvas and info
 * panels, showing that conversation's tabs vs all tabs". That is one surface with
 * a scope, so everything that exists once per host — the rect reporter, the view
 * policy, the notices, the tray, the dock, the strip — stays in `browser-surface`
 * and the only thing this file adds is what a PANE needs that a route does not:
 * a header, a two-state scope switch, and a close.
 *
 * THE SCOPE SWITCH IS THE PANE'S, NOT THE SURFACE'S (spec 7.2 says it is in the
 * pane's header, and the route has no second scope to offer), so the state is
 * here and the surface receives the resolved `SurfaceScope`. It is deliberately
 * the EXISTING segmented primitive rather than a new control: the track is
 * `sunken` and the selected pill is `surface`, which is the same lightness step
 * the rest of the system uses for selection (`shared/components/ui/tabs.tsx`).
 *
 * THE SWITCH IS STATE, THE SCOPE IS DERIVED. What is stored is "which list did
 * they ask for" and what is passed down is the scope that choice resolves to for
 * THIS conversation. Choosing a tab that no longer exists is impossible by
 * construction: the scope object is rebuilt from the current session id on every
 * render.
 *
 * THE CHOICE LIVES IN THE STORE, NOT HERE (UX round 1, U3), and this file said
 * otherwise for one round: the pane is remounted when the conversation changes, so
 * a `useState` here reverted the lens to "This conversation" on every switch while
 * the pane itself stayed open at the width the user had dragged. The slot belongs
 * to the window, so its lens is the slot's state (`browserPaneScope`, beside
 * `isBrowserPaneOpen` and `browserPanelWidth`) and only the content follows the
 * conversation.
 *
 * TWO SCOPES GO DOWN, AND THE SWITCH MOVES ONLY ONE (spec 7.2; QA round 1's Q1 and
 * UX round 1's U1 are the same defect seen from two sides). The switch is about
 * TABS, so it joins `tabScope`. Requests are scoped by REQUESTER - the agent that
 * asked - so `requestScope` is the conversation and nothing the user presses
 * changes it. Feeding the switch into the requests as well widened this
 * conversation's tray to other conversations' approvals under a sentence that
 * denied it, and, worse, narrowing the switch took an entry out of the queue
 * model's input while it was still pending in main, which the model resolves as
 * `Withdrawn by the agent`: the surface attributing an action to an agent that had
 * not taken one, from one press of a switch, live.
 *
 * NO SESSION, NO CONVERSATION SCOPE. On a chat with no session yet (a draft) the
 * "This conversation" side is disabled rather than silently meaning "All tabs" —
 * there is no set to scope to until a session exists, and a switch whose two
 * sides show the same list is precisely the half-truth this feature's copy
 * standard forbids. The pane itself still opens, in the all-tabs scope, because
 * "what is the browser doing" is a question a draft can answer.
 *
 * AND THE REQUEST SCOPE ON A DRAFT IS `"all"` TOO, which is the half UX round 1's
 * U4 found still wrong one layer down: with no conversation there is no "this
 * one", so the tray must not claim there is, and the sentence that says whose
 * requests these are is passed down only when there is a conversation to name.
 */
export type PaneScopeChoice = BrowserPaneScope;

export interface BrowserPaneProps {
	/** The conversation this pane is scoped to, or `null` on a draft. */
	sessionId: string | null;
	onClose: () => void;
}

export const BrowserPane: FC<BrowserPaneProps> = ({ sessionId, onClose }) => {
	/** Which list the user asked for. See the header comment for why this is a
	 * choice rather than the scope itself, and why it outlives this component. */
	const choice = useUiPreferencesStore((s) => s.browserPaneScope);
	const setChoice = useUiPreferencesStore((s) => s.setBrowserPaneScope);
	const scoped = choice === "conversation" && sessionId !== null;
	/** Memoised on the session id rather than rebuilt per render: the surface keys on
	 * the scope's value either way (`scopeKey`), and a caller that hands down a stable
	 * object is the cheaper half of the same rule. */
	const scope = useMemo<SurfaceScope>(
		() => (scoped && sessionId !== null ? { sessionId } : "all"),
		[scoped, sessionId],
	);
	/** Whose approvals this pane shows: this conversation's, always, whether the user
	 * is looking at its tabs or at every tab - and every request, on a draft, because
	 * a draft has no conversation to own one (see the header comment). */
	const requestScope = useMemo<SurfaceScope>(
		() => (sessionId !== null ? { sessionId } : "all"),
		[sessionId],
	);
	/** What the switch SHOWS, which is the effective scope rather than the stored
	 * choice: a choice of "conversation" on a session-less chat is not what the
	 * list below is showing, and a control that claims otherwise is lying about
	 * the surface it controls. */
	const switchValue: PaneScopeChoice = scoped ? "conversation" : "all";

	return (
		<div
			// `bg-surface`, the same ground the canvas and run panes take, so the three
			// occupants of this slot read as one slot with three modes.
			className={cn("flex h-full flex-col bg-surface")}
			data-tour-tag="browser-pane"
		>
			{/*
			 * The pane's header: 40px and `bg-sunken`, the size and ground the slot's
			 * other two panes state for their own bar (`canvas/index.tsx:502`,
			 * `run-details/run-panel.tsx:583-587`), so a user switching between the
			 * three does not see the bar move. No rule under it: the strip below is
			 * already `sunken` with its own `border-control` bottom edge, which is the
			 * one boundary this region needs (measured in the frames — a second rule
			 * between two bars of the same ground read as a seam).
			 */}
			<div
				className={cn(
					"flex h-10 shrink-0 items-center justify-between gap-2 bg-sunken px-2",
				)}
				data-tour-tag="browser-pane-header"
			>
				<div className={cn("flex min-w-0 items-center gap-2")}>
					{/* The title is the pane's own, and it is the same word the route is
					    reachable by (`Browser` in the rail), so the two hosts are the same
					    feature rather than two names for it (spec 7.2: "the pane title is
					    `Browser`").

					    IT IS SET AT THE SLOT'S TITLE STEP, NOT LOUDER (design round 1, D4).
					    `text-meta text-ink-dim` is what the run panel states its own header
					    title at (`run-panel.tsx`), and the canvas's header carries no title at
					    all. At `text-body-sm font-medium text-ink` the word was the second
					    heaviest thing in a 40px bar whose only other content is the switch's
					    selected label, so the header read as two claims about what the pane is;
					    the pane's own contents name it, and this step leaves the switch the
					    bar's one assertion. */}
					<span className={cn("shrink-0 text-meta text-ink-dim")}>Browser</span>
					{/* THE RING IS THE WRAPPER'S, NOT THE LIST'S, AND THAT IS THE FIX RATHER
					    THAN A PREFERENCE (design round 2; QA round 2 found the inline
					    declaration and the primitive that writes it).

					    `TabsList` is Radix's `Tabs.List`, which renders its list through a
					    `RovingFocusGroup.Root` - and that root puts
					    `style: { outline: "none", ...props.style }` on the element it renders
					    (`@radix-ui/react-roving-focus/dist/index.mjs`, the `RovingFocusGroup`
					    div). With `asChild` the group's element IS the list, so an INLINE
					    `outline: none` was landing on this element, and an inline declaration
					    beats every class: the row's `outline-solid outline-1 outline-control`
					    was in the DOM, in the stylesheet, and in the computed style's
					    overridden layer while the painted outline-style stayed `none`. Zero
					    pixels of the ring existed in the frames, which is what design round 1
					    (D3) measured as "the track has no visible extent" and what the
					    class-presence check could not see.

					    The suppression inside a tablist is deliberate on Radix's side - the
					    ITEMS carry the focus ring and the container is not a focus stop - so
					    the fix is not to fight it but to draw the track's edge on an element
					    Radix does not own: this wrapper hugs the same box (`w-fit`, same
					    radius) and its ring is the same `outline-control` the contract's rows
					    already cover. `-outline-offset-1` draws it inside the box exactly as
					    before, so the geometry the track's 32px depends on is unchanged. */}
					<div
						className={cn(
							"w-fit rounded-md outline-solid outline-1 -outline-offset-1 outline-control",
						)}
						data-tour-tag="browser-pane-scope-track"
					>
						<Tabs
							value={switchValue}
							onValueChange={(value) => setChoice(value as PaneScopeChoice)}
						>
							<TabsList
								aria-label="Which tabs to show"
								/* THE TRACK NEEDS A DRAWN EDGE HERE, and only here (design round 1,
							   D3). The primitive's track is `sunken` and this header is `sunken`
							   too - the pane's header must stay `sunken` because the slot's other
							   two panes state that ground for their own bar - so the track's own
							   fill is 1.015:1 / dE00 1.00 against its container and the control had
							   no extent at all: the unselected side read as a bare word 31px from
							   the pill, and on a draft the disabled side would have read as a
							   MISSING option rather than an unavailable one.

							   An outline rather than a border, because a border would eat 2px of
							   the 32px track and squeeze the 24px pill out of it, while an
							   `-outline-offset-1` ring is drawn inside the box and changes no
							   layout at all - the same idiom the picker row's pointer mark uses. */
							>
								<TabsTrigger
									value="conversation"
									disabled={sessionId === null}
									// Both sides steer the SAME region — the surface below — so both
									// carry the reference, unlike the chat view's tabs where only the
									// mounted panel may be named (`chat-tabs.tsx` states that rule).
									aria-controls={PANE_SURFACE_ID}
									data-tour-tag="browser-pane-scope-conversation"
								>
									This conversation
								</TabsTrigger>
								<TabsTrigger
									value="all"
									aria-controls={PANE_SURFACE_ID}
									data-tour-tag="browser-pane-scope-all"
								>
									All tabs
								</TabsTrigger>
							</TabsList>
						</Tabs>
					</div>
				</div>
				{/* THE SAME EXIT AS THE SLOT'S OTHER TWO PANES (design round 1, D2). Both
				    siblings paint `PanelRightClose` in the same corner, at the same size,
				    inside a `Tooltip`; a bare 8x8 `X` here was lighter than both, the only
				    one of the three with no visible label on hover, and - worst - the same
				    glyph as the per-tab close 56px below it, so the pane's own exit read as
				    "close tab". The tooltip is not decoration: it is the affordance's label,
				    and an icon-only control whose neighbours all carry one is the control
				    that gets mistaken for the tab's. */}
				<Tooltip content="Close browser">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Close browser"
						onClick={onClose}
						data-tour-tag="browser-pane-close"
					>
						<PanelRightClose aria-hidden="true" />
					</Button>
				</Tooltip>
			</div>
			<div id={PANE_SURFACE_ID} className="flex min-h-0 grow flex-col">
				{/* `key` ON THE SESSION, and it is not cosmetic: the queue model resolves
				    an entry that leaves ITS INPUT while still pending in main as
				    `Withdrawn by the agent` (spec 3.4's memory). A conversation switch
				    changes the request scope, so without a fresh model the pane would read
				    the other conversation's live request leaving as the agent's own
				    cancellation - the same false line QA round 1 (Q1) and UX round 1 (U1)
				    caught from the switch, one layer out. Keyed here, each conversation
				    gets its own queue; the host handover is unchanged, because one surface
				    unmounts and the next mounts in the same commit and the rect reporter's
				    null always precedes the new report. */}
				<BrowserSurface
					key={requestScope === "all" ? "all" : requestScope.sessionId}
					tabScope={scope}
					requestScope={requestScope}
					// This host's own evidence tags, so a run can say which host it drove
					// (spec 9's item 4: the hosts never co-mount, but a test still has to
					// know which one it is driving).
					surfaceTag="browser-pane-surface"
					dockSurfaceTag="browser-pane-dock"
					// The tray's sentence is a fact about the REQUEST scope (spec 7.2): this
					// pane's tray keeps showing THIS conversation's requests while its strip
					// shows All tabs — the switch chooses tabs, not demands — so the wording
					// names which of the two lists the count is about. It is passed ONLY when
					// there is a conversation to name: on a draft the request scope is every
					// request and the sentence would claim a conversation that does not exist
					// (UX round 1, U4), so the surface's own wording is used instead.
					approvalHeaderLabel={
						sessionId !== null ? paneApprovalHeaderLabel : undefined
					}
					// The way out of a scope that is hiding tabs that are open, offered only
					// by the host that has a wider scope to widen to (spec 7.2).
					onShowAllTabs={() => setChoice("all")}
				/>
			</div>
		</div>
	);
};

/** The region the scope switch selects: the surface below the switch. Named so
 * both triggers can point at it; the constant lives beside the component that
 * renders it, like the chat view's own ids. */
export const PANE_SURFACE_ID = "browser-pane-surface-panel";
