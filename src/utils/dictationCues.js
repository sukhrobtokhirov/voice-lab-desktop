import errorCueUrl from "../assets/audios/error.wav";
import notificationCueUrl from "../assets/audios/notification.wav";
import voiceCueUrl from "../assets/audios/voice.wav";
import { getSettings } from "../stores/settingsStore";
import logger from "./logger";

const CUE_ASSETS = {
  voice: voiceCueUrl,
  notification: notificationCueUrl,
  error: errorCueUrl,
};

const CUE_DURATION_MS = 1000;
const CUE_TIMEOUT_BUFFER_MS = 150;
const MIN_REPLAY_INTERVAL_MS = 80;

const audioByCue = new Map();
const lastPlayedAtByCue = new Map();

const isEnabled = () => getSettings().audioCuesEnabled;

const getAudio = (cue) => {
  if (typeof Audio === "undefined") return null;

  let audio = audioByCue.get(cue);
  if (!audio) {
    audio = new Audio(CUE_ASSETS[cue]);
    audio.preload = "auto";
    audioByCue.set(cue, audio);
  }

  return audio;
};

const waitForCompletion = (audio) =>
  new Promise((resolve) => {
    let timeout;
    const done = () => {
      clearTimeout(timeout);
      audio.removeEventListener("ended", done);
      resolve();
    };

    audio.addEventListener("ended", done, { once: true });
    timeout = setTimeout(done, CUE_DURATION_MS + CUE_TIMEOUT_BUFFER_MS);
  });

export const playAudioCue = async (cue, { waitForCompletion: shouldWait = false } = {}) => {
  if (!isEnabled() || !CUE_ASSETS[cue]) return;

  const now = Date.now();
  if (now - (lastPlayedAtByCue.get(cue) ?? 0) < MIN_REPLAY_INTERVAL_MS) return;
  lastPlayedAtByCue.set(cue, now);

  try {
    const audio = getAudio(cue);
    if (!audio) return;

    audio.pause();
    audio.currentTime = 0;
    const completion = shouldWait ? waitForCompletion(audio) : null;
    await audio.play();
    if (completion) await completion;
  } catch (error) {
    logger.debug(
      "Failed to play application audio cue",
      { cue, error: error instanceof Error ? error.message : String(error) },
      "audio"
    );
  }
};

// Wait for the start cue so the microphone recording never contains the cue itself.
export const playStartCue = () => playAudioCue("voice", { waitForCompletion: true });
export const playStopCue = () => playAudioCue("voice");
export const playNotificationCue = () => playAudioCue("notification");
export const playErrorCue = () => playAudioCue("error");
