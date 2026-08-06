import { format } from "date-fns";

/**
 * Formats a date/time string based on when it occurred
 * - Today: just time (h:mm a)
 * - Yesterday: "Yesterday"
 * - Within the last 7 days: Day of week (e.g., "Monday")
 * - Older: Full date (yyyy-MM-dd)
 *
 * @param dateTimeString The date/time string to format
 * @returns Formatted date/time string
 */
export const formatMessageDateTime = (
	dateTimeString?: string | Date,
): string => {
	if (!dateTimeString) return "";

	try {
		const messageDate =
			dateTimeString instanceof Date
				? dateTimeString
				: new Date(dateTimeString);

		const now = new Date();
		const yesterday = new Date(now);
		yesterday.setDate(now.getDate() - 1);

		// Check if the message was sent today
		if (messageDate.toDateString() === now.toDateString()) {
			return format(messageDate, "h:mm a"); // Today: just time
		}

		// Check if the message was sent yesterday
		if (messageDate.toDateString() === yesterday.toDateString()) {
			return "Yesterday"; // Yesterday
		}

		// Check if the message was sent this week (within the last 7 days)
		const oneWeekAgo = new Date(now);
		oneWeekAgo.setDate(now.getDate() - 7);
		if (messageDate > oneWeekAgo) {
			return format(messageDate, "EEEE"); // Day of week
		}

		// Otherwise, show the full date
		return format(messageDate, "yyyy-MM-dd");
	} catch (error) {
		console.error("Error formatting date:", error);
		return "";
	}
};

/**
 * A calendar date, for metadata that is a fact rather than a recent event.
 *
 * `formatMessageDateTime` is tuned for a conversation, where "10:40 AM" and
 * "Yesterday" are what a reader wants and the exact date is noise. A field
 * like an agent's creation date sits beside its ID and its version and is read
 * once, so the same formatter gave it three shapes - a bare clock time for
 * minutes ago, a bare weekday inside a week, ISO after that - and the first of
 * those named no day at all. One shape, no seconds, no tooltip needed to
 * recover what the label already said.
 */
export const formatCalendarDate = (dateTimeString?: string | Date): string => {
	if (!dateTimeString) return "";

	try {
		const date =
			dateTimeString instanceof Date
				? dateTimeString
				: new Date(dateTimeString);
		if (Number.isNaN(date.getTime())) return "";
		/* The platform's formatter, not date-fns': `format(date, "d MMMM yyyy")`
		   is hardcoded English and day-first, so a US user reading a date the
		   app itself renders as "August 5" elsewhere saw "5 August 2026" here.
		   Every other date in the product goes through `navigator.language`. */
		return date.toLocaleDateString(navigator.language, {
			year: "numeric",
			month: "long",
			day: "numeric",
		});
	} catch (error) {
		console.error("Error formatting calendar date:", error);
		return "";
	}
};

/**
 * The same voice as `formatCalendarDate`, for metadata that is a moment.
 *
 * "Last modified" sits directly beside "Created" in the same grid, and giving
 * one a calendar date while the other kept `toLocaleString()` put "August 5,
 * 2026" next to "8/5/2026, 10:40:00 AM" - two shapes for two fields a reader
 * compares at a glance, and the second is the machine voice with seconds that
 * the calendar formatter exists to replace. A modification is a moment rather
 * than a day, so this keeps the time and drops the seconds, which are never
 * what anyone is reading a "last modified" field for.
 */
export const formatCalendarDateTime = (
	dateTimeString?: string | Date,
): string => {
	if (!dateTimeString) return "";

	try {
		const date =
			dateTimeString instanceof Date
				? dateTimeString
				: new Date(dateTimeString);
		if (Number.isNaN(date.getTime())) return "";
		return date.toLocaleString(navigator.language, {
			year: "numeric",
			month: "long",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		});
	} catch (error) {
		console.error("Error formatting calendar date-time:", error);
		return "";
	}
};
