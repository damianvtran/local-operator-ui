import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import type { FC } from "react";

/**
 * "Make temporary…", confirmed.
 *
 * The one direction that schedules a deletion asks first and says what goes and
 * what stays (UX recommendation, "Off by default"); the reverse, Keep, never
 * asks. It writes nothing itself: the host owns the `sessions.temporary` write
 * and its refusal sentence. The confirm takes the danger role because the act
 * ends in a deletion, the same reading the archive and delete dialogs use.
 */
export const MakeTemporaryDialog: FC<{
	open: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}> = ({ open, onConfirm, onCancel }) => {
	useI18nLocale();
	return (
		<ConfirmationModal
			open={open}
			title={t("ui.chat.dialogs.make_temporary_title")}
			message={
				<div className="flex flex-col gap-2" data-make-temporary-dialog>
					<p>{t("ui.chat.dialogs.make_temporary_deleted")}</p>
					<p>{t("ui.chat.dialogs.make_temporary_kept")}</p>
				</div>
			}
			confirmText={t("ui.chat.dialogs.make_temporary_confirm")}
			cancelText={t("ui.chat.dialogs.cancel")}
			isDangerous={true}
			onConfirm={onConfirm}
			onCancel={onCancel}
		/>
	);
};
