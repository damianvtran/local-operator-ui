import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import {
	type SkillAdoptionPreview,
	type SkillAdoptionStrategy,
	skillAdoptionPreviewSchema,
	skillPullDidWrite,
} from "@shared/api/local-operator/hub-skill-adoption";
import { Button } from "@shared/components/ui/button";
import { Checkbox } from "@shared/components/ui/checkbox";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useId, useRef, useState } from "react";
import {
	type PullHubSkillInput,
	usePullHubSkill,
} from "../hooks/use-hub-skills";

export type AdoptionReviewState = {
	preview: SkillAdoptionPreview | null;
	pending: boolean;
	applied: boolean;
	error: "stale" | "failed" | null;
};

const actionKeys = {
	same: "ui.hub.adoption.file_same",
	"hub-only": "ui.hub.adoption.file_hub",
	"local-only": "ui.hub.adoption.file_local",
	"kept-local": "ui.hub.adoption.file_local",
	"taken-hub": "ui.hub.adoption.file_hub",
	merged: "ui.hub.adoption.file_merged",
	"set-aside": "ui.hub.adoption.file_aside",
	"needs-choice": "ui.hub.adoption.file_choice",
	carried: "ui.hub.adoption.file_carried",
	"not-adopted": "ui.hub.adoption.file_not_adopted",
} as const;

function ReviewText({ text, diff = false }: { text: string; diff?: boolean }) {
	return (
		<pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded border border-hairline bg-surface p-3 font-mono text-body-sm text-ink">
			{text || (diff ? t("ui.hub.adoption.no_difference") : "")}
		</pre>
	);
}

