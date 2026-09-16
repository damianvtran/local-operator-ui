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
 * A turn's stamp: the date and time as it is read under a card, once.
 *
 * The shape is deliberately not `formatMessageDateTime`'s. That one answers the
 * HOVER row's question - the reader is already looking at the message, so a
 * bare weekday inside the week and a bare clock time today are enough - and its
 * call sites (the hover meta row, the transcript's own footer line, the message
 * controls) depend on it, so this is a second formatter rather than a change to
 * the first. A stamp that is always on screen has to name the DAY itself, since
 * nothing beside it does:
 *
 *   today            -> `3:42 PM`
 *   yesterday        -> `Yesterday 3:42 PM`
 *   earlier this year -> `Sep 12, 3:42 PM`
 *   an earlier year  -> `Sep 12, 2025, 3:42 PM`
 *
 * The DATE half goes through `navigator.language`, for the reason
 * `formatCalendarDate` above documents at length: a hardcoded `MMM d` is
 * English and month-first, and the platform's formatter is the app's only
 * answer for a user whose language orders the day first. The TIME half is
 * 12-hour BY REQUEST rather than by locale: the operator asked for am/pm, and a
 * reader's 24-hour preference is not the preference that was stated. `hour12`
 * is therefore forced instead of left to the locale's own hour cycle.
 *
 * `now` is a parameter so the tests can stand on a fixed instant. The two
 * boundaries this function has - the calendar day and the calendar year - are
 * exactly the ones a test cannot reach through a clock it does not own, and
 * `transcript-pane.ts` sets the same precedent for time-dependent rules in this
 * codebase: the decision is pure and takes its inputs, the caller reads them
 * once. Every production caller takes the default.
 */
export const formatTurnTimestamp = (
	dateTimeString?: string | Date | number,
	now: Date = new Date(),
): string => {
	if (dateTimeString === undefined || dateTimeString === null) return "";

	try {
		const date =
			dateTimeString instanceof Date
				? dateTimeString
				: new Date(dateTimeString);
		if (Number.isNaN(date.getTime())) return "";

		const time = date.toLocaleTimeString(navigator.language, {
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		});

		// Calendar days, not elapsed hours: 23:50 yesterday is "Yesterday" at
		// 00:10 today, which is how a person reads a conversation and the one
		// thing a "N hours ago" would get wrong.
		if (date.toDateString() === now.toDateString()) return time;

		const yesterday = new Date(now);
		yesterday.setDate(now.getDate() - 1);
		if (date.toDateString() === yesterday.toDateString()) {
			return `Yesterday ${time}`;
		}

		const monthDay = date.toLocaleDateString(navigator.language, {
			month: "short",
			day: "numeric",
		});
		// The year appears only when it is not the current one. A stamp's job is
		// to place a turn in the reader's own memory, and this year is the frame
		// every recent turn already sits in.
		return date.getFullYear() === now.getFullYear()
			? `${monthDay}, ${time}`
			: `${monthDay}, ${date.getFullYear()}, ${time}`;
	} catch (error) {
		console.error("Error formatting turn timestamp:", error);
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
