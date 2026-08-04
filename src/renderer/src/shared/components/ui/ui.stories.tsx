import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { Check, ChevronDown, Copy, Plus, Settings, Trash2 } from "lucide-react";
import { type ReactNode, useLayoutEffect, useState } from "react";
import "../../../styles/index.css";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Avatar,
	AvatarFallback,
	Badge,
	Button,
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
	Checkbox,
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
	Input,
	Label,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Progress,
	ScrollArea,
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
	Separator,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
	Skeleton,
	Switch,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
	Textarea,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipRoot,
	TooltipTrigger,
} from "./index";

/**
 * The whole primitive layer on one page, for screenshotting across every
 * theme.
 *
 * ## Why `data-theme` goes on `documentElement` and not just on the wrapper
 *
 * Tooltips, dialogs, menus, selects, popovers and sheets all portal to
 * `document.body`, which is outside any wrapper this story could render. With
 * the theme only on a wrapper, every `--lo-*` read in a portal resolves to
 * nothing and the overlays come out unstyled — while the in-flow half of the
 * page looks perfect, which makes it a slow thing to diagnose. The app has the
 * same constraint, so the attribute belongs on the root element.
 *
 * ## Faked focus rings
 *
 * `:focus-visible` cannot be forced from markup, and a screenshot of the focus
 * state is exactly what a review round needs. The controls in the "focus" row
 * carry `outline-2 outline-offset-2 outline-accent`, which is the same
 * declaration `styles/index.css` applies on real focus, written as role
 * utilities so this file still names no colour.
 */

const THEME_IDS = [
	"localOperatorDark",
	"localOperatorLight",
	"dracula",
	"dune",
	"sage",
	"monokai",
	"tokyoNight",
	"iceberg",
	"radient",
	"neon",
	"obsidian",
	"synth",
] as const;

type StoryArgs = { theme: (typeof THEME_IDS)[number] };

const ThemeFrame = ({
	theme,
	children,
}: {
	theme: string;
	children: ReactNode;
}) => {
	useLayoutEffect(() => {
		const previous = document.documentElement.dataset.theme;
		document.documentElement.dataset.theme = theme;
		return () => {
			if (previous === undefined) {
				document.documentElement.removeAttribute("data-theme");
			} else {
				document.documentElement.dataset.theme = previous;
			}
		};
	}, [theme]);

	return (
		<div
			data-theme={theme}
			className="min-h-screen bg-canvas p-8 font-sans text-body text-ink"
		>
			{children}
		</div>
	);
};

const Section = ({
	title,
	note,
	children,
}: {
	title: string;
	note?: string;
	children: ReactNode;
}) => (
	<section className="flex flex-col gap-3">
		<div className="flex flex-col gap-0.5">
			<h2 className="text-heading text-ink">{title}</h2>
			{note ? <p className="text-ink-dim text-meta">{note}</p> : null}
		</div>
		{children}
	</section>
);

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
	<div className="flex flex-wrap items-center gap-3">
		<span className="w-28 shrink-0 font-mono text-ink-dim text-mono-sm">
			{label}
		</span>
		{children}
	</div>
);

/** The grounds, side by side, so a palette that collapses them is obvious. */
const Grounds = () => (
	<div className="flex flex-wrap gap-3">
		{(
			[
				["canvas", "bg-canvas"],
				["surface", "bg-surface"],
				["elevated", "bg-elevated"],
				["sunken", "bg-sunken"],
			] as const
		).map(([name, cls]) => (
			<div
				key={name}
				className={`flex h-16 w-28 flex-col justify-end rounded-md border border-hairline p-2 ${cls}`}
			>
				<span className="font-mono text-ink-dim text-mono-sm">{name}</span>
			</div>
		))}
	</div>
);

const InkAndLines = () => (
	<div className="flex flex-col gap-2 rounded-md bg-surface p-4">
		<p className="text-ink">ink — primary text, 7:1 on every ground</p>
		<p className="text-ink-muted">ink-muted — secondary text, 4.5:1</p>
		<p className="text-ink-dim">ink-dim — captions and placeholders, 4.5:1</p>
		<p className="text-ink-disabled">ink-disabled — inactive controls only</p>
		<Separator />
		<div className="flex items-center gap-4">
			<span className="text-ink-dim text-meta">hairline</span>
			<div className="h-px flex-1 bg-hairline" />
			<span className="text-ink-dim text-meta">border-control</span>
			<div className="h-6 w-24 rounded-sm border border-control" />
		</div>
	</div>
);

const TypeScale = () => (
	<div className="flex flex-col gap-1 rounded-md bg-surface p-4">
		<p className="text-display">Display — page titles</p>
		<p className="text-title">Title — section headings</p>
		<p className="text-heading">Heading — card and dialog titles</p>
		<p className="text-body">Body — the default reading size</p>
		<p className="text-body-sm">Body small — controls and dense rows</p>
		<p className="text-meta text-ink-muted">Meta — captions, labels, badges</p>
		<p className="font-mono text-mono">Mono — read invoices/march.csv</p>
		<p className="font-mono text-ink-dim text-mono-sm">
			Mono small — 12:04:33 · exit 0
		</p>
	</div>
);