/** Shared by the live flow and its rendered fixtures; never abbreviates content. */
export function HubSkillAdoptionReview({
	state,
	allowLlm,
	onAllowLlm,
	onPreview,
	onConfirm,
	onCancel,
}: {
	state: AdoptionReviewState;
	allowLlm: boolean;
	onAllowLlm: (value: boolean) => void;
	onPreview: (strategy: SkillAdoptionStrategy) => void;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	useI18nLocale();
	const checkboxId = useId();
	const { preview, pending, applied, error } = state;
	const needsChoice = preview?.adoption.state === "needs-choice";
	if (applied)
		return (
			<div aria-live="polite" className="space-y-2 text-body-sm text-success">
				<p>{t("ui.hub.adoption.applied")}</p>
				{preview && (
					<p className="break-all text-ink-muted">
						{t("ui.hub.adoption.snapshot", { path: preview.snapshot.path })}
					</p>
				)}
				<Button variant="outline" onClick={onCancel}>
					{t("ui.hub.adoption.done")}
				</Button>
			</div>
		);
	return (
		<section
			aria-label={t("ui.hub.adoption.title")}
			className="min-w-0 space-y-4 rounded border border-warning-border p-4"
			data-testid="hub-skill-adoption"
		>
			<h3 className="text-body font-medium text-ink">
				{t("ui.hub.adoption.title")}
			</h3>
			<p className="text-body-sm text-ink-muted">
				{t("ui.hub.adoption.preservation")}
			</p>
			<div className="flex items-start gap-2">
				<Checkbox
					id={checkboxId}
					checked={allowLlm}
					disabled={pending || !!preview}
					onCheckedChange={(checked) => onAllowLlm(checked === true)}
				/>
				<label htmlFor={checkboxId} className="text-body-sm text-ink">
					{t("ui.hub.adoption.model_consent")}
				</label>
			</div>
			{pending && (
				<p aria-live="polite" className="text-body-sm text-ink-muted">
					{t("ui.hub.adoption.loading")}
				</p>
			)}
			{error && (
				<p role="alert" className="text-body-sm text-danger">
					{t(
						error === "stale"
							? "ui.hub.adoption.stale"
							: "ui.hub.adoption.failed",
					)}
				</p>
			)}
			{preview && (
				<div className="min-w-0 space-y-4">
					<p className="break-all text-body-sm text-ink-muted">
						{t("ui.hub.adoption.snapshot", { path: preview.snapshot.path })}
					</p>
					{preview.adoption.model && (
						<p className="break-all text-body-sm text-ink-muted">
							{t("ui.hub.adoption.model", { model: preview.adoption.model })}
						</p>
					)}
					{preview.adoption.warnings?.map((warning, index) => (
						<p
							key={`${index}-${warning}`}
							className="text-body-sm text-warning"
						>
							{warning}
						</p>
					))}
					{needsChoice && (
						<p aria-live="polite" className="text-body-sm text-warning">
							{t("ui.hub.adoption.needs_choice")}
						</p>
					)}
					{preview.adoption.files.map((file) => (
						<article
							key={file.path}
							className="min-w-0 space-y-3 border-t border-hairline pt-4"
						>
							<h4 className="break-all font-mono text-body-sm text-ink">
								{file.path}
							</h4>
							{file.local_path && file.local_path !== file.path && (
								<p className="break-all text-body-sm text-ink-muted">
									{t("ui.hub.adoption.local_path", { path: file.local_path })}
								</p>
							)}
							<p className="text-body-sm text-ink-muted">
								{t(
									actionKeys[file.action as keyof typeof actionKeys] ??
										"ui.hub.adoption.file_review",
								)}
							</p>
							{file.kept && (
								<dl className="space-y-1 text-body-sm text-ink-muted">
									{(["local", "hub", "combined", "unresolved"] as const).map(
										(source) =>
											file.kept?.[source]?.length ? (
												<div key={source}>
													<dt className="font-medium">
														{t(`ui.hub.adoption.kept_${source}`)}
													</dt>
													<dd className="whitespace-pre-wrap break-words">
														{file.kept[source].join("\n")}
													</dd>
												</div>
											) : null,
									)}
								</dl>
							)}
							<h5 className="text-body-sm font-medium text-ink">
								{t("ui.hub.adoption.proposed")}
							</h5>
							{file.proposed === null ? (
								<p className="text-body-sm text-ink-muted">
									{t("ui.hub.adoption.no_proposal")}
								</p>
							) : (
								<ReviewText text={file.proposed} />
							)}
							<details open>
								<summary className="cursor-pointer text-body-sm text-ink">
									{t("ui.hub.adoption.diff_local")}
								</summary>
								<ReviewText diff text={file.diff_vs_local} />
							</details>
							<details open>
								<summary className="cursor-pointer text-body-sm text-ink">
									{t("ui.hub.adoption.diff_hub")}
								</summary>
								<ReviewText diff text={file.diff_vs_hub} />
							</details>
						</article>
					))}
				</div>
			)}
			<div className="flex flex-wrap gap-2">
				<Button
					variant="outline"
					disabled={pending}
					onClick={() => onPreview(preview?.adoption.strategy ?? "merge")}
				>
					{t(
						preview || error
							? "ui.hub.adoption.repreview"
							: "ui.hub.adoption.preview",
					)}
				</Button>
				{needsChoice && (
					<>
						<Button
							variant="outline"
							disabled={pending}
							onClick={() => onPreview("keep-local")}
						>
							{t("ui.hub.adoption.keep_local")}
						</Button>
						<Button
							variant="outline"
							disabled={pending}
							onClick={() => onPreview("take-hub")}
						>
							{t("ui.hub.adoption.take_hub")}
						</Button>
					</>
				)}
				{preview && (
					<Button
						disabled={pending || !!error || needsChoice}
						onClick={onConfirm}
					>
						{t("ui.hub.adoption.confirm")}
					</Button>
				)}
				<Button variant="ghost" disabled={pending} onClick={onCancel}>
					{t("ui.hub.adoption.cancel")}
				</Button>
			</div>
		</section>
	);
}

/** Capture the failed pull's identity/policy, not whichever scope is later active. */
export function HubSkillAdoption({
	input,
	onClose,
}: { input: PullHubSkillInput; onClose: () => void }) {
	const pull = usePullHubSkill({ retry: 0 });
	const [preview, setPreview] = useState<SkillAdoptionPreview | null>(null);
	const [strategy, setStrategy] = useState<SkillAdoptionStrategy>("merge");
	const [allowLlm, setAllowLlm] = useState(false);
	const [error, setError] = useState<AdoptionReviewState["error"]>(null);
	const [applied, setApplied] = useState(false);
	const confirmId = useRef("");
	const fail = (cause: unknown) =>
		setError(
			cause instanceof DesktopControlError &&
				cause.code === "adoption-preview-changed"
				? "stale"
				: "failed",
		);
	const runPreview = (next: SkillAdoptionStrategy) => {
		setError(null);
		setPreview(null);
		setStrategy(next);
		pull.mutate(
			{
				...input,
				requestId: crypto.randomUUID(),
				dryRun: true,
				adoptionStrategy: next,
				allowLlm,
			},
			{
				onSuccess: (result) => {
					const parsed = skillAdoptionPreviewSchema.safeParse(result);
					if (!parsed.success) {
						setError("failed");
						return;
					}
					confirmId.current = crypto.randomUUID();
					setPreview(parsed.data);
				},
				onError: fail,
			},
		);
	};
	const confirm = () => {
		if (
			!preview ||
			preview.adoption.state === "needs-choice" ||
			error ||
			pull.isPending
		)
			return;
		// Send only the captured receipt and identity/policy; never send model text
		// back for confirmation or silently rerun a stale consolidation.
		pull.mutate(
			{
				...input,
				requestId: confirmId.current,
				dryRun: false,
				confirm: true,
				adoptionReceipt: preview.adoption_receipt,
				adoptionStrategy: strategy,
				allowLlm,
			},
			{
				onSuccess: (result) => {
					if (skillPullDidWrite(result)) setApplied(true);
					else setError("failed");
				},
				onError: fail,
			},
		);
	};
	return (
		<HubSkillAdoptionReview
			state={{ preview, pending: pull.isPending, applied, error }}
			allowLlm={allowLlm}
			onAllowLlm={setAllowLlm}
			onPreview={runPreview}
			onConfirm={confirm}
			onCancel={onClose}
		/>
	);
}
