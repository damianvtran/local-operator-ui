import {
	type WakeRow,
	deriveWakes,
	formatWakeCadence,
	formatWakeDue,
} from "@features/chat/components/run-details/run-detail-model";
import type { ScheduleResponse } from "@shared/api/local-operator";
import { isServerUnreachable } from "@shared/api/local-operator/desktop-api";
import {
	type DesktopWakeSupervisor,
	WAKE_MESSAGE_MAX_CHARS,
} from "../../../../shared/desktop-contract";
/**
 * The Schedules page's own model: what a row is, what it says, and what the
 * create dialog offers.
 *
 * Pure by construction, like the run pane's `run-detail-model.ts` and for the
 * same reason: the labels a page draws are the thing review argues about, so
 * they are derived in one place that a story or a test can drive without a
 * renderer, and the components only place them.
 *
 * ## One vocabulary, borrowed rather than re-invented
 *
 * `formatWakeDue`, `formatWakeDuration` and `formatWakeCadence` come from
 * `features/chat/components/run-details/run-detail-model.ts` - the module the
 * run pane's Wakes section already draws with. The page and the pane are on
 * screen together (the pane is one press away in the same window), and
 * `docs/composer-wakes.md` section 3 refuses two words for one object across
 * two surfaces that can be seen at once. A second formatter here would be that
 * defect with a shorter name, so the page feeds the same deriver the same
 * field names and renders its answer.
 */
import type {
	DesktopWakeEntry,
	DesktopWakeScheduleRow,
} from "../../../../shared/desktop-contract";

/**
 * Wake lines one conversation shows before its `Show N more wakes` control.
 *
 * Three, not the pane's sixteen: a row here is a conversation whose height
 * compounds (a 16-wake conversation would be a 300px block in a list of
 * conversations), and unlike the pane this surface CAN put a shed line back
 * with a control of its own. The cap is per conversation and the panel scrolls,
 * so nothing is unreachable.
 */
export const WAKE_LINE_CAP = 3;

/**
 * The most wakes one conversation may hold, from the backend's own bound
 * (`MAX_WAKE_SCHEDULES = 16`).
 *
 * Stated here because the dialog turns it into a user-facing fact: at the
 * ceiling the create is refused INLINE with the reason, rather than by a 422
 * after the press. The agent-tool path enforces the bound and the CLI does not,
 * so a session can legitimately hold more than this - the CEILING is quoted for
 * what the dialog may create, and the page renders whatever the listing sends.
 */
export const MAX_WAKE_SCHEDULES = 16;

/** The smallest repeat, from `MIN_WAKE_INTERVAL_MS`: a wake starts a full turn. */
export const MIN_WAKE_INTERVAL_MS = 60_000;

const UNIT_MS: Record<ScheduleResponse["unit"], number> = {
	minutes: 60_000,
	hours: 3_600_000,
	days: 86_400_000,
};

/** One wake line, plus the facts the PAGE adds to the pane's row. */
export type WakeLine = WakeRow & {
	/**
	 * The typed wire row this line was derived from.
	 *
	 * Carried rather than re-derived from the labels: the editor states the
	 * wake's CURRENT time, cadence and bound on its own controls (the designer's
	 * D3 - a surface that asks the user to decide with the value hidden), and a
	 * label is not a value. The alternative - parsing `every 1d` back out of the
	 * rendered sentence - is the second grammar this module exists to avoid.
	 */
	source: DesktopWakeScheduleRow;
	/** Where this wake sits in its conversation's own order, 1-based. */
	position: number;
	/**
	 * `Ran 3 times` for a wake that has fired, or "" for one that has not.
	 *
	 * The page's own clause, and this surface is why it exists: the pane watches
	 * a session mid-turn, where a fired one-shot has left a delivery row in the
	 * transcript right below. A page about what is ARMED, read days later, has
	 * no such neighbour - without this, a recurring wake that has fired every
	 * morning for a week reads exactly like one that was created a minute ago.
	 */
	ranLabel: string;
};