const BUTTON_VARIANTS = [
	"primary",
	"secondary",
	"outline",
	"ghost",
	"danger",
	"link",
] as const;

const Buttons = () => (
	<div className="flex flex-col gap-4">
		{BUTTON_VARIANTS.map((variant) => (
			<Row key={variant} label={variant}>
				<Button variant={variant} size="sm">
					Small
				</Button>
				<Button variant={variant} size="md">
					Medium
				</Button>
				<Button variant={variant} size="lg">
					Large
				</Button>
				<Button variant={variant} size="md">
					<Plus aria-hidden="true" />
					With icon
				</Button>
				<Button variant={variant} size="md" disabled>
					Disabled
				</Button>
				<Button
					variant={variant}
					size="md"
					className="outline-2 outline-accent outline-offset-2"
				>
					Focused
				</Button>
			</Row>
		))}
		<Row label="icon sizes">
			<Button variant="secondary" size="icon-sm" aria-label="Copy">
				<Copy aria-hidden="true" />
			</Button>
			<Button variant="secondary" size="icon" aria-label="Copy">
				<Copy aria-hidden="true" />
			</Button>
			<Button variant="secondary" size="icon-lg" aria-label="Copy">
				<Copy aria-hidden="true" />
			</Button>
			<Button variant="ghost" size="icon" aria-label="Settings">
				<Settings aria-hidden="true" />
			</Button>
			<Button variant="danger" size="icon" aria-label="Delete">
				<Trash2 aria-hidden="true" />
			</Button>
			<Button variant="primary" size="icon" disabled aria-label="Add">
				<Plus aria-hidden="true" />
			</Button>
		</Row>
		<Row label="asChild">
			<Button asChild variant="link">
				<a href="https://local-operator.com">Renders an anchor</a>
			</Button>
		</Row>
	</div>
);

/**
 * The three radii in one frame, at the sizes they are actually used at.
 *
 * Each tier is defensible on its own and the set is only defensible together:
 * a 6px control beside a 10px panel beside a 14px card has to read as three
 * deliberate tiers rather than as three people's preferences. Screenshotting
 * them apart is how a radius ramp drifts.
 */
const RadiusTiers = () => (
	<div className="flex flex-wrap items-start gap-6">
		<div className="flex flex-col gap-1.5">
			<span className="font-mono text-ink-dim text-mono-sm">control · 6</span>
			<div className="flex items-center gap-2">
				<Button variant="secondary">Run</Button>
				<Input className="w-40" placeholder="invoices/march.csv" />
			</div>
		</div>
		<div className="flex flex-col gap-1.5">
			<span className="font-mono text-ink-dim text-mono-sm">panel · 10</span>
			<div className="w-52 rounded-md border border-hairline bg-elevated p-1 shadow-overlay">
				<div className="rounded-sm bg-accent-wash px-2 py-1.5 text-body-sm text-ink">
					Duplicate
				</div>
				<div className="px-2 py-1.5 text-body-sm text-ink">Rename</div>
			</div>
		</div>
		<div className="flex flex-col gap-1.5">
			<span className="font-mono text-ink-dim text-mono-sm">
				card, dialog · 14
			</span>
			<div className="w-64 rounded-lg border border-hairline bg-surface p-4">
				<p className="text-heading text-ink">March invoices</p>
				<p className="text-ink-muted text-meta">Sorted, totalled, saved.</p>
			</div>
		</div>
	</div>
);

/**
 * The case the dense focus offset exists for: nineteen 28px controls in one
 * row. At the base 2px offset the ring bleeds 4px and lands on both
 * neighbours; the third button carries a faked ring so a screenshot shows it.
 */
const DenseToolbar = () => (
	<div className="inline-flex items-center gap-1 rounded-sm border border-hairline bg-surface p-1">
		{[Copy, Settings, Plus, Trash2, Check, ChevronDown].map((Icon, index) => (
			<Button
				// biome-ignore lint/suspicious/noArrayIndexKey: fixed demo row, no reordering
				key={index}
				variant="ghost"
				size="icon-sm"
				aria-label={`Action ${index + 1}`}
				className={
					index === 2 ? "outline-2 outline-accent outline-offset-1" : undefined
				}
			>
				<Icon aria-hidden="true" />
			</Button>
		))}
	</div>
);

