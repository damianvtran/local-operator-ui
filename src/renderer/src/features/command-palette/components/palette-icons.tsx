/**
 * The palette's glyphs, by name.
 *
 * The rows' icons are NAMES (`palette-search.ts` stays free of JSX so its
 * ranking can be tested in Node), and this is the one place they become
 * drawings. Keeping the mapping in a table rather than a switch is deliberate:
 * a new row names an icon, and if the name is missing the row still renders —
 * with the default glyph — instead of failing to compile in the middle of an
 * unrelated file.
 *
 * Every glyph is 16px, which is this system's row size, and none of them writes
 * a `strokeWidth`: one pen at four sizes is the rule, and lucide's own default
 * is that pen (docs/branding.md § 5).
 */

import { RadientMark } from "@shared/components/common/radient-mark";
import {
	Activity,
	Bot,
	CalendarDays,
	ChartColumn,
	Download,
	Gauge,
	Globe,
	Info,
	Key,
	type LucideIcon,
	MessageSquare,
	MessagesSquare,
	Paintbrush,
	PanelRightClose,
	PanelRightOpen,
	Plug,
	Plus,
	Puzzle,
	Settings,
	SlidersHorizontal,
	SquarePen,
	Store,
	Trash2,
} from "lucide-react";
import type { FC } from "react";
import type { PaletteIconName } from "../palette-search";

/** The lucide glyphs, by name. */
const LUCIDE: Record<Exclude<PaletteIconName, "account">, LucideIcon> = {
	chat: MessageSquare,
	conversation: MessagesSquare,
	agents: Bot,
	hub: Store,
	schedules: CalendarDays,
	browser: Globe,
	settings: Settings,
	theme: Paintbrush,
	integrations: Puzzle,
	providers: Plug,
	backend: SlidersHorizontal,
	credentials: Key,
	updates: Download,
	plus: Plus,
	"new-chat": SquarePen,
	trash: Trash2,
	"canvas-open": PanelRightOpen,
	"canvas-close": PanelRightClose,
	slider: SlidersHorizontal,
	info: Info,
	usage: Gauge,
	session: Activity,
	analytics: ChartColumn,
};

export const PaletteIcon: FC<{ name: PaletteIconName }> = ({ name }) => {
	// The Radient account row keeps the brand's own outline glyph, which is drawn
	// on lucide's grid and takes the row's ink like the rest.
	if (name === "account") return <RadientMark size={16} />;
	/*
	 * No fallback, deliberately: the table is a total `Record` over every name but
	 * `account`, so a `?? Pen` here could never fire and would only invite a name
	 * to be added to the union without a glyph. A missing entry is a type error at
	 * the table, which is where it should be caught.
	 */
	const Icon = LUCIDE[name];
	return <Icon size={16} aria-hidden="true" />;
};