/**
 * One conversation with wakes, as the page renders it.
 *
 * The row's IDENTITY is the conversation, which is the change this page exists
 * for: the old row was a rule plus an agent name, and there was nowhere on the
 * page to go and see what the rule did. `sessionId` is what the row opens.
 */
export type ScheduledTaskRow = {
	sessionId: string;
	/** Never empty: a nameless session falls back to its id and directory. */
	name: string;
	cwd: string;
	/**
	 * `dormant` (the session was stopped) or `ghost` (its transcript is gone).
	 *
	 * Both mean the same thing to a reader - the stored instant will not fire -
	 * and both are why the row drops its due label and states the fact instead.
	 */
	parked: boolean;
	ghost: boolean;
	/**
	 * Whether this row's instants are ones the machine will actually fire.
	 *
	 * Distinct from `parked`: a parked row is stopped by its own session, this is
	 * a page where nothing is supervised. The row renders identically (no
	 * instant, the count only) and the strip carries the reason, which is why the
	 * two are separate flags rather than one.
	 */
	dueInstants: boolean;
	/** The soonest due instant across the wakes, or `null` when none is knowable. */
	nextDueAt: number | null;
	wakes: WakeLine[];
	/** The slice the row draws, and how many lines it hid. */
	visibleWakes: WakeLine[];
	hiddenWakes: number;
	/** The row head's trailing clause: the count, the next fire, or parked. */
	meta: string;
};

/**
 * The count clause on a row head: `1 wake` / `2 wakes`.
 *
 * Deliberately not the composer's `wakeClause` (`1 wake armed`): that one is a
 * TALLY among counts of live work on the composer (`3 to-dos open`, `2
 * subagents running`), where the condition is the point. Here the count is a
 * row's subtitle over the lines that ARE the wakes, so `armed` would restate
 * what the list below it shows.
 */
export const wakeCountClause = (count: number): string =>
	count === 1 ? "1 wake" : `${count} wakes`;

/**
 * The parked clause, which replaces BOTH the due label and the count.
 *
 * "when you open it" was false, and it was measured false: pressing a parked
 * row's `Open conversation` leaves the index's `stopped_at` set for as long as it
 * was polled, because the warm correctly refuses a session that reports stopped -
 * a TURN is what clears the marker and re-arms the wakes (round-2 U9). The clause
 * says the thing that actually resumes them.
 */
export const PARKED_CLAUSE = "Parked — wakes resume after its next turn";

/**
 * The disclosure's label, singular at one.
 *
 * `Show 1 more wakes` shipped on the populated list because the clause was
 * written only in the plural, and it is the control's ACCESSIBLE NAME too (the
 * designer's D4 and the reviewer's R5 are the same defect). The page's own
 * `wakeCountClause` pluralises; this is the same rule on the same kind of noun.
 */
export const hiddenWakesLabel = (hidden: number): string =>
	hidden === 1 ? "Show 1 more wake" : `Show ${hidden} more wakes`;

/**
 * What the editor's `keep` options say, with the value they are keeping.
 *
 * The designer's D3, and the reason it is a defect rather than a wording
 * preference: the editor asks the user to decide about a time, a cadence and a
 * bound while showing none of the three. Every other surface on this feature is
 * value-bearing (the row reads `4:00 PM EDT · every 1d · 3 left · Ran 3 times`),
 * so these are the row's own formatters applied to the same values - not a
 * second vocabulary for them.
 */
export const keepFirstRunLabel = (
	wake: DesktopWakeScheduleRow,
	nowMs: number,
	parked: boolean,
): string => {
	if (parked) return "Keep it parked";
	/* `next_due_at` is non-null on this wire, and a null would be a row with no
	   instant to keep: the fallback says that rather than printing `NaN`. */
	return wake.next_due_at === null
		? "Keep the current time"
		: `Keep ${formatWakeDue(wake.next_due_at, nowMs)}`;
};

export const keepRepeatLabel = (wake: DesktopWakeScheduleRow): string =>
	wake.every_ms === null
		? "Keep as once"
		: `Keep ${formatWakeCadence(wake.every_ms, null)}`;