const Fields = () => (
	<div className="grid max-w-3xl grid-cols-2 gap-4">
		<div className="flex flex-col gap-1.5">
			<Label htmlFor="field-sm">Small</Label>
			<Input id="field-sm" inputSize="sm" placeholder="28px" />
		</div>
		<div className="flex flex-col gap-1.5">
			<Label htmlFor="field-md">Medium</Label>
			<Input id="field-md" inputSize="md" placeholder="32px" />
		</div>
		<div className="flex flex-col gap-1.5">
			<Label htmlFor="field-lg">Large</Label>
			<Input id="field-lg" inputSize="lg" placeholder="36px" />
		</div>
		<div className="flex flex-col gap-1.5">
			<Label htmlFor="field-value">With a value</Label>
			<Input id="field-value" defaultValue="invoices/march.csv" readOnly />
		</div>
		<div className="flex flex-col gap-1.5">
			<Label htmlFor="field-invalid">Invalid</Label>
			<Input
				id="field-invalid"
				aria-invalid={true}
				defaultValue="not-an-email"
				readOnly
			/>
			<p className="text-danger text-meta">
				That address is missing an @. Add the domain and try again.
			</p>
		</div>
		<div className="flex flex-col gap-1.5">
			<Label htmlFor="field-disabled">Disabled</Label>
			<Input id="field-disabled" disabled placeholder="Not available" />
		</div>
		<div className="flex flex-col gap-1.5">
			<Label htmlFor="field-focus">Focused</Label>
			<Input
				id="field-focus"
				placeholder="Ring is the base layer's"
				className="outline-2 outline-accent outline-offset-2"
			/>
		</div>
		<div className="flex flex-col gap-1.5">
			<Label htmlFor="field-select">Select</Label>
			<Select>
				<SelectTrigger id="field-select">
					<SelectValue placeholder="Pick a model" />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						<SelectLabel>Local</SelectLabel>
						<SelectItem value="qwen">Qwen 3 8B</SelectItem>
						<SelectItem value="llama">Llama 3.1 8B</SelectItem>
					</SelectGroup>
					<SelectSeparator />
					<SelectGroup>
						<SelectLabel>Hosted</SelectLabel>
						<SelectItem value="claude">Claude Sonnet</SelectItem>
						<SelectItem value="gpt" disabled>
							GPT-4o (no key)
						</SelectItem>
					</SelectGroup>
				</SelectContent>
			</Select>
		</div>
		<div className="flex flex-col gap-1.5">
			<Label htmlFor="field-select-disabled">Select, disabled</Label>
			<Select disabled>
				<SelectTrigger id="field-select-disabled">
					<SelectValue placeholder="Unavailable" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="none">Nothing here</SelectItem>
				</SelectContent>
			</Select>
		</div>
		{/* The three trigger sizes beside the three field sizes above: this pair
		    of rows is the whole claim that a select and an input are the same
		    object to the person filling in the form. */}
		<div className="col-span-2 flex items-end gap-3">
			<div className="flex flex-1 flex-col gap-1.5">
				<Label htmlFor="field-select-sm">Select, 28px</Label>
				<Select>
					<SelectTrigger id="field-select-sm" selectSize="sm">
						<SelectValue placeholder="Small" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="a">Small</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<div className="flex flex-1 flex-col gap-1.5">
				<Label htmlFor="field-select-md">Select, 32px</Label>
				<Select>
					<SelectTrigger id="field-select-md" selectSize="md">
						<SelectValue placeholder="Medium" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="a">Medium</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<div className="flex flex-1 flex-col gap-1.5">
				<Label htmlFor="field-select-lg">Select, 36px</Label>
				<Select>
					<SelectTrigger id="field-select-lg" selectSize="lg">
						<SelectValue placeholder="Large" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="a">Large</SelectItem>
					</SelectContent>
				</Select>
			</div>
		</div>
		<div className="col-span-2 flex flex-col gap-1.5">
			<Label htmlFor="field-textarea">Textarea</Label>
			<Textarea
				id="field-textarea"
				placeholder="Tell the agent what you want done."
			/>
		</div>
		<div className="flex flex-col gap-1.5">
			<Label htmlFor="field-textarea-invalid">Textarea, invalid</Label>
			<Textarea
				id="field-textarea-invalid"
				aria-invalid={true}
				defaultValue="Too short"
				readOnly
			/>
		</div>
		<div className="flex flex-col gap-1.5">
			<Label htmlFor="field-textarea-disabled">Textarea, disabled</Label>
			<Textarea id="field-textarea-disabled" disabled placeholder="Locked" />
		</div>
	</div>
);

