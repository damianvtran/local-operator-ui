import { formatDistanceStrict } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import { t } from "../../../../i18n/messages";

/**
 * Keep date-fns' existing strict rounding/DST behavior, but localize its stable
 * unit/count output rather than parsing the English it would have rendered.
 * Each ICU message owns the entire age, so missing translations also get English
 * plural rules and wording. The old UI always appended "ago", even for future
 * dates; preserving that behavior is intentional in this extraction-only slice.
 */
export function commentAge(
	date: Date,
	now: Date | number = Date.now(),
): string {
	return formatDistanceStrict(date, now, {
		locale: {
			...enUS,
			formatDistance(token, count, options) {
				switch (token) {
					case "xSeconds":
						return t("ui.hub.comments.age.seconds", { count });
					case "xMinutes":
						return t("ui.hub.comments.age.minutes", { count });
					case "xHours":
						return t("ui.hub.comments.age.hours", { count });
					case "xDays":
						return t("ui.hub.comments.age.days", { count });
					case "xMonths":
						return t("ui.hub.comments.age.months", { count });
					case "xYears":
						return t("ui.hub.comments.age.years", { count });
					default:
						// Strict distance currently uses only the six tokens above. Keep
						// its prior English output if a library update adds another token.
						return t("ui.hub.comments.age.fallback", {
							duration: enUS.formatDistance(token, count, options),
						});
				}
			},
		},
	});
}

/**
 * The provenance age on the browse surfaces.
 *
 * Same meaning as `commentAge` — a strict distance plus "ago", including the
 * historical behaviour of saying "ago" for future dates — so it delegates
 * rather than duplicating the six ICU messages into seven locales. The name
 * exists so a card or details page does not import a symbol called
 * `commentAge` for an agent's `updated_at`.
 */
export function hubAge(date: Date, now: Date | number = Date.now()): string {
	return commentAge(date, now);
}