export const keepEndsLabel = (
	wake: DesktopWakeScheduleRow,
	nowMs: number,
): string => {
	if (wake.limit !== null) {
		const left = Math.max(0, wake.limit - wake.fired_count);
		return `Keep ${left} run${left === 1 ? "" : "s"} left`;
	}
	if (wake.until_at !== null) {
		return `Keep ending ${formatWakeDue(wake.until_at, nowMs)}`;
	}
	return "Keep never ending";
};

/**
 * The one sentence that says whether anything will fire, and picks the reason.
 *
 * The designer's D2: the strip and the panel footer were making opposite claims
 * on one screen ("scheduled tasks will not fire" above, "wakes fire whether or
 * not this window is open" below), and the states are not one condition but
 * three. Order matters - `supported: false` also reports `verifiable: false`
 * (`wakes/install.py::supervisor_state`), so the platform sentence has to win or
 * a Linux user reads a launchd sentence.
 */
export const supervisorLead = (supervisor: DesktopWakeSupervisor): string => {
	if (!supervisor.supported) {
		return "Wakes are not supervised on this platform yet, so the wakes below only fire while a conversation is running.";
	}
	if (supervisor.verifiable === false) {
		return "Nothing supervises the wakes below, so they only fire while their conversation is running.";
	}
	return "The wake supervisor is installed but not running, so the wakes below will not fire.";
};

/**
 * The footer's parking half, which had two false claims in it (round-2 U9).
 *
 * Both were measured in the running app. **Which stop parks:** the durable
 * `stopped_at` marker has exactly one writer, the control ladder
 * (`session/runtime/control.py::_mark_wakes_dormant`, reached by `lop stop` and
 * the TUI's `/stop`); `POST /v1/desktop/stop` answers `stop_requested` and writes
 * nothing, so a conversation stopped from this window keeps its wakes armed and a
 * supervised store will still fire them. **What resumes them:** a TURN, not the
 * act of opening - a parked session's warm refuses it, and the index's marker
 * survives until a runtime runs the conversation again.
 *
 * The sentence names the surface that parks, the surface that does not, and what
 * actually resumes, because those are the three things a reader is deciding
 * between. The first clause of the footer (that wakes fire with the window shut)
 * stays gated on the supervisor, where it belongs.
 */
export const PARK_FOOTER_CLAUSE =
	"A terminal stop parks a conversation's wakes until its next turn; stopping one from this window leaves them armed.";

/**
 * What the rows say when the listing that drew them is no longer answering.
 *
 * A failed read is not an empty store and it is not a fresh store either: React
 * Query keeps serving the last answer, so the rows under an error strip are the
 * last list that loaded rather than a claim about now. Round 2 caught the page
 * admitting the failure while the rows beneath went on asserting `1 wake` each
 * (U4).
 */
export const STALE_ROWS_CLAUSE =
	"The list below is the last one that loaded, so it may be out of date.";

/**
 * The workspace's NAME, as the sentence under `Run in` prints it.
 *
 * `~` is a shell token rather than a directory name, and the store's staged cwd
 * is literally `~` until a workspace is chosen (`canonical-sessions-store.ts`),
 * which printed `Starts in ~ with your default model.` to every user who never
 * picked one (round-2 U1). The token means the home folder - the backend expands
 * it - so it is named rather than shown, and a real directory keeps its own name.
 */
export const workspaceName = (cwd: string): string => {
	const last = cwd.split("/").filter(Boolean).pop() ?? "";
	if (last === "" || last.startsWith("~")) return "your home folder";
	return last;
};

/**
 * Whether the page may say "nothing is scheduled here".
 *
 * The one predicate behind the empty state, and the reason it is a function
 * rather than five terms inline: `read_error` is a 200, so a listing that could
 * not READ the store satisfied `!error` and the page told a user with thirty
 * schedules that they had none and invited them to make one (round-2 D13/U8).
 * Both lists must have settled, both must be genuinely empty, and the wake
 * listing must have been readable.
 */
export const isEmptyListing = (input: {
	loading: boolean;
	error: boolean;
	readError: boolean;
	wakeRows: number;
	legacyLoading: boolean;
	legacyRows: number;
}): boolean =>
	!input.loading &&
	!input.error &&
	!input.readError &&
	!input.legacyLoading &&
	input.wakeRows === 0 &&
	input.legacyRows === 0;

