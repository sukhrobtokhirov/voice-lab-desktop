import { cn } from "../lib/utils";
import type { FolderItem } from "../../types/electron";

export const DEFAULT_FOLDER_NAME = "Personal";
export const MEETINGS_FOLDER_NAME = "Meetings";
export const VIDEOS_FOLDER_NAME = "Videos";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function displayFolderName(name: string, t: Translate): string {
  if (name === DEFAULT_FOLDER_NAME) return t("notes.folders.personal");
  if (name === MEETINGS_FOLDER_NAME) return t("notes.folders.meetings");
  if (name === VIDEOS_FOLDER_NAME) return t("notes.folders.videos");
  return name;
}

export function displayNoteTitle(title: string | null | undefined, t: Translate): string {
  if (!title || title === "Untitled") return t("notes.list.untitled");
  if (title === "Untitled Note" || title === "New note") return t("notes.list.untitledNote");
  return title;
}

export function findDefaultFolder(folders: FolderItem[]): FolderItem | undefined {
  return folders.find((f) => f.name === DEFAULT_FOLDER_NAME && f.is_default);
}

// URL downloads route to "Videos" by name: a pre-existing user-created folder with
// that name is used as-is (the migration never promotes or replaces it).
export function findVideosFolder(folders: FolderItem[]): FolderItem | undefined {
  return folders.find((f) => f.name === VIDEOS_FOLDER_NAME);
}

// URL-download error codes → notes.upload.* i18n keys.
export const DOWNLOAD_ERROR_KEYS: Record<string, string> = {
  INVALID_URL: "urlInvalid",
  VIDEO_UNAVAILABLE: "urlVideoUnavailable",
  PLAYLIST_URL: "urlPlaylistNotSupported",
  CONTENT_TYPE_INVALID: "urlContentTypeInvalid",
  DOWNLOAD_FAILED: "urlDownloadFailed",
  FILE_TOO_LARGE: "urlFileTooLarge",
  YOUTUBE_BLOCKED: "urlYoutubeBlocked",
  SSRF_BLOCKED: "urlDownloadFailed",
};

export const notesInputClass = cn(
  "w-full h-8 px-3 rounded-md text-xs",
  "bg-foreground/3 dark:bg-white/4 border border-border/30 dark:border-white/6",
  "text-foreground/80 placeholder:text-foreground/20 outline-none",
  "focus:border-primary/30 transition-colors duration-150"
);

export const notesTextareaClass = cn(
  "w-full px-3 py-2 rounded-md text-xs leading-relaxed resize-none",
  "bg-foreground/3 dark:bg-white/4 border border-border/30 dark:border-white/6",
  "text-foreground/80 placeholder:text-foreground/20 outline-none",
  "focus:border-primary/30 transition-colors duration-150"
);