const Toggles = () => {
	const [checked, setChecked] = useState(true);

	return (
		<div className="flex flex-col gap-4">
			<Row label="checkbox">
				<Checkbox id="cb-off" />
				<Label htmlFor="cb-off">Off</Label>
				<Checkbox
					id="cb-on"
					checked={checked}
					onCheckedChange={(next) => setChecked(next === true)}
				/>
				<Label htmlFor="cb-on">On</Label>
				<Checkbox id="cb-mixed" checked="indeterminate" />
				<Label htmlFor="cb-mixed">Indeterminate</Label>
				<Checkbox id="cb-invalid" aria-invalid={true} />
				<Label htmlFor="cb-invalid">Invalid</Label>
				<Checkbox id="cb-disabled" disabled />
				<Label htmlFor="cb-disabled">Disabled</Label>
				<Checkbox id="cb-disabled-on" disabled checked />
				<Label htmlFor="cb-disabled-on">Disabled, on</Label>
				<Checkbox
					id="cb-focus"
					className="outline-2 outline-accent outline-offset-2"
				/>
				<Label htmlFor="cb-focus">Focused</Label>
			</Row>
			<Row label="switch">
				<Switch id="sw-off" />
				<Label htmlFor="sw-off">Off</Label>
				<Switch id="sw-on" defaultChecked />
				<Label htmlFor="sw-on">On</Label>
				<Switch id="sw-disabled" disabled />
				<Label htmlFor="sw-disabled">Disabled</Label>
				<Switch id="sw-disabled-on" disabled defaultChecked />
				<Label htmlFor="sw-disabled-on">Disabled, on</Label>
				<Switch
					id="sw-focus"
					className="outline-2 outline-accent outline-offset-2"
				/>
				<Label htmlFor="sw-focus">Focused</Label>
			</Row>
		</div>
	);
};

const SegmentedTabs = () => (
	<Tabs defaultValue="conversation" className="max-w-xl">
		<TabsList>
			<TabsTrigger value="conversation">Conversation</TabsTrigger>
			<TabsTrigger value="files">Files</TabsTrigger>
			<TabsTrigger value="settings">
				<Settings aria-hidden="true" />
				Settings
			</TabsTrigger>
			<TabsTrigger value="locked" disabled>
				Disabled
			</TabsTrigger>
		</TabsList>
		<TabsContent value="conversation">
			<p className="text-body-sm text-ink-muted">
				The active tab takes the surface step. The track is sunken, so selection
				uses the same lightness move as elevation everywhere else.
			</p>
		</TabsContent>
		<TabsContent value="files">
			<p className="text-body-sm text-ink-muted">Files panel.</p>
		</TabsContent>
		<TabsContent value="settings">
			<p className="text-body-sm text-ink-muted">Settings panel.</p>
		</TabsContent>
		<TabsContent value="locked">
			<p className="text-body-sm text-ink-muted">Unreachable.</p>
		</TabsContent>
	</Tabs>
);

const Badges = () => (
	<div className="flex flex-col gap-3">
		<Row label="rounded">
			<Badge variant="neutral">Neutral</Badge>
			<Badge variant="accent">Accent</Badge>
			<Badge variant="success">Success</Badge>
			<Badge variant="warning">Warning</Badge>
			<Badge variant="danger">Danger</Badge>
			<Badge variant="info">Info</Badge>
			<Badge variant="outline">Outline</Badge>
		</Row>
		<Row label="pill">
			<Badge variant="neutral" shape="pill">
				Neutral
			</Badge>
			<Badge variant="accent" shape="pill">
				<Check aria-hidden="true" />
				With icon
			</Badge>
			<Badge variant="success" shape="pill">
				Success
			</Badge>
			<Badge variant="warning" shape="pill">
				Warning
			</Badge>
			<Badge variant="danger" shape="pill">
				Danger
			</Badge>
			<Badge variant="info" shape="pill">
				Info
			</Badge>
			<Badge variant="outline" shape="pill">
				Outline
			</Badge>
		</Row>
	</div>
);

const Alerts = () => (
	<div className="flex max-w-2xl flex-col gap-3">
		<Alert variant="neutral">
			<AlertTitle>Nothing is running</AlertTitle>
			<AlertDescription>
				Start an agent to see its work appear here.
			</AlertDescription>
		</Alert>
		<Alert variant="success">
			<AlertTitle>Saved to your machine</AlertTitle>
			<AlertDescription>
				Wrote invoices/march.csv. Nothing left this computer.
			</AlertDescription>
		</Alert>
		<Alert variant="warning">
			<AlertTitle>The model is running low on context</AlertTitle>
			<AlertDescription>
				Older messages will be dropped from the next turn. Start a new
				conversation to keep them.
			</AlertDescription>
		</Alert>
		<Alert variant="danger">
			<AlertTitle>The server did not start</AlertTitle>
			<AlertDescription>
				Port 1111 is already in use. Quit whatever is holding it, or change the
				port in settings.
			</AlertDescription>
		</Alert>
		<Alert variant="info">
			<AlertTitle>An update is ready</AlertTitle>
			<AlertDescription>Version 0.13.0 installs on restart.</AlertDescription>
		</Alert>
		<Alert variant="info" icon={null}>
			<AlertDescription>
				No icon, no title — the quietest form.
			</AlertDescription>
		</Alert>
	</div>
);