/**
 * The dialog's inline refusals, derived rather than scattered through the JSX.
 *
 * One function per branch would be three places to keep in step; this is the
 * ONLY place the create/edit form decides whether it can be submitted, and each
 * refusal carries the sentence the user reads. Two of the three existed inline in
 * the component before this (the ceiling and the repeat floor); the third is the
 * reviewer's R3 - a prompt past the wire's ceiling was refused by the main
 * process with its generic "Invalid desktop operation.", which is the one refusal
 * in this family a user can neither read nor act on.
 *
 * `alreadyRun` is the EDIT branch's bound: `limit` is the total number of runs a
 * wake may make, so a budget at or below what it has already made is
 * incoherent rather than merely odd (`advance_wake_schedule` retires it on the
 * next fire, so `After 1 run` on a wake that has run three times means "one more
 * and stop" - stated inline instead of discovered).
 */
export type ScheduledTaskInput = {
	message: string;
	/** A conversation must be named on the create branch's existing-conversation arm. */
	needsConversation: boolean;
	/**
	 * Whether the picker has anything to OFFER.
	 *
	 * A second field because the sentence and the guard are two different
	 * questions, and sharing one boolean between them was round 2's N1: the
	 * suppression that keeps "Pick a conversation." from doubling the empty-list
	 * sentence also switched off the refusal, so `invalid` came back false and the
	 * primary button was ENABLED with no destination while the form said `An
	 * existing conversation` - pressing it resolved to `{cwd}` and created a NEW
	 * conversation the user had not chosen. That window is not an edge case: the
	 * picker's read is in flight on every open, so `conversations` is empty for a
	 * moment on the common path.
	 */
	hasConversationChoices: boolean;
	/** `null` when the form is not naming a repeat. */
	repeatMs: number | null;
	/** The `After N runs` bound, or `null`. */
	endsRuns: number | null;
	/** The wakes the target conversation holds; the create branch's ceiling. */
	existingWakeCount: number;
	/** The runs this wake has already made (the edit branch). */
	alreadyRun: number;
};

export type ScheduledTaskRefusals = {
	invalid: boolean;
	/** Under the prompt field. */
	prompt: string;
	/** Under the conversation picker. */
	conversation: string;
	/** Under the Repeat control. */
	repeat: string;
	/** Under the Ends control. */
	ends: string;
};

export const validateScheduledTask = (
	input: ScheduledTaskInput,
): ScheduledTaskRefusals => {
	const length = input.message.trim().length;
	const prompt =
		length > WAKE_MESSAGE_MAX_CHARS
			? `This prompt is ${length.toLocaleString()} characters, and a wake holds at most ${WAKE_MESSAGE_MAX_CHARS.toLocaleString()}. Shorten it to save.`
			: "";
	/*
	 * The SENTENCE yields when there is nothing to pick (the empty-list line
	 * already says why), and it is the only thing that yields: `invalid` below
	 * keeps the raw `needsConversation`, so an empty or still-loading picker
	 * refuses the save instead of writing to a destination the form does not name
	 * (round 2, N1).
	 */
	const conversation =
		input.needsConversation && input.hasConversationChoices
			? "Pick a conversation."
			: "";
	const repeat =
		input.repeatMs !== null && input.repeatMs < MIN_WAKE_INTERVAL_MS
			? "Wakes repeat no more often than once a minute."
			: "";
	const ends =
		input.endsRuns !== null && input.endsRuns <= input.alreadyRun
			? `This wake has already run ${input.alreadyRun} time${input.alreadyRun === 1 ? "" : "s"}, so the run budget has to be at least ${input.alreadyRun + 1}.`
			: "";
	const ceiling =
		input.existingWakeCount >= MAX_WAKE_SCHEDULES
			? `This conversation already has ${input.existingWakeCount} wakes, the most it can hold. Cancel one to add another.`
			: "";
	return {
		invalid:
			length === 0 ||
			length > WAKE_MESSAGE_MAX_CHARS ||
			input.needsConversation ||
			repeat !== "" ||
			ends !== "" ||
			ceiling !== "",
		prompt,
		conversation: ceiling || conversation,
		repeat,
		ends,
	};
};

