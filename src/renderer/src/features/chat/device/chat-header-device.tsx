/**
 * The device control: one chip in the chat header's title block that says which
 * machine this conversation runs on, and one list of the machines it could.
 *
 * WHY IT IS NOT IN THE ACTION CLUSTER. The cluster (overflow, run details, globe,
 * console, canvas) is icon-only, and three things follow. A device name IS the
 * point - the first question a user has is "which machine is this on", and an icon
 * cannot answer it. The globe already means "open the browser pane" two controls
 * away, so a second network-ish glyph in that row would be two meanings for one
 * shape. And the cluster owns pane actions with a measured shed ladder
 * (`… 780..812, globe 824..856, console 868..900, canvas 912..944` at 1600); a
 * placement is not a pane action, and adding it would make that ladder a six-rung
 * problem.
 *
 * THE TITLE BLOCK ALREADY HOSTS THIS SHAPE. The team and agent chips are 20px
 * plain `<button>`s with `rounded-xs`, colour-only hover and a popover
 * (`chat-header-identity.tsx`), so this chip is the same animal and inherits that
 * geometry: `h-5` is the text block's own line height, and a 28px or 32px control
 * in that row would move the block it sits in.
 *
 * THE WORDS ARE THE DESIGN. `New on X` (a conversation that does not exist yet WILL
 * be created on X) against `On X` (it exists, on X) - see `chat-device-model.ts`,
 * which owns every label, row and sentence. This file only paints what that module
 * says.
 */

import { Spinner } from "@shared/components/common/spinner";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Check, ChevronDown, Monitor } from "lucide-react";
import {
	type ComponentPropsWithoutRef,
	type ReactNode,
	forwardRef,
} from "react";
import {
	type DevicePickerModel,
	type DevicePlacement,
	type DeviceRow,
	devices,
	placementLabel,
	placementSentence,
} from "./chat-device-model";

/** The dot's ink: `warning` when a device did not answer, `ink-muted` otherwise. */
const STATE_DOT = {
	quiet: "bg-ink-muted",
	warning: "bg-warning",
} as const;

/**
 * The reachability dot, drawn only where there is a reachability fact to state.
 *
 * THIS DEVICE IS HERE BY DEFINITION and a draft has nothing to be reachable yet, so
 * neither draws one - which is why the dot never needs a legend: it is absent
 * everywhere it would be redundant. Never `success` and never `accent`: nothing has
 * gone wrong and nothing is being asked for.
 */
const StateDot = ({ tone }: { tone: keyof typeof STATE_DOT }) => (
	<span
		aria-hidden="true"
		className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[tone])}
	/>
);

/** `warning` when the placement is a device that did not answer; otherwise quiet. */
const dotTone = (placement: DevicePlacement): keyof typeof STATE_DOT | null => {
	if (placement.kind === "remote")
		return placement.reachable === null
			? null
			: placement.reachable
				? "quiet"
				: "warning";
	if (placement.kind === "gone") return "quiet";
	return null;
};

/**
 * THE TRIGGER IS THIS BUTTON, so it forwards everything Radix injects.
 *
 * `DropdownMenuTrigger asChild` clones its direct child and hands it the whole
 * popover contract - `onPointerDown`, `onKeyDown`, `aria-haspopup`,
 * `aria-expanded`, `data-state`, `id`, and a ref. A trigger wrapped around a
 * component that swallows those props renders a button that looks right and does
 * nothing when pressed, which is exactly how this control first shipped in this
 * branch's own probe: the chip painted, and a real pointer press opened no menu.
 * The spread below is therefore AFTER this component's own attributes, so Radix's
 * state wins where the two overlap.
 */
const ChipButton = forwardRef<
	HTMLButtonElement,
	ComponentPropsWithoutRef<"button"> & { placement: DevicePlacement }
>(({ placement, className, children, ...props }, ref) => {
	const label = placementSentence(placement);
	const tone = dotTone(placement);
	return (
		<button
			ref={ref}
			type="button"
			data-device-chip=""
			/*
			 * `aria-busy` while a move is in flight, and the accessible name carries the
			 * whole state: the visible label is five words by design, so the sentence is
			 * where the tense, the affordance and the reason live.
			 */
			aria-busy={placement.kind === "moving" || undefined}
			aria-label={label}
			title={label}
			className={cn(
				/* `h-5` and `rounded-xs` are the identity controls' own contract: the block
				 * clips at its line height, and a 28/32px control would move it. */
				"inline-flex h-5 max-w-full shrink-0 cursor-pointer items-center gap-1 rounded-xs px-1",
				"select-none whitespace-nowrap text-body-sm",
				"text-ink-muted hover:bg-row-hover hover:text-ink",
				className,
			)}
			{...props}
		>
			{placement.kind === "moving" ? (
				/*
				 * THE SPINNER TAKES THE GLYPH'S SLOT inside the same 20px box, so nothing
				 * about the block's geometry moves while a move is in flight. It is
				 * `aria-hidden` because the label beside it already says so.
				 */
				<Spinner aria-hidden="true" className="size-3 shrink-0 text-ink-dim" />
			) : (
				<>
					{tone ? <StateDot tone={tone} /> : null}
					<Monitor
						aria-hidden="true"
						className="size-3 shrink-0 text-ink-dim"
					/>
				</>
			)}
			<span className="truncate">{placementLabel(placement)}</span>
			<ChevronDown
				aria-hidden="true"
				className="size-3 shrink-0 text-ink-dim"
			/>
			{children}
		</button>
	);
});
ChipButton.displayName = "ChipButton";

