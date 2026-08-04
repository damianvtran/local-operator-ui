import { cn } from "@shared/lib/utils";
import {
	BarChart2,
	Briefcase,
	ClipboardList,
	Code2,
	FileQuestion,
	FlaskConical,
	Globe2,
	GraduationCap,
	HeartPulse,
	Megaphone,
	Scale,
	Shield,
	ShoppingCart,
	Tag,
	User,
	Users,
} from "lucide-react";
import type { FC } from "react";

/**
 * Maps agent category (snake_case) to icon and label.
 */
export const CATEGORY_ICON_MAP: Record<
	string,
	{ icon: React.ReactNode; label: string }
> = {
	investment: {
		icon: <Briefcase size={14} aria-hidden="true" />,
		label: "Investment",
	},
	accounting: {
		icon: <Briefcase size={14} aria-hidden="true" />,
		label: "Accounting",
	},
	healthcare: {
		icon: <HeartPulse size={14} aria-hidden="true" />,
		label: "Healthcare",
	},
	legal: {
		icon: <Scale size={14} aria-hidden="true" />,
		label: "Legal",
	},
	software: {
		icon: <Code2 size={14} aria-hidden="true" />,
		label: "Software",
	},
	security: {
		icon: <Shield size={14} aria-hidden="true" />,
		label: "Security",
	},
	role_play: {
		icon: <Users size={14} aria-hidden="true" />,
		label: "Role play",
	},
	personal_assistance: {
		icon: <User size={14} aria-hidden="true" />,
		label: "Personal assistance",
	},
	education: {
		icon: <GraduationCap size={14} aria-hidden="true" />,
		label: "Education",
	},
	marketing: {
		icon: <Megaphone size={14} aria-hidden="true" />,
		label: "Marketing",
	},
	sales: {
		icon: <ShoppingCart size={14} aria-hidden="true" />,
		label: "Sales",
	},
	research: {
		icon: <FlaskConical size={14} aria-hidden="true" />,
		label: "Research",
	},
	analysis: {
		icon: <BarChart2 size={14} aria-hidden="true" />,
		label: "Analysis",
	},
	management: {
		icon: <ClipboardList size={14} aria-hidden="true" />,
		label: "Management",
	},
	social_media: {
		icon: <Globe2 size={14} aria-hidden="true" />,
		label: "Social media",
	},
	other: {
		icon: <FileQuestion size={14} aria-hidden="true" />,
		label: "Other",
	},
};

/**
 * Converts snake_case to a sentence-case label. Title Case is a marketing
 * register; a tag on a card is a label, so only the first word is capitalised.
 */
function formatLabel(str: string): string {
	const words = str.split("_").join(" ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Shared pill shape for tags and categories: `sunken` fill on `surface`,
 * hairline edge. Display-only — if these ever become filters they become
 * buttons.
 */
const pillClassName =
	"inline-flex min-h-5.5 items-center rounded-full border border-hairline bg-sunken px-2 text-meta leading-none";

type AgentTagsAndCategoriesProps = {
	tags?: string[];
	categories?: string[];
	className?: string;
};

/**
 * Minimal, theme-aware, display-only pills for agent tags and categories.
 *
 * @returns React element with pills for tags and categories, or null if none provided.
 */
export const AgentTagsAndCategories: FC<AgentTagsAndCategoriesProps> = ({
	tags,
	categories,
	className,
}) => {
	if (
		(!tags || tags.length === 0) &&
		(!categories || categories.length === 0)
	) {
		return null;
	}

	/*
	 * A tag that repeats a category is noise: cards were showing "Finance"
	 * twice and "Research" twice, in two pills that look almost identical.
	 * Categories win, because they are the axis the sidebar filters on.
	 */
	const categoryLabels = new Set(
		(categories ?? []).map((cat) =>
			(CATEGORY_ICON_MAP[cat]?.label ?? formatLabel(cat)).toLowerCase(),
		),
	);
	const distinctTags = (tags ?? []).filter(
		(tag) => !categoryLabels.has(formatLabel(tag).toLowerCase()),
	);

	return (
		<div
			className={cn(
				"relative flex flex-wrap items-center gap-1.5 overflow-hidden",
				className,
			)}
			data-testid="agent-tags-and-categories"
		>
			{categories?.map((cat) => {
				const entry = CATEGORY_ICON_MAP[cat] || {
					icon: <Tag size={14} aria-hidden="true" />,
					label: formatLabel(cat),
				};
				return (
					<span
						key={cat}
						className={cn(pillClassName, "gap-1 font-medium text-ink-muted")}
					>
						{entry.icon}
						{entry.label}
					</span>
				);
			})}
			{distinctTags.map((tag) => (
				<span
					key={tag}
					className={cn(pillClassName, "gap-1 font-normal text-ink-dim")}
				>
					<Tag size={12} aria-hidden="true" />
					{formatLabel(tag)}
				</span>
			))}
		</div>
	);
};