/**
 * The prompt, flattened to one clause for a toast or a confirm.
 *
 * The designer asked the toast to name the conversation (`Scheduled task
 * created — Read my unread email`) so the auto-derived title is not a surprise
 * later, and the cancel confirm to quote what will not fire again. Both need the
 * SAME head - a user who reads one and then the other is comparing them - so it
 * is derived once, here.
 *
 * Clipped at a word boundary rather than mid-word, and the clipped form drops
 * its own sentence punctuation: `Clean up the invoices sheet…` reads as a label,
 * `Clean up the invoices sheet.…` reads as a mistake.
 */
export const wakePromptHead = (message: string, max = 48): string => {
	const flat = message.replace(/\s+/g, " ").trim();
	if (flat.length <= max) return flat.replace(/[.!?…]+$/g, "").trimEnd();
	const cut = flat.slice(0, max);
	const lastSpace = cut.lastIndexOf(" ");
	return `${cut.slice(0, lastSpace > 24 ? lastSpace : max).trimEnd()}…`;
};

/**
 * A conversation's display name, never empty.
 *
 * The wake index carries no name (it is a derived projection of the
 * transcript), so the backend resolves one through `resume.session_name` - a
 * bounded read that can legitimately come back empty. The fallback is the id
 * plus the directory's own name, so a nameless row is still addressable and
 * still tells the reader where it runs.
 */
export const wakeRowName = (
	name: string,
	sessionId: string,
	cwd: string,
): string => {
	const trimmed = name.trim();
	if (trimmed) return trimmed;
	const directory = cwd.split("/").filter(Boolean).pop() ?? cwd;
	return directory
		? `${sessionId.slice(0, 8)} · ${directory}`
		: sessionId.slice(0, 8);
};

/** One listing row's wakes as the pane's own row type, soonest first. */
const wakeLines = (
	schedules: DesktopWakeScheduleRow[],
	nowMs: number,
): WakeLine[] => {
	const byId = new Map(schedules.map((schedule) => [schedule.id, schedule]));
	return deriveWakes(schedules, nowMs)
		.map((row, index) => {
			const source = byId.get(row.id);
			/*
			 * `deriveWakes` dropped every record it could not identify, so a row it
			 * returned always has its wire row: the guard is for the type, not for a
			 * case the data can reach.
			 */
			if (source === undefined) return null;
			/*
			 * `Ran N times` is derived from `fired_count`, which this wire carries
			 * and the pane's does not. A ONE-SHOT that has fired is absent from the
			 * listing altogether (the scheduler retires it), so a fired count here
			 * always belongs to a recurrence - which is what makes the clause honest
			 * without a second condition.
			 */
			const fired = source.fired_count;
			return {
				...row,
				source,
				position: index + 1,
				ranLabel:
					typeof fired === "number" && fired > 0
						? `Ran ${fired} time${fired === 1 ? "" : "s"}`
						: "",
			};
		})
		.filter((line): line is WakeLine => line !== null);
};

/**
 * One listing entry as a page row, with its head clause already decided.
 *
 * Ordering is the pane's rule lifted from the schedule to the conversation:
 * soonest `next_due_at` first, rows with no future instant last, ties by name.
 * The page's first row is therefore the same answer the pane's first row gives,
 * which is what lets the two surfaces be read together.
 */
/**
 * Whether this page can promise that any instant it prints will fire.
 *
 * `dormant`/`ghost` answer it per row; the SUPERVISOR answers it for the whole
 * machine, and when it answers no, every instant on the page is as wrong as a
 * parked row's (the designer's D2: the strip said nothing would fire while the
 * rows underneath kept asserting `next 2:14 PM EDT`). The parked rule is applied
 * one state over, and the page states the reason once, in the strip.
 */
export type RowOptions = {
	/**
	 * The supervisor's verdict, as `supervisor.supported && supervisor.running`
	 * AND `supervisor.verifiable !== false` - the third term because a store the
	 * probe cannot speak for (`WakeListing.verifiable`) says nothing about
	 * launchd, and reading its silence as "running" would be a claim about
	 * someone else's supervisor.
	 */
	dueInstants?: boolean;
};