/** One row of the picker, candidate and ineligible alike. */
const PickerRow = ({
	row,
	onPick,
}: { row: DeviceRow; onPick: (row: DeviceRow) => void }) => {
	const ineligible = row.state === "ineligible";
	return (
		<DropdownMenuItem
			data-device-row={row.state}
			disabled={ineligible}
			onSelect={() => onPick(row)}
			/*
			 * INELIGIBILITY IS CARRIED BY THE REASON LINE, NOT BY DIMMING THE NAME. The
			 * primitive's own `data-[disabled]:text-ink-disabled` measures 1.99:1 on the
			 * dark palette and 2.96:1 on the light one - below AA, on the row whose whole
			 * job is to be read ("cannot receive a move"). The name therefore stays
			 * `ink-muted` (7.24:1 / 8.78:1, re-measured off this branch's own frames) and
			 * ineligibility keeps its three other carriers: `aria-disabled` through the
			 * primitive, the reason line, and no hover wash.
			 */
			className="flex-col items-start gap-0.5 py-1.5 data-[disabled]:text-ink-muted"
		>
			<span className="flex w-full items-center gap-2">
				<Monitor
					aria-hidden="true"
					className="size-3.5 shrink-0 text-ink-dim"
				/>
				<span className="min-w-0 flex-1 truncate text-body-sm">{row.name}</span>
				{row.state === "current" ? (
					<Check
						aria-hidden="true"
						className="size-3.5 shrink-0 text-ink-muted"
					/>
				) : null}
			</span>
			{row.facts.length > 0 ? (
				<span className="w-full pl-5.5 text-meta text-ink-dim">
					{row.facts.join(" · ")}
				</span>
			) : null}
			{row.why ? (
				<span className="w-full pl-5.5 text-meta text-warning">{row.why}</span>
			) : null}
		</DropdownMenuItem>
	);
};

/**
 * The picker: this device, then one section per network BY NAME, then the rows.
 *
 * NO LAN / VPN / PUBLIC-INTERNET DIVIDERS, and that is the design's spine rather
 * than a preference: the backend publishes addresses and classifies none of them
 * (its only classifier is "not loopback, not multicast, not link-local", and a
 * tunnel address is deliberately kept), so a WireGuard `10.88.0.x` and an ethernet
 * address arrive indistinguishable and a divider would assert a boundary the app
 * cannot see. The boundary it CAN see is the network the user created, which is
 * what the sections are.
 *
 * THE FOOTER IS PINNED, NOT THE LIST'S LAST CHILD. In the move states the default
 * move DELETES the copy on this device, and a consequence that can be scrolled out
 * of sight is not stated - so it sits outside the scrolling region, with a
 * separator. In a new chat the choice is free and reversible, so there is no footer
 * at all.
 */
const DevicePicker = ({
	model,
	busy,
	onPick,
	onCheckAgain,
	children,
}: {
	model: DevicePickerModel;
	busy: boolean;
	onPick: (row: DeviceRow) => void;
	onCheckAgain: () => void;
	children: ReactNode;
}) => (
	<DropdownMenu modal={false}>
		<DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
		<DropdownMenuContent
			align="start"
			side="bottom"
			data-device-picker=""
			className="flex max-h-[26rem] w-80 flex-col overflow-hidden"
		>
			<div
				data-device-picker-list=""
				className="min-h-0 flex-1 overflow-y-auto"
			>
				<DropdownMenuLabel className="text-meta text-ink-dim">
					{model.heading}
				</DropdownMenuLabel>
				<PickerRow row={model.self} onPick={onPick} />
				{model.sections.map((section) => (
					<div key={section.key}>
						<DropdownMenuSeparator />
						<DropdownMenuLabel className="flex items-center justify-between text-meta text-ink-dim">
							<span className="truncate">{section.name}</span>
							<span>{devices(section.count)}</span>
						</DropdownMenuLabel>
						{section.rows.map((row) => (
							<PickerRow key={row.deviceId} row={row} onPick={onPick} />
						))}
					</div>
				))}
				{model.guidance ? (
					/*
					 * A DEVICE IN NO NETWORK. The Mesh tab's rail row is gated on membership
					 * and network creation is CLI-only, so the honest instruction names the
					 * command that exists rather than a button that does not.
					 */
					<p
						data-device-guidance=""
						className="px-2 py-1.5 text-meta text-ink-dim"
					>
						{model.guidance}
					</p>
				) : null}
			</div>
			{model.footer || model.offerCheckAgain ? (
				<>
					<DropdownMenuSeparator />
					<div className="flex shrink-0 items-center gap-2 px-2 py-1.5">
						{model.footer ? (
							<span
								data-device-footer=""
								className="min-w-0 flex-1 text-meta text-ink-dim"
							>
								{model.footer}
							</span>
						) : (
							<span className="min-w-0 flex-1" />
						)}
						{model.offerCheckAgain ? (
							<DropdownMenuItem
								data-device-recheck=""
								disabled={busy}
								onSelect={onCheckAgain}
								className="shrink-0 px-1 py-0 text-meta"
							>
								Check again
							</DropdownMenuItem>
						) : null}
					</div>
				</>
			) : null}
		</DropdownMenuContent>
	</DropdownMenu>
);

export const ChatHeaderDevice = ({
	placement,
	model,
	busy,
	onPick,
	onCheckAgain,
}: {
	placement: DevicePlacement;
	model: DevicePickerModel;
	/** A move this pane issued is in flight: the picker's own actions stand down. */
	busy: boolean;
	onPick: (deviceId: string | null) => void;
	onCheckAgain: () => void;
}) => (
	<DevicePicker
		model={model}
		busy={busy}
		onCheckAgain={onCheckAgain}
		onPick={(row) =>
			onPick(row.deviceId === model.self.deviceId ? null : row.deviceId)
		}
	>
		<ChipButton placement={placement} />
	</DevicePicker>
);