const Cards = () => (
	<div className="grid max-w-4xl grid-cols-3 gap-4">
		<Card>
			<CardHeader>
				<CardTitle>Surface</CardTitle>
				<CardDescription>The default: filled, hairline edge.</CardDescription>
			</CardHeader>
			<CardContent>
				<p>
					Cards do not hover and do not cast a shadow. They have not left the
					flow.
				</p>
			</CardContent>
			<CardFooter>
				<Button variant="primary" size="sm">
					Run
				</Button>
				<Button variant="ghost" size="sm">
					Dismiss
				</Button>
			</CardFooter>
		</Card>
		<Card variant="plain">
			<CardHeader>
				<CardTitle>Plain</CardTitle>
				<CardDescription>
					Borderless, for grids where eight edges would be seven too many.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<p>The fill alone carries the grouping.</p>
			</CardContent>
		</Card>
		<Card variant="outline">
			<CardHeader>
				<CardTitle>Outline</CardTitle>
				<CardDescription>
					Unfilled, for a card already sitting on surface.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<p>A second surface fill would say nothing.</p>
			</CardContent>
		</Card>
	</div>
);

const Feedback = () => (
	<div className="flex max-w-2xl flex-col gap-5">
		<div className="flex flex-col gap-2">
			<span className="text-ink-dim text-meta">Progress</span>
			<Progress value={0} />
			<Progress value={38} />
			<Progress value={100} />
			<Progress value={null} />
		</div>
		<div className="flex flex-col gap-2">
			<span className="text-ink-dim text-meta">Skeleton</span>
			<div className="flex items-center gap-3 rounded-md bg-surface p-4">
				<Skeleton className="size-8 rounded-full" />
				<div className="flex flex-1 flex-col gap-2">
					<Skeleton className="h-3 w-1/3" />
					<Skeleton className="h-3 w-2/3" />
				</div>
			</div>
		</div>
		<div className="flex items-center gap-3">
			<span className="text-ink-dim text-meta">Avatar</span>
			<Avatar>
				<AvatarFallback>DT</AvatarFallback>
			</Avatar>
			<Avatar className="size-6">
				<AvatarFallback className="text-mono-sm">LO</AvatarFallback>
			</Avatar>
			<Avatar className="size-10">
				<AvatarFallback>AB</AvatarFallback>
			</Avatar>
		</div>
		<div className="flex flex-col gap-2">
			<span className="text-ink-dim text-meta">Scroll area</span>
			<ScrollArea className="h-32 w-full rounded-md border border-hairline bg-surface">
				<div className="flex flex-col gap-1 p-3">
					{[
						"Read invoices/march.csv",
						"Filtered 1,204 rows to 87",
						"Wrote summary.md",
						"Opened the folder",
						"Checked the totals against the ledger",
						"Flagged three duplicate entries",
						"Wrote duplicates.csv",
						"Finished",
					].map((line) => (
						<p key={line} className="font-mono text-ink-muted text-mono-sm">
							{line}
						</p>
					))}
				</div>
			</ScrollArea>
		</div>
	</div>
);

const AnchoredOverlays = () => {
	const [radio, setRadio] = useState("newest");

	return (
		<div className="flex flex-wrap items-start gap-24 pb-64">
			<div className="flex flex-col items-start gap-2">
				<span className="text-ink-dim text-meta">Tooltip, open</span>
				<TooltipProvider>
					<TooltipRoot open>
						<TooltipTrigger asChild>
							<Button variant="secondary" size="icon" aria-label="Copy">
								<Copy aria-hidden="true" />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="right">Copy to clipboard</TooltipContent>
					</TooltipRoot>
				</TooltipProvider>
			</div>

			<div className="flex flex-col items-start gap-2">
				<span className="text-ink-dim text-meta">Tooltip, on hover</span>
				<Tooltip content="Runs on this computer. Nothing is uploaded.">
					<Button variant="ghost" size="md">
						Hover me
					</Button>
				</Tooltip>
			</div>

			<div className="flex flex-col items-start gap-2">
				<span className="text-ink-dim text-meta">Dropdown menu, open</span>
				<DropdownMenu open modal={false}>
					<DropdownMenuTrigger asChild>
						<Button variant="secondary">
							Actions
							<ChevronDown aria-hidden="true" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="w-56">
						<DropdownMenuLabel>This conversation</DropdownMenuLabel>
						<DropdownMenuItem>
							<Copy aria-hidden="true" />
							Duplicate
							<DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
						</DropdownMenuItem>
						<DropdownMenuItem disabled>
							Export (nothing to export)
						</DropdownMenuItem>
						<DropdownMenuCheckboxItem checked>
							Show internal reasoning
						</DropdownMenuCheckboxItem>
						<DropdownMenuCheckboxItem>Show timestamps</DropdownMenuCheckboxItem>
						<DropdownMenuSeparator />
						<DropdownMenuLabel>Sort</DropdownMenuLabel>
						<DropdownMenuRadioGroup value={radio} onValueChange={setRadio}>
							<DropdownMenuRadioItem value="newest">
								Newest first
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="oldest">
								Oldest first
							</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
						<DropdownMenuSeparator />
						<DropdownMenuSub>
							<DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
							<DropdownMenuSubContent>
								<DropdownMenuItem>Archive</DropdownMenuItem>
								<DropdownMenuItem>Starred</DropdownMenuItem>
							</DropdownMenuSubContent>
						</DropdownMenuSub>
						<DropdownMenuSeparator />
						<DropdownMenuItem destructive>
							<Trash2 aria-hidden="true" />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<div className="flex flex-col items-start gap-2">
				<span className="text-ink-dim text-meta">Popover, open</span>
				<Popover open>
					<PopoverTrigger asChild>
						<Button variant="outline">Details</Button>
					</PopoverTrigger>
					<PopoverContent align="start">
						<p className="font-medium text-ink">Local model</p>
						<p className="mt-1 text-ink-muted">
							Qwen 3 8B, running on this machine. No network calls.
						</p>
					</PopoverContent>
				</Popover>
			</div>
		</div>
	);
};