export const toScheduledTaskRow = (
	entry: DesktopWakeEntry,
	nowMs: number,
	options: RowOptions = {},
): ScheduledTaskRow => {
	const dueInstants = options.dueInstants !== false;
	const parked = entry.dormant === true || entry.ghost === true;
	/* The row's OWN fact (`parked`) stays separate from the page's
	   (`dueInstants`): the reason differs, and the strip carries one of them. Both
	   mean the instants below must not be printed. */
	const suppressInstants = parked || !dueInstants;
	/*
	 * A parked row drops the INSTANT everywhere on itself, including on its wake
	 * lines: the stored `next_due_at` will not fire (the supervisor skips a
	 * stopped session) and it is not even the instant that will fire later, since
	 * opening the conversation re-arms anything overdue to `now + LOAD_GRACE_MS`.
	 * Printing it would be wrong twice over, in the one state where the reader is
	 * deciding whether the schedule is still real. The prompt and the cadence stay
	 * - they are what the work IS, and they are still true.
	 */
	const wakes = wakeLines(entry.schedules ?? [], nowMs).map((row) =>
		suppressInstants ? { ...row, dueLabel: "" } : row,
	);
	const visible = wakes.slice(0, WAKE_LINE_CAP);
	const nextDueAt =
		entry.next_due_at ?? wakes.find((row) => row.nextDueAt)?.nextDueAt ?? null;
	const head = parked
		? PARKED_CLAUSE
		: wakes.length === 0
			? ""
			: wakes[0].dueLabel
				? `${wakeCountClause(wakes.length)} · next ${wakes[0].dueLabel}`
				: wakeCountClause(wakes.length);
	return {
		sessionId: entry.session_id,
		name: wakeRowName(entry.name, entry.session_id, entry.cwd),
		cwd: entry.cwd,
		parked,
		ghost: entry.ghost === true,
		dueInstants,
		nextDueAt,
		wakes,
		visibleWakes: visible,
		hiddenWakes: wakes.length - visible.length,
		meta: head,
	};
};

/** Every row the page draws, in the order it draws them. */
export const scheduledTaskRows = (
	entries: DesktopWakeEntry[] | undefined,
	nowMs: number,
	options: RowOptions = {},
): ScheduledTaskRow[] =>
	(entries ?? [])
		.map((entry) => toScheduledTaskRow(entry, nowMs, options))
		/*
		 * An entry with no wakes is not a row: the listing is built from the wake
		 * index, so this is a store whose last wake just retired, and the page
		 * must drop it in the same frame it learns (the pane's "absence is not a
		 * state" rule, one surface over).
		 */
		.filter((row) => row.wakes.length > 0)
		.sort(
			(a, b) =>
				(a.nextDueAt ?? Number.POSITIVE_INFINITY) -
					(b.nextDueAt ?? Number.POSITIVE_INFINITY) ||
				a.name.localeCompare(b.name),
		);

/**
 * One legacy schedule's cadence, through the wake vocabulary.
 *
 * The fenced group renders on the page beside the wake rows, and two cadence
 * grammars in one panel is how a page reads as two products: `every 15 minutes
 * at 7 minutes past, from Sunday, March 15` beside `every 15m` is a second
 * product's sentence. So the same `every <duration>` / `once` vocabulary is
 * used, and the bounds a legacy row has and a wake does not are named as
 * clauses in the same voice rather than folded into the recurrence sentence.
 *
 * `unit` is `minutes | hours | days` (the legacy model has no weeks), and
 * `one_time` means the row fires once at `start_time_utc`.
 */
