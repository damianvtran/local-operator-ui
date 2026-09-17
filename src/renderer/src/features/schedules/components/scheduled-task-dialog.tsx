/**
 * "New scheduled task": the one dialog that creates a conversation and arms it.
 *
 * ## What it creates, exactly
 *
 * A scheduled task IS a wake inside a conversation (the primitive was
 * harmonized onto the harness's `wakes`; the older agent-schedule engine is
 * frozen and fenced below this page's list). On the "A new conversation" branch
 * the conversation is created by the same request that arms it, so a failure
 * cannot leave an armed wake with no transcript to fire into.
 *
 * The conversation's NAME is the prompt - the backend writes it into the
 * session's stored-title sidecar, which `resume.session_name` consults first -
 * which is why there is no `Name` field here. A field nobody would fill in
 * would still need the model title later, and ten scheduled conversations named
 * after the same working directory is what the alternative looks like.
 *
 * **Creating does not start a turn.** The first turn is the wake's: creating a
 * task is arming, not running it now, and a dialog that fired the prompt
 * immediately would be a Send button wearing a schedule's label.
 *
 * ## The approval sentence, and why it is on the dialog
 *
 * A wake-fired turn runs with the session's own unattended posture: a tool that
 * needs approval PARKS the turn until the gate times out (`runtime
 * .unattended_gate_timeout`), where a legacy schedule ran with `yolo=True` and
 * never asked. That difference is invisible until it stops work, so the dialog
 * states it in one line rather than leaving it to be discovered at 9am.
 *
 * ## The ceiling is stated before the press
 *
 * A conversation holds at most `MAX_WAKE_SCHEDULES` wakes. At that ceiling the
 * create is refused with the REASON inline and the action disabled, rather than
 * by a 422 after the press: the cap is only reachable on the "An existing
 * conversation" branch, and the count it is measured against is already in the
 * listing this page holds.
 *
 * ## The same dialog edits one wake
 *
 * `edit` puts the same form on an ARMED wake (`wakes.edit`): the conversation is
 * already decided, so `Run in` is absent, and every timing control gains a
 * `keep` option as its default, because a PATCH says only what should change —
 * an omitted field is "leave this alone", never "clear this". That distinction
 * is the whole reason the edit branch looks different from the create branch:
 * on create an omitted `every` means a one-shot, and on edit it means nothing at
 * all.
 *
 * What a timing change DOES is stated rather than implied: the backend replaces
 * the schedule's due anchor, so the next fire is the one the user just picked
 * and deliveries already made stay counted. The designer's record refused an
 * edit in its first version, on the grounds that a replace cannot preserve the
 * anchor; the interface now has an op for it, so the dialog says what the op
 * does instead of offering nothing.
 */