const ModalTriggers = () => (
	<div className="flex flex-wrap gap-3">
		<Dialog>
			<DialogTrigger asChild>
				<Button variant="secondary">Open dialog</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Delete this conversation?</DialogTitle>
					<DialogDescription>
						The messages and any files the agent wrote stay on your machine.
						Only the conversation is removed.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="ghost">Cancel</Button>
					</DialogClose>
					<DialogClose asChild>
						<Button variant="danger">Delete</Button>
					</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>

		{(["right", "left", "top", "bottom"] as const).map((side) => (
			<Sheet key={side}>
				<SheetTrigger asChild>
					<Button variant="outline">Sheet from {side}</Button>
				</SheetTrigger>
				<SheetContent side={side}>
					<SheetHeader>
						<SheetTitle>Agent settings</SheetTitle>
						<SheetDescription>Changes apply to the next turn.</SheetDescription>
					</SheetHeader>
					<div className="flex flex-col gap-3">
						<div className="flex items-center justify-between">
							<Label htmlFor={`sheet-reasoning-${side}`}>
								Show internal reasoning
							</Label>
							<Switch id={`sheet-reasoning-${side}`} />
						</div>
						<Separator />
						<div className="flex items-center justify-between">
							<Label htmlFor={`sheet-confirm-${side}`}>
								Confirm before writing files
							</Label>
							<Switch id={`sheet-confirm-${side}`} defaultChecked />
						</div>
					</div>
					<SheetFooter>
						<Button variant="primary">Save</Button>
					</SheetFooter>
				</SheetContent>
			</Sheet>
		))}
	</div>
);

/* ---------------------------------------------------------------------------
 * The class-merge contract.
 *
 * `cn` is `twMerge`, and `twMerge` resolves conflicts from a table of class
 * groups it ships with. Anything it does not recognise falls through to a
 * validator, and the validator for `text-*` assumes "colour" — which put
 * `text-body-sm` in the same group as `text-ink` and made one of them vanish
 * from the DOM. It looked correct anyway, because the text then inherited
 * `ink` from `body`; it would only have surfaced on a ground where the
 * inherited colour was wrong, in a file nobody had edited.
 *
 * `shared/lib/utils.ts` fixes that by declaring the custom scales. This is the
 * check that keeps it fixed: a comment cannot fail, and a tailwind-merge
 * upgrade that re-broke the grouping would otherwise be invisible again.
 * ------------------------------------------------------------------------ */

const TYPE_STEPS = [
	"text-display",
	"text-title",
	"text-heading",
	"text-body",
	"text-body-sm",
	"text-meta",
	"text-mono",
	"text-mono-sm",
] as const;

/** Every colour role in the palette contract, as a utility suffix. */
const COLOUR_ROLES = [
	"canvas",
	"surface",
	"elevated",
	"sunken",
	"ink",
	"ink-muted",
	"ink-dim",
	"ink-disabled",
	"hairline",
	"control",
	"accent",
	"accent-hover",
	"accent-active",
	"accent-wash",
	"on-accent",
	"success",
	"success-wash",
	"success-border",
	"warning",
	"warning-wash",
	"warning-border",
	"danger",
	"danger-wash",
	"danger-border",
	"info",
	"info-wash",
	"info-border",
	"scrim",
] as const;

const COLOURED_PROPERTIES = [
	"bg",
	"text",
	"border",
	"fill",
	"outline",
] as const;

type MergeCase = { input: string; want: string };

