import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import {
	BookOpen,
	Briefcase,
	ChartNoAxesColumn,
	ClipboardList,
	CodeXml,
	Earth,
	FileQuestion,
	FlaskConical,
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
 * Maps stable category identifiers to icons and locale-aware labels.
 * Getters preserve the shared entry shape while reading the current locale;
 * eagerly translated module constants would remain in the startup language.
 */
export const CATEGORY_ICON_MAP: Record<
	string,
	{ icon: React.ReactNode; label: string }
> = {
	investment: {
		icon: <Briefcase size={14} aria-hidden="true" />,
		get label() {
			return t("ui.hub.taxonomy.category.investment");
		},
	},
	accounting: {
		/* Not `Briefcase`: `investment` uses it and the two sit next to each
		   other in the rail, so a 16-item filter opened with two adjacent rows
		   drawing the same silhouette. A ledger is what this category is. */
		icon: <BookOpen size={14} aria-hidden="true" />,
		get label() {
			return t("ui.hub.taxonomy.category.accounting");
		},
	},
	healthcare: {
		icon: <HeartPulse size={14} aria-hidden="true" />,
		get label() {
			return t("ui.hub.taxonomy.category.healthcare");
		},
	},
	legal: {
		icon: <Scale size={14} aria-hidden="true" />,
		get label() {
			return t("ui.hub.taxonomy.category.legal");
		},
	},
	software: {
		icon: <CodeXml size={14} aria-hidden="true" />,
		get label() {
			return t("ui.hub.taxonomy.category.software");
		},
	},
	security: {
		icon: <Shield size={14} aria-hidden="true" />,
		get label() {
			return t("ui.hub.taxonomy.category.security");
		},
	},
	role_play: {
		icon: <Users size={14} aria-hidden="true" />,
		get label() {
			return t("ui.hub.taxonomy.category.role_play");
		},
	},
	personal_assistance: {
		icon: <User size={14} aria-hidden="true" />,
		get label() {
			return t("ui.hub.taxonomy.category.personal_assistance");
		},
	},
	education: {
		icon: <GraduationCap size={14} aria-hidden="true" />,
		get label() {
			return t("ui.hub.taxonomy.category.education");
		},
	},
	marketing: {
		icon: <Megaphone size={14} aria-hidden="true" />,
		get label() {
			return t("ui.hub.taxonomy.category.marketing");
		},
	},
	sales: {
		icon: <ShoppingCart size={14} aria-hidden="true" />,
		get label() {
			return t("ui.hub.taxonomy.category.sales");
		},
	},
	research: {
		icon: <FlaskConical size={14} aria-hidden="true" />,
		get label() {
			return t("ui.hub.taxonomy.category.research");
		},
	},
	analysis: {
		icon: <ChartNoAxesColumn size={14} aria-hidden="true" />,
		get label() {
			return t("ui.hub.taxonomy.category.analysis");
		},
	},
	management: {
		icon: <ClipboardList size={14} aria-hidden="true" />,
		get label() {
			return t("ui.hub.taxonomy.category.management");
		},
	},
	social_media: {
		icon: <Earth size={14} aria-hidden="true" />,
		get label() {
			return t("ui.hub.taxonomy.category.social_media");
		},
	},
	other: {
		icon: <FileQuestion size={14} aria-hidden="true" />,
		get label() {
			return t("ui.hub.taxonomy.category.other");
		},
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
 * The icon and label for a category key, with the fallback in one place.
 *
 * Exported for the hub's category rail, which lists the categories the results
 * actually carry: a category the enum grows before this map does has to render
 * as something readable in both places, and two copies of that judgement is how
 * the rail and the pills start disagreeing about the same record.
 */
export const categoryEntry = (
	category: string,
): { icon: React.ReactNode; label: string } =>
	CATEGORY_ICON_MAP[category] ?? {
		icon: <Tag size={14} aria-hidden="true" />,
		label: formatLabel(category),
	};

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
	useI18nLocale();
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
	 * Compare the unchanged identifiers, not translated labels: translating a
	 * category must not change which author-provided tags survive this filter.
	 */
	const categoryLabels = new Set(
		(categories ?? []).map((cat) => formatLabel(cat).toLowerCase()),
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
				const entry = categoryEntry(cat);
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