import { formatAge } from "@features/chat/pickers/usage-view-model";
import type { DesktopWakeScheduleRow } from "@shared/api/local-operator/wakes-api";
import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { DateTimePicker } from "@shared/components/common/date-time-picker";
import {
	Button,
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Textarea,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { Plus } from "lucide-react";
import type { FC } from "react";
import { useEffect, useId, useMemo, useState } from "react";
import {
	useConversationChoices,
	useCreateScheduledTask,
	useEditWake,
	useWakesListing,
} from "../hooks/use-wakes-queries";
import {
	keepEndsLabel,
	keepFirstRunLabel,
	keepRepeatLabel,
	validateScheduledTask,
	workspaceName,
} from "../scheduled-task-model";
import { repeatEveryString, wakePromptHead } from "../scheduled-task-model";

/** Which conversation the task runs in. */
type Destination = "new" | "existing";

/** The `First run` presets, in the order the design offers them. */
type FirstRunPreset =
	| "keep"
	| "in-an-hour"
	| "in-30-minutes"
	| "tonight"
	| "tomorrow"
	| "pick";

/** Hour of the `Tonight at 8:00 PM` preset, local. */
const TONIGHT_HOUR = 20;
/** Hour of the `Tomorrow at 9:00 AM` preset, local. */
const TOMORROW_HOUR = 9;
const MINUTE_MS = 60_000;

const REPEAT_UNITS = ["minutes", "hours", "days", "weeks"] as const;
type RepeatUnit = (typeof REPEAT_UNITS)[number];

const REPEAT_UNIT_LABEL: Record<RepeatUnit, string> = {
	minutes: "Minutes",
	hours: "Hours",
	days: "Days",
	weeks: "Weeks",
};

const REPEAT_UNIT_MS: Record<RepeatUnit, number> = {
	minutes: MINUTE_MS,
	hours: 60 * MINUTE_MS,
	days: 24 * 60 * MINUTE_MS,
	weeks: 7 * 24 * 60 * MINUTE_MS,
};

type Ends = "never" | "date" | "runs" | "keep";
/** How a wake repeats: `never`/`every` on create, plus `keep` on edit. */
type RepeatMode = "never" | "every" | "keep";

/**
 * What the editor needs to name the wake it is editing.
 *
 * Deliberately NOT the whole wire row: the dialog has no use for the fired
 * count or the lateness telemetry, and requiring them would make the caller
 * carry a payload it does not otherwise hold. What it does need is the prompt
 * (the field the user came to change) and the two ids the route keys on.
 */
export type WakeEditTarget = {
	sessionId: string;
	wakeId: string;
	/** The armed wake's current prompt, as the field's starting value. */
	message: string;
	/**
	 * The conversation the wake lives in, and the wake's place in it.
	 *
	 * The designer's D3: the editor is the one surface on this feature where the
	 * user decides with the value hidden, and "wake 2 of 4" plus the name is what
	 * tells them WHICH schedule the three `keep` options below are keeping.
	 */
	conversationName: string;
	position: number;
	count: number;
	/** The wake's own values, for the `keep` labels and the run-budget bound. */
	wake: DesktopWakeScheduleRow;
	/** Whether its conversation is stopped, where the instant is not kept. */
	parked: boolean;
};

export type ScheduledTaskDialogProps = {
	open: boolean;
	onClose: () => void;
	/**
	 * The instant the presets and the relative labels are derived against.
	 *
	 * Injectable for the same reason the run pane's model takes `nowMs`: a story
	 * that pins it renders the SAME frame on every capture, so a diff means the
	 * code moved. In the app it is the clock.
	 */
	nowMs?: number;
	/**
	 * Set to EDIT one armed wake instead of creating one.
	 *
	 * The wake names its own conversation (and its own id), which is why the
	 * dialog does not need a destination when this is set: a wake is edited where
	 * it lives.
	 */
	edit?: WakeEditTarget | null;
};

export const ScheduledTaskDialog: FC<ScheduledTaskDialogProps> = ({
	open,
	onClose,
	nowMs = Date.now(),
	edit = null,
}) => {
	const isEdit = edit !== null;
	const [destination, setDestination] = useState<Destination>("new");
	const [conversationId, setConversationId] = useState<string | null>(null);
	const [prompt, setPrompt] = useState("");
	const [preset, setPreset] = useState<FirstRunPreset>("in-an-hour");
	const [pickedAt, setPickedAt] = useState<string | null>(null);
	const [repeatMode, setRepeatMode] = useState<RepeatMode>("never");
	const [repeatCount, setRepeatCount] = useState<number | "">(1);
	const [repeatUnit, setRepeatUnit] = useState<RepeatUnit>("hours");
	const [ends, setEnds] = useState<Ends>("never");
	const [endsAt, setEndsAt] = useState<string | null>(null);
	const [endsRuns, setEndsRuns] = useState<number | "">(2);
	const [requestId, setRequestId] = useState(() => crypto.randomUUID());

	/*
	 * Two reads, two questions: WHICH conversations exist (the picker) and how
	 * many wakes one already has (the ceiling). The picker is not built on the
	 * wake listing: that list is keyed on conversations that already have wakes,
	 * so a picker built on it could only offer the ones a user has already
	 * scheduled - and the branch exists precisely to arm a wake in a conversation
	 * that has none.
	 */
	const choices = useConversationChoices(open);
	const listing = useWakesListing();
	const refetchListing = listing.refetch;
	/*
	 * Ask for the count when the question is asked.
	 *
	 * The ceiling this dialog states is a claim about how many wakes a
	 * conversation holds RIGHT NOW, and the listing behind it polls on a 30 s
	 * interval and is otherwise read once at page load (the dialog is mounted for
	 * the page's whole life, so there is no mount to refetch on). A dialog opened
	 * inside that window would state a count it cannot know - measured on the live
	 * drive: sixteen wakes armed behind the page's back, and the ceiling sentence
	 * absent because the listing still said zero. One small read per open is the
	 * price of the sentence being true.
	 */
	useEffect(() => {
		if (open) void refetchListing();
	}, [open, refetchListing]);
	const createTask = useCreateScheduledTask();
	const editWake = useEditWake();
	const newConversationCwd = useCanonicalSessionsStore((state) => state.cwd);
	/* One flag for the footer's disabled state, whichever write is running. */
	const pending = createTask.isPending || editWake.isPending;
	const ids = useId();

	/*
	 * A reopened dialog starts clean, and a fresh request id comes with it: the
	 * server keys its at-most-once receipt on the request id, so reusing one
	 * after a successful create would make the next task a replay of the first.
	 */
	useEffect(() => {
		if (!open) return;
		setDestination("new");
		setConversationId(null);
		setPrompt(edit?.message ?? "");
		/*
		 * On create, a first run is required and the common answer is offered by
		 * default. On edit, the stored anchor is the default: the schedule already
		 * has one, and re-picking it would be a change the user did not ask for.
		 */
		setPreset(isEdit ? "keep" : "in-an-hour");
		setPickedAt(null);
		setRepeatMode(isEdit ? "keep" : "never");
		setRepeatCount(1);
		setRepeatUnit("hours");
		setEnds(isEdit ? "keep" : "never");
		setEndsAt(null);
		setEndsRuns(2);
		setRequestId(crypto.randomUUID());
	}, [open, edit, isEdit]);

	/*
	 * `Tonight at 8:00 PM` is offered only while tonight's 8pm is still ahead: a
	 * preset whose instant has passed is a request the backend refuses as a past
	 * time, and that refusal would be about arithmetic this dialog can see
	 * coming. The other three always name a future instant.
	 */
	const tonight = useMemo(() => {
		const at = new Date(nowMs);
		at.setHours(TONIGHT_HOUR, 0, 0, 0);
		return at.getTime() > nowMs + MINUTE_MS ? at : null;
	}, [nowMs]);

	const tomorrow = useMemo(() => {
		const at = new Date(nowMs);
		at.setDate(at.getDate() + 1);
		at.setHours(TOMORROW_HOUR, 0, 0, 0);
		return at;
	}, [nowMs]);

	/* Newest first, which is the order the sidebar's own list is read in. */
	const conversations = useMemo(
		() => [...(choices.data ?? [])].sort((a, b) => b.mtime - a.mtime),
		[choices.data],
	);
	const selectedConversation = conversations.find(
		(entry) => entry.id === conversationId,
	);

	/*
	 * The ceiling is the wake listing's answer about the SELECTED conversation,
	 * not a property of the picker's rows: `sessions.list` says nothing about
	 * wakes, and the count has to be the one the page would create against.
	 */
	const existingWakeCount =
		listing.data?.entries.find((entry) => entry.session_id === conversationId)
			?.schedules.length ?? 0;

	const repeatMs =
		repeatMode === "every" && repeatCount !== ""
			? repeatCount * REPEAT_UNIT_MS[repeatUnit]
			: null;

	const needsConversation =
		!isEdit && destination === "existing" && !conversationId;
	const needsPick = preset === "pick" && !pickedAt;
	const needsEndDate = ends === "date" && !endsAt;
	const needsEndRuns = ends === "runs" && endsRuns === "";

	/*
	 * Every refusal the form can state inline comes from ONE derivation, so the
	 * sentence a user reads cannot drift from the condition that produced it -
	 * and so the matrix is testable without a renderer
	 * (`scripts/scheduled-task-model.test.mjs`). The three `needs*` gates below
	 * are "the field is still empty" rather than refusals: they disable the
	 * action and carry no sentence, because the control they sit on already says
	 * what it wants.
	 */
	const refusals = validateScheduledTask({
		message: prompt,
		/*
		 * The guard and the sentence are separate inputs, deliberately (round 2,
		 * N1). `needsConversation` is passed RAW, so an empty or still-loading
		 * picker refuses the save; `hasConversationChoices` suppresses only the
		 * "Pick a conversation." sentence, which would otherwise be the second
		 * reason for one absence while the empty-list line already gives the first.
		 * Folding them into one `&&` was the defect: it switched the guard off with
		 * the copy, and `Create` then armed `{cwd}` - a new conversation - while the
		 * form said `An existing conversation`.
		 */
		needsConversation,
		hasConversationChoices: conversations.length > 0,
		repeatMs,
		endsRuns: ends === "runs" && endsRuns !== "" ? endsRuns : null,
		existingWakeCount,
		alreadyRun: edit?.wake.fired_count ?? 0,
	});
	const invalid = refusals.invalid || needsPick || needsEndDate || needsEndRuns;

	/*
	 * The designer's D11: the dialog opens on all three `keep` defaults with the
	 * prompt already filled, so an enabled `Save` is a button whose press would
	 * PATCH nothing. Dirtiness is "a field differs from the value it started
	 * with", which for the timing controls is exactly "not on `keep`".
	 */
	const dirty =
		!isEdit ||
		prompt !== edit.message ||
		preset !== "keep" ||
		repeatMode !== "keep" ||
		ends !== "keep";

	/*
	 * The workspace a NEW conversation starts in, which is the store's staged cwd
	 * - the same value the chat pane sends on its first message, so the two
	 * cannot disagree about where a fresh conversation lives. The name shown is
	 * the directory's own, because a path is not a name - and `~` is a shell
	 * token rather than a name, which is what the sentence used to print
	 * (round-2 U1; `workspaceName` names the home folder instead).
	 */
	const workspaceDirectory = workspaceName(newConversationCwd);

	/**
	 * The first-run the form names, or `null` when it names none.
	 *
	 * `null` is a real answer on the edit branch (`keep`), and it is why this
	 * returns `null` rather than throwing: the caller must OMIT the timing fields
	 * entirely, because the backend reads an absent `at`/`in` as "leave the
	 * anchor alone".
	 */
	const firstRun = (): { in: string } | { at: string } | null => {
		if (preset === "keep") return null;
		if (preset === "in-30-minutes") return { in: "30m" };
		if (preset === "in-an-hour") return { in: "1h" };
		if (preset === "tonight")
			return tonight ? { at: tonight.toISOString() } : null;
		if (preset === "tomorrow") return { at: tomorrow.toISOString() };
		return pickedAt ? { at: pickedAt } : null;
	};

	const handleSubmit = async () => {
		if (invalid) return;
		const when = firstRun();
		try {
			if (edit) {
				await editWake.mutateAsync({
					sessionId: edit.sessionId,
					wakeId: edit.wakeId,
					message: prompt.trim(),
					...(when ? { firstRun: when } : {}),
					/*
					 * Only the fields the user CHANGED go out: an omitted `every`
					 * leaves the recurrence alone, which is what `keep` means, and a
					 * recurrence the user did change is re-bounded by whatever the
					 * `Ends` control says (`keep` omits both bounds).
					 */
					...(repeatMode === "every" && repeatCount !== ""
						? { every: repeatEveryString(repeatCount, repeatUnit) }
						: {}),
					...(repeatMode === "every" && ends === "date" && endsAt
						? { until: endsAt }
						: {}),
					...(repeatMode === "every" && ends === "runs" && endsRuns !== ""
						? { limit: endsRuns }
						: {}),
				});
				showSuccessToast(`Wake updated — ${wakePromptHead(prompt.trim())}`);
				onClose();
				return;
			}
			const created = await createTask.mutateAsync({
				requestId,
				...(conversationId
					? { sessionId: conversationId }
					: { cwd: newConversationCwd }),
				message: prompt.trim(),
				/* A create always names a first run; `keep` is unreachable here. */
				firstRun: when ?? { in: "1h" },
				...(repeatMode === "every" && repeatCount !== ""
					? { every: repeatEveryString(repeatCount, repeatUnit) }
					: {}),
				...(repeatMode === "every" && ends === "date" && endsAt
					? { until: endsAt }
					: {}),
				...(repeatMode === "every" && ends === "runs" && endsRuns !== ""
					? { limit: endsRuns }
					: {}),
			});
			/*
			 * The toast names the CONVERSATION, by the head of the prompt that
			 * became its name: the title is derived, and meeting it first in a toast
			 * is how it stops being a surprise in the sidebar.
			 *
			 * `index_written: false` is a 200 with a caveat - the wake is armed in
			 * the transcript and the DERIVED index write failed, so the listing this
			 * dialog just invalidated may answer without it for a moment (the
			 * reviewer's R7). Saying so beats a row the user cannot find.
			 */
			showSuccessToast(
				created.index_written
					? `Scheduled task created — ${wakePromptHead(prompt.trim())}`
					: `Scheduled task created — ${wakePromptHead(prompt.trim())}. The list may lag until the index catches up.`,
			);
			/*
			 * The page does not navigate away. The user just made a row on this
			 * page and should see it arrive; the row is what opens the conversation,
			 * and the listing has already been invalidated by the mutation.
			 */
			onClose();
		} catch (error) {
			showErrorToast(
				error instanceof Error
					? `${isEdit ? "Could not save the wake" : "Could not create the scheduled task"}: ${error.message}`
					: isEdit
						? "Could not save the wake."
						: "Could not create the scheduled task.",
			);
		}
	};

	const actions = (
		<>
			<SecondaryButton onClick={onClose} disabled={pending}>
				Cancel
			</SecondaryButton>
			<PrimaryButton
				onClick={handleSubmit}
				disabled={invalid || pending || !dirty}
				startIcon={<Plus size={18} />}
			>
				{isEdit
					? pending
						? "Saving"
						: "Save"
					: pending
						? "Creating"
						: "Create"}
			</PrimaryButton>
		</>
	);

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={isEdit ? "Edit wake" : "New scheduled task"}
			actions={actions}
			maxWidth="sm"
			fullWidth
			dataTourTag="create-scheduled-task-dialog"
		>
			{/* The designer's D3, first line of the body: which schedule the three
			    `keep` controls below are keeping, named the way the row names it. */}
			{edit && (
				<p className="text-body-sm text-ink-dim">
					{edit.conversationName} · wake {edit.position} of {edit.count}
				</p>
			)}
			{/* One column: the fields are long strings, and the two-column grid this
			    replaces split "Interval" and "Unit" across cells of unequal width for
			    no reason. */}
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${ids}-prompt`}>
						Prompt <span className="text-danger">*</span>
					</Label>
					<Textarea
						id={`${ids}-prompt`}
						name="prompt"
						value={prompt}
						onChange={(event) => setPrompt(event.target.value)}
						rows={3}
						disabled={pending}
						placeholder="Send me an email with a detailed world news breakdown"
					/>
					<p className="text-body-sm text-ink-muted">
						This is the message the conversation receives when it wakes up.
					</p>
					{/* The wire's own ceiling, stated where the value is: past it the main
					    process would refuse the whole request with "Invalid desktop
					    operation.", which is the one refusal here a user cannot act on. */}
					{refusals.prompt && (
						<p className="text-meta text-danger">{refusals.prompt}</p>
					)}
				</div>

				{/* Absent on edit: a wake's conversation is where it lives, so there is
				    no destination to choose. */}
				{!isEdit && (
					<fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
						<legend className="sr-only">Run in</legend>
						<Label>Run in</Label>
						{/* A segmented pair rather than `Tabs`: the two options change what
					    runs, they do not swap panels, so `aria-pressed` describes what
					    these are (the idiom the Settings page's metric pair uses). */}
						<div className="flex w-fit gap-0.5 rounded-md bg-sunken p-0.5">
							{(
								[
									["new", "A new conversation"],
									["existing", "An existing conversation"],
								] as const
							).map(([id, label]) => (
								<Button
									key={id}
									variant="ghost"
									size="sm"
									aria-pressed={destination === id}
									onClick={() => setDestination(id)}
									disabled={pending}
									className={cn(
										destination === id &&
											"bg-surface text-ink hover:bg-surface",
									)}
								>
									{label}
								</Button>
							))}
						</div>
					</fieldset>
				)}

				{!isEdit && destination === "existing" && (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${ids}-conversation`}>Conversation</Label>
						<Select
							value={conversationId ?? ""}
							onValueChange={setConversationId}
							disabled={pending}
						>
							<SelectTrigger id={`${ids}-conversation`}>
								<SelectValue placeholder="Pick a conversation" />
							</SelectTrigger>
							<SelectContent>
								{conversations.map((entry) => (
									<SelectItem
										key={entry.id}
										value={entry.id}
										textValue={entry.name || entry.id.slice(0, 8)}
									>
										{entry.name || `Untitled ${entry.id.slice(0, 8)}`}
										<span className="pl-2 text-ink-dim">
											{/* `mtime` is epoch seconds on this wire (see
											    `ConversationChoice`); the dialog's own clock is ms. */}
											{formatAge(Math.max(0, nowMs - entry.mtime * 1000))}
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{/*
						 * An empty picker states WHY it is empty and what to do instead.
						 * The control it replaces was disabled with no reason shown, which
						 * reads as a broken dialog: "there is nothing here" and "you may not
						 * use this" are different sentences and only one of them is true.
						 */}
						{choices.isLoading && (
							<p className="text-meta text-ink-dim">Loading conversations…</p>
						)}
						{choices.error && (
							<p className="text-meta text-danger">
								Could not read your conversations: {choices.error.message}
							</p>
						)}
						{!choices.isLoading &&
							!choices.error &&
							conversations.length === 0 && (
								<p className="text-meta text-ink-dim">
									No conversations yet — start one in chat, or choose{" "}
									<em>A new conversation</em>.
								</p>
							)}
					</div>
				)}

				{!isEdit && destination === "new" && (
					<p className="text-body-sm text-ink-dim">
						Starts in {workspaceDirectory} with your default model.
					</p>
				)}
				{/*
				 * The existing-conversation branch's own consequence line, which the
				 * first version was missing entirely: choosing it removed the
				 * new-conversation sentence and replaced it with nothing, so the branch
				 * that writes into work the user already has was the one that said least
				 * about what it would do (the designer's D10).
				 *
				 * It does NOT name the conversation's model. `sessions.list` carries no
				 * model for a session (`SessionRow`: id, name, mtime, preview plus
				 * decorations), and inventing one from the picker's `binding` would be a
				 * claim about which provider runs the turn - recorded as deferred rather
				 * than asserted.
				 */}
				{!isEdit && destination === "existing" && selectedConversation && (
					<p className="text-body-sm text-ink-dim">
						Runs in {selectedConversation.name}, as a turn in that conversation.
					</p>
				)}
				{!isEdit && refusals.conversation && (
					<p className="text-meta text-danger">{refusals.conversation}</p>
				)}

				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${ids}-first-run`}>First run</Label>
					<Select
						value={preset}
						onValueChange={(value) => setPreset(value as FirstRunPreset)}
						disabled={pending}
					>
						<SelectTrigger id={`${ids}-first-run`}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{isEdit && (
								<SelectItem value="keep">
									{keepFirstRunLabel(edit.wake, nowMs, edit.parked)}
								</SelectItem>
							)}
							<SelectItem value="in-an-hour">In an hour</SelectItem>
							<SelectItem value="in-30-minutes">In 30 minutes</SelectItem>
							{tonight && (
								<SelectItem value="tonight">Tonight at 8:00 PM</SelectItem>
							)}
							<SelectItem value="tomorrow">Tomorrow at 9:00 AM</SelectItem>
							<SelectItem value="pick">Pick a time…</SelectItem>
						</SelectContent>
					</Select>
					{preset === "pick" && (
						<DateTimePicker
							label="First run at"
							value={pickedAt}
							onChange={setPickedAt}
							disabled={pending}
						/>
					)}
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${ids}-repeat`}>Repeat</Label>
					<Select
						value={repeatMode}
						onValueChange={(value) => setRepeatMode(value as RepeatMode)}
						disabled={pending}
					>
						<SelectTrigger id={`${ids}-repeat`}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{isEdit && (
								<SelectItem value="keep">
									{keepRepeatLabel(edit.wake)}
								</SelectItem>
							)}
							<SelectItem value="never">Don't repeat</SelectItem>
							<SelectItem value="every">Every</SelectItem>
						</SelectContent>
					</Select>
					{repeatMode === "every" && (
						<div className="flex items-center gap-2">
							<Input
								type="number"
								min={1}
								aria-label="Repeat interval"
								className="w-24"
								value={repeatCount}
								onChange={(event) =>
									setRepeatCount(
										event.target.value === ""
											? ""
											: Number.parseInt(event.target.value, 10),
									)
								}
								disabled={pending}
							/>
							<Select
								value={repeatUnit}
								onValueChange={(value) => setRepeatUnit(value as RepeatUnit)}
								disabled={pending}
							>
								<SelectTrigger aria-label="Repeat unit" className="w-36">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{REPEAT_UNITS.map((unit) => (
										<SelectItem key={unit} value={unit}>
											{REPEAT_UNIT_LABEL[unit]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}
					{refusals.repeat && (
						<p className="text-meta text-danger">
							Wakes repeat no more often than once a minute.
						</p>
					)}
				</div>

				{/* Shown only when the form is naming a repeat: a one-shot already
				    fires exactly once, so bounds on it would promise a behaviour it
				    does not have - and on the edit branch `keep` means the repeat is
				    whatever the wake already has, which this control must not restate. */}
				{(repeatMode === "every" || ends !== "never") && (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${ids}-ends`}>Ends</Label>
						<Select
							value={ends}
							onValueChange={(value) => setEnds(value as Ends)}
							disabled={pending}
						>
							<SelectTrigger id={`${ids}-ends`}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{isEdit && (
									<SelectItem value="keep">
										{keepEndsLabel(edit.wake, nowMs)}
									</SelectItem>
								)}
								<SelectItem value="never">Never</SelectItem>
								<SelectItem value="date">On a date…</SelectItem>
								<SelectItem value="runs">After N runs</SelectItem>
							</SelectContent>
						</Select>
						{ends === "date" && (
							<DateTimePicker
								label="Last run"
								value={endsAt}
								onChange={setEndsAt}
								disabled={pending}
							/>
						)}
						{ends === "runs" && (
							<Input
								type="number"
								min={1}
								aria-label="Number of runs"
								className="w-24"
								value={endsRuns}
								onChange={(event) =>
									setEndsRuns(
										event.target.value === ""
											? ""
											: Number.parseInt(event.target.value, 10),
									)
								}
								disabled={pending}
							/>
						)}
						{/* A run budget the wake has already met, refused with the reason:
						    `limit` is the TOTAL a wake may run, so `After 1 run` on a wake
						    that has run three times means "one more and stop" - the
						    designer's D3 point 4, stated rather than discovered. */}
						{refusals.ends && (
							<p className="text-meta text-danger">{refusals.ends}</p>
						)}
					</div>
				)}

				{/* The approval posture, in one line. A wake-fired turn keeps the
				    session's own unattended posture, so a tool that needs approval
				    PARKS rather than being auto-granted the way the legacy engine's
				    `yolo=True` runs were. Stated here because the difference is
				    invisible until something waits. */}
				<p className="text-body-sm text-ink-dim">
					If a tool needs approval, the wake parks and waits for you rather than
					acting on its own; a wait that runs out stops the turn without running
					the tool.
				</p>
				{/*
				 * What a save DOES, in one sentence, because the cases are one rule:
				 * `build_wake_edit` moves the due anchor only when the request carries
				 * `in`/`at` (`moves_time`), so a new first run moves the next fire and
				 * nothing else does - not the repeat, not a bound, not the prompt
				 * (`pinned_due_ms` keeps the row's own instant). The two earlier
				 * variants said this only until the user changed the repeat, which is
				 * the change that made the old sentence false (the reviewer's R2).
				 *
				 * The second clause is the designer's D3 point 2: runs are not reset
				 * (`fired_count` survives, so `Ran 3 times` stays on the row and a
				 * `limit` still counts against them); the third is that the row is the
				 * same row, which is why an edit is offered at all.
				 */}
				{isEdit && (
					<p className="text-body-sm text-ink-dim">
						A new first run moves the next wake to that time, and a new repeat
						carries on from it. Runs already made still count, and the wake
						keeps its place in the conversation.
					</p>
				)}
				{/* The chat route LAST rather than first: it is honest and it is not
				    the form's first instruction (design finding D8). */}
				{!isEdit && (
					<p className="text-body-sm text-ink-dim">
						It is usually quicker to ask an agent in chat — "send me the latest
						news at 8am every day" — and it will set this up for you.
					</p>
				)}
			</div>
		</BaseDialog>
	);
};