const buildMergeCases = (): MergeCase[] => {
	const cases: MergeCase[] = [];

	// Two roles on the same property are a real conflict: the last one wins.
	for (const property of COLOURED_PROPERTIES) {
		for (let i = 0; i < COLOUR_ROLES.length - 1; i += 1) {
			const first = `${property}-${COLOUR_ROLES[i]}`;
			const second = `${property}-${COLOUR_ROLES[i + 1]}`;
			cases.push({ input: `${first} ${second}`, want: second });
		}
	}

	// A type step and a text colour are NOT a conflict. This is the pair that
	// was silently collapsing, so it is checked in both orders.
	for (const step of TYPE_STEPS) {
		for (const role of COLOUR_ROLES) {
			const colour = `text-${role}`;
			cases.push({ input: `${step} ${colour}`, want: `${step} ${colour}` });
			cases.push({ input: `${colour} ${step}`, want: `${colour} ${step}` });
		}
	}

	// Two type steps are a conflict.
	for (let i = 0; i < TYPE_STEPS.length - 1; i += 1) {
		cases.push({
			input: `${TYPE_STEPS[i]} ${TYPE_STEPS[i + 1]}`,
			want: TYPE_STEPS[i + 1],
		});
	}

	// The other custom namespaces, against each other and against Tailwind's
	// own values, so a caller's override still wins.
	cases.push(
		{ input: "rounded-xs rounded-frame", want: "rounded-frame" },
		{ input: "rounded-frame rounded-md", want: "rounded-md" },
		{ input: "duration-instant duration-slow", want: "duration-slow" },
		{ input: "duration-fast duration-200", want: "duration-200" },
		{ input: "ease-out-quart ease-in-out", want: "ease-in-out" },
		{ input: "ease-in-out ease-linear", want: "ease-linear" },
		{ input: "shadow-overlay shadow-none", want: "shadow-none" },
		{ input: "shadow-none shadow-overlay", want: "shadow-overlay" },
		{ input: "h-8 h-9.5", want: "h-9.5" },
		{ input: "size-8 size-9.5", want: "size-9.5" },
		{ input: "border-control border-2", want: "border-control border-2" },
		{
			input: "font-mono text-mono-sm text-ink-dim",
			want: "font-mono text-mono-sm text-ink-dim",
		},
		{
			input:
				"rounded-md duration-fast ease-out-quart shadow-overlay text-ink text-body-sm",
			want: "rounded-md duration-fast ease-out-quart shadow-overlay text-ink text-body-sm",
		},
	);

	return cases;
};

/**
 * Runs the contract. Deliberately NOT exported: CSF treats every named export
 * in a stories file as a story, so exporting this put a phantom "Run Merge
 * Contract" entry in the sidebar. The `play` function and the panel are both
 * in this module and reach it directly.
 */
const runMergeContract = () => {
	const cases = buildMergeCases();
	const failures = cases
		.map((testCase) => ({ ...testCase, got: cn(testCase.input) }))
		.filter((result) => result.got !== result.want);
	return { total: cases.length, failures };
};

const MergeContract = () => {
	const { total, failures } = runMergeContract();

	return (
		<Alert variant={failures.length === 0 ? "success" : "danger"}>
			<AlertTitle>
				{failures.length === 0
					? `${total} class-merge cases pass`
					: `${failures.length} of ${total} class-merge cases fail`}
			</AlertTitle>
			<AlertDescription>
				Type steps and ink roles must both survive a `cn` call; two values on
				the same property must collapse to the last one.
			</AlertDescription>
			{failures.length > 0 ? (
				<ul className="flex flex-col gap-1">
					{failures.map((failure) => (
						<li key={failure.input} className="font-mono text-mono-sm">
							{failure.input} → {failure.got} (want {failure.want})
						</li>
					))}
				</ul>
			) : null}
		</Alert>
	);
};

const meta: Meta<StoryArgs> = {
	title: "Design system/Primitives",
	parameters: { layout: "fullscreen" },
	argTypes: {
		theme: {
			control: { type: "select" },
			options: [...THEME_IDS],
			description:
				"Sets data-theme on the document root, which is what portalled overlays read.",
		},
	},
	args: { theme: "localOperatorDark" },
};

export default meta;

type Story = StoryObj<StoryArgs>;

