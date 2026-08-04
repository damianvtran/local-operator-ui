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
		label: "Role Play",
	},
	personal_assistance: {
		icon: <User size={14} aria-hidden="true" />,
		label: "Personal Assistance",
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
		label: "Social Media",
	},
	other: {
		icon: <FileQuestion size={14} aria-hidden="true" />,
		label: "Other",
	},
};

/**
 * Converts snake_case to Normal Upper Case with spaces.
 */
function formatLabel(str: string): string {
	return str
		.split("_")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
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

	return (
		<div
			className={`relative flex flex-wrap items-center gap-1.5 overflow-hidden ${className ?? ""}`}
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
						className={`${pillClassName} gap-1 font-medium text-ink-muted`}
					>
						{entry.icon}
						{entry.label}
					</span>
				);
			})}
			{tags?.map((tag) => (
				<span
					key={tag}
					className={`${pillClassName} gap-1 font-normal text-ink-dim`}
				>
					<Tag size={12} className="opacity-70" aria-hidden="true" />
					{formatLabel(tag)}
				</span>
			))}
		</div>
	);
};
