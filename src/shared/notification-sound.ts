/**
 * The IPC channel main uses to hand a notification sound to the renderer's
 * player (`main/notification-sound.ts` -> `renderer/.../notification-sound-player.ts`).
 *
 * In `shared/` because both ends import it and the preload must not pull the
 * main module (it reads the filesystem) into its bundle.
 */
export const NOTIFICATION_SOUND_PLAY_CHANNEL = "notification-sound:play";