/** Everything that renders in the flow, plus the anchored overlays. */
export const AllPrimitives: Story = {
	render: ({ theme }) => (
		<ThemeFrame theme={theme}>
			<div className="flex flex-col gap-10">
				<header className="flex flex-col gap-1">
					<h1 className="text-display">Primitives</h1>
					<p className="text-ink-muted">
						Every primitive, variant and state. Switch the theme control to
						check a palette.
					</p>
				</header>
				<Section
					title="Class-merge contract"
					note="Asserted in this story's play function, and shown here so a screenshot carries the result."
				>
					<div className="max-w-2xl">
						<MergeContract />
					</div>
				</Section>
				<Section title="Grounds" note="Elevation is a lightness step.">
					<Grounds />
				</Section>
				<Section title="Ink and lines">
					<InkAndLines />
				</Section>
				<Section title="Type">
					<TypeScale />
				</Section>
				<Section
					title="Button"
					note="6 variants x 4 sizes, plus icon sizes, disabled and focus."
				>
					<Buttons />
				</Section>
				<Section
					title="Radius tiers"
					note="Controls 6, floating panels 10, cards and dialogs 14 — together, because that is the only way the set can be judged."
				>
					<RadiusTiers />
				</Section>
				<Section
					title="Dense toolbar"
					note="icon-sm at 4px gaps, with the focus offset pulled to 1px. The third control shows the ring."
				>
					<DenseToolbar />
				</Section>
				<Section
					title="Fields"
					note="Input, Textarea, Select and Label, with invalid and disabled."
				>
					<Fields />
				</Section>
				<Section title="Checkbox and Switch">
					<Toggles />
				</Section>
				<Section title="Tabs" note="A segmented control on the sunken ground.">
					<SegmentedTabs />
				</Section>
				<Section title="Badge">
					<Badges />
				</Section>
				<Section title="Alert" note="The four semantic triples, plus neutral.">
					<Alerts />
				</Section>
				<Section title="Card">
					<Cards />
				</Section>
				<Section title="Progress, Skeleton, Avatar, Scroll area">
					<Feedback />
				</Section>
				<Section
					title="Modals"
					note="Dialog and Sheet, as triggers. Open states are separate stories."
				>
					<ModalTriggers />
				</Section>
				<Section
					title="Anchored overlays"
					note="Held open so they can be screenshotted."
				>
					<AnchoredOverlays />
				</Section>
			</div>
		</ThemeFrame>
	),
	// The executable half of the class-merge contract. The panel above shows
	// the result in a screenshot; this fails the story if a tailwind-merge
	// upgrade silently regroups the custom scales again.
	play: async () => {
		const { failures } = runMergeContract();
		await expect(failures).toEqual([]);
	},
};

/** The select panel open, which blocks pointer events and so lives alone. */
export const SelectOpen: Story = {
	render: ({ theme }) => (
		<ThemeFrame theme={theme}>
			<div className="flex max-w-xs flex-col gap-1.5">
				<Label htmlFor="open-select">Model</Label>
				<Select open defaultValue="claude">
					<SelectTrigger id="open-select">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							<SelectLabel>Local</SelectLabel>
							<SelectItem value="qwen">Qwen 3 8B</SelectItem>
							<SelectItem value="llama">Llama 3.1 8B</SelectItem>
						</SelectGroup>
						<SelectSeparator />
						<SelectGroup>
							<SelectLabel>Hosted</SelectLabel>
							<SelectItem value="claude">Claude Sonnet</SelectItem>
							<SelectItem value="gpt" disabled>
								GPT-4o (no key)
							</SelectItem>
						</SelectGroup>
					</SelectContent>
				</Select>
			</div>
		</ThemeFrame>
	),
};

/** The dialog open over the scrim. */
export const DialogOpen: Story = {
	render: ({ theme }) => (
		<ThemeFrame theme={theme}>
			<Cards />
			<Dialog open>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete this conversation?</DialogTitle>
						<DialogDescription>
							The messages and any files the agent wrote stay on your machine.
							Only the conversation is removed.
						</DialogDescription>
					</DialogHeader>
					<Alert variant="warning">
						<AlertDescription>
							Three files were written during this conversation. They are not
							deleted.
						</AlertDescription>
					</Alert>
					<DialogFooter>
						<Button variant="ghost">Cancel</Button>
						<Button variant="danger">Delete</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</ThemeFrame>
	),
};

/** The sheet open over the scrim. */
export const SheetOpen: Story = {
	render: ({ theme }) => (
		<ThemeFrame theme={theme}>
			<Cards />
			<Sheet open>
				<SheetContent side="right">
					<SheetHeader>
						<SheetTitle>Agent settings</SheetTitle>
						<SheetDescription>Changes apply to the next turn.</SheetDescription>
					</SheetHeader>
					<div className="flex flex-col gap-3">
						<div className="flex items-center justify-between">
							<Label htmlFor="sheet-open-reasoning">
								Show internal reasoning
							</Label>
							<Switch id="sheet-open-reasoning" />
						</div>
						<Separator />
						<div className="flex items-center justify-between">
							<Label htmlFor="sheet-open-confirm">
								Confirm before writing files
							</Label>
							<Switch id="sheet-open-confirm" defaultChecked />
						</div>
						<Separator />
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="sheet-open-name">Display name</Label>
							<Input id="sheet-open-name" defaultValue="Research agent" />
						</div>
					</div>
					<SheetFooter>
						<Button variant="ghost">Cancel</Button>
						<Button variant="primary">Save</Button>
					</SheetFooter>
				</SheetContent>
			</Sheet>
		</ThemeFrame>
	),
};
