import logger from "./logger";
import { getSettings } from "../stores/settingsStore";

const START_NOTES = [523.25, 659.25];
const STOP_NOTES = [587.33, 440];
const NOTE_DURATION_SECONDS = 0.09;
const NOTE_GAP_SECONDS = 0.025;
const NOTE_ATTACK_SECONDS = 0.015;
const MAX_GAIN = 0.2;
const MIN_GAIN = 0.0001;
const CUE_START_DELAY_SECONDS = 0.005;
const CUE_TAIL_SECONDS = 0.02;

let audioContext = null;

const getAudioContext = () => {
  if (typeof window === "undefined") {
    return null;
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }

  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContextCtor();
  }

  return audioContext;
};

export const resumeContextIfNeeded = async () => {
  try {
    const context = getAudioContext();
    if (!context) {
      return null;
    }

    if (context.state === "suspended") {
      await context.resume();
    }

    return context.state === "running" ? context : null;
  } catch (error) {
    logger.debug(
      "Failed to initialize dictation cue audio context",
      { error: error instanceof Error ? error.message : String(error) },
      "audio"
    );
    return null;
  }
};

const scheduleTone = (context, frequency, startTime) => {
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  const stopTime = startTime + NOTE_DURATION_SECONDS;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startTime);

  gainNode.gain.setValueAtTime(MIN_GAIN, startTime);
  gainNode.gain.linearRampToValueAtTime(MAX_GAIN, startTime + NOTE_ATTACK_SECONDS);
  gainNode.gain.exponentialRampToValueAtTime(MIN_GAIN, stopTime);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);

  oscillator.start(startTime);
  oscillator.stop(stopTime + 0.01);
};

const isEnabled = () => getSettings().audioCuesEnabled;

const playCue = async (notes, { waitForCompletion = false } = {}) => {
  try {
    if (!isEnabled()) return;

    const context = await resumeContextIfNeeded();
    if (!context) {
      return;
    }

    const baseTime = context.currentTime + CUE_START_DELAY_SECONDS;
    notes.forEach((frequency, index) => {
      const noteStart = baseTime + index * (NOTE_DURATION_SECONDS + NOTE_GAP_SECONDS);
      scheduleTone(context, frequency, noteStart);
    });

    if (waitForCompletion) {
      const cueDurationSeconds =
        CUE_START_DELAY_SECONDS +
        (notes.length - 1) * (NOTE_DURATION_SECONDS + NOTE_GAP_SECONDS) +
        NOTE_DURATION_SECONDS +
        CUE_TAIL_SECONDS;
      await new Promise((resolve) => setTimeout(resolve, Math.ceil(cueDurationSeconds * 1000)));
    }
  } catch (error) {
    logger.debug(
      "Failed to play dictation cue",
      { error: error instanceof Error ? error.message : String(error) },
      "audio"
    );
  }
};

// Wait for the start cue so the microphone recording never contains the cue itself.
export const playStartCue = () => playCue(START_NOTES, { waitForCompletion: true });

export const playStopCue = () => playCue(STOP_NOTES);