export const legacyScheduleCadence = (
	schedule: ScheduleResponse,
	nowMs: number,
): string => {
	/* `Date.parse` answers NaN for an unparseable stamp, and a NaN instant would
	   render as `Invalid Date` in the label: both bounds are therefore read once,
	   as `number | null`, and a bound that cannot be read reads as ABSENT rather
	   than as a broken label. */
	const readBound = (value: string | null | undefined): number | null => {
		const parsed = value ? Date.parse(value) : Number.NaN;
		return Number.isFinite(parsed) ? parsed : null;
	};
	const start = readBound(schedule.start_time_utc);
	const end = readBound(schedule.end_time_utc);
	/*
	 * Every clause here is NAMED (`starts`, `at`, `until`), which is the
	 * designer's D5: the first version led with `from 9:16 AM EDT` while the wake
	 * lines above led with a clock, so reading down the page the first token
	 * silently changed kind and `from` was doing work no user could decode.
	 */
	if (schedule.one_time) {
		return start === null ? "once" : `once · at ${formatWakeDue(start, nowMs)}`;
	}
	const cadence = formatWakeCadence(
		schedule.interval * UNIT_MS[schedule.unit],
		null,
	);
	if (end !== null) return `${cadence} · until ${formatWakeDue(end, nowMs)}`;
	if (start !== null) {
		return `${cadence} · starts ${formatWakeDue(start, nowMs)}`;
	}
	return cadence;
};

/** A repeat the dialog built, as the tool's own duration string (`2h`, `1w`). */
export const repeatEveryString = (
	count: number,
	unit: "minutes" | "hours" | "days" | "weeks",
): string => `${count}${unit.charAt(0)}`;

/**
 * Whether a wake WRITE may be sent a second time.
 *
 * Kept in the model rather than beside the hook that uses it, and exported, for
 * the reason this repo's `defaultQueryOptions` gives for its own placement: a
 * verification surface has to be able to CONSTRUCT a policy rather than
 * approximate it. This is the one piece of the feature that produced a
 * user-visible defect on the drive, and until round 2 it had no pin at all (M1).
 *
 * The app's query client retries a mutation once by default, and for this family
 * that default is wrong in a way a user can see. A write here is at-most-once:
 * the backend keeps a receipt per `request_id`, so a retry of a request that
 * already ran replays the first attempt's outcome. But a request that was
 * REFUSED (a 409, a 422) leaves its receipt claimed and unresolved, so the retry
 * is answered with the journal's own sentence - "Request outcome is
 * indeterminate. Reconcile session state before issuing a new request" - and the
 * reason the user needed ("at most 16 wake schedules are allowed.") is replaced
 * by an internal one. Measured on the live drive, against a conversation at the
 * cap: two 409s in the backend log, and the indeterminate sentence on screen.
 *
 * So the retry is kept for exactly the case the receipt exists for - a request
 * that never got an answer, where re-sending is the only way to learn the
 * outcome - and refused for every request the backend DID answer.
 *
 * **Which failures those are is the repo's existing reading, not a new one.**
 * This predicate shipped comparing `status === null`, on the claim that `null`
 * names "the transport never answered". It does not, in the app that ships:
 * `src/main/desktop-transport.ts` catches every fetch throw - a refused socket,
 * a reset, and its own 20 s `AbortSignal.timeout` - and returns a SYNTHESISED 503
 * with `answered: false`, so the renderer never sees `null` for those. Round 2's
 * reviewer reproduced both against the real transport (ECONNREFUSED, and an
 * accept-and-never-answer past the 20 s abort): `status = 503`,
 * `answered = false` each time. `null` reaches the renderer only when the IPC
 * call itself rejects or main never replies within its own 30 s deadline - "main
 * is wedged" - which is not the case a receipt can be learned from, so the old
 * predicate fired where nothing had been sent and was withheld from the case the
 * receipt exists for.
 *
 * `isServerUnreachable` is this repo's one reading of that pair (`null` is a
 * transport that never produced a response, 503 is the relay saying it could
 * not), already used by the compatibility banner and the stop path. A second,
 * narrower reading of one status in a sibling file is the shape this repo's notes
 * keep flagging, so this uses that judgement instead of restating it.
 *
 * `failureCount < 1` is exactly one retry, which is what TanStack v5 means by it:
 * the callback is first called with `failureCount === 0`.
 */
export const retryWakeWrite = (failureCount: number, error: Error): boolean =>
	isServerUnreachable(error) ? failureCount < 1 : false;
