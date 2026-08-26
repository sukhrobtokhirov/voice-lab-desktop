const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const debugLogger = require("./debugLogger");

let cachedFFmpegPath = null;

function getFFmpegPath() {
  if (cachedFFmpegPath) return cachedFFmpegPath;

  // Cloud transcription uploads the original recording and normalizes it on
  // the VoiceLab API. FFmpeg is intentionally not bundled with the desktop
  // app. This lookup remains only for legacy developer-only tools.
  const systemCandidates =
    process.platform === "darwin"
      ? ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"]
      : process.platform === "win32"
        ? ["C:\\ffmpeg\\bin\\ffmpeg.exe"]
        : ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"];

  for (const candidate of systemCandidates) {
    if (fs.existsSync(candidate)) {
      cachedFFmpegPath = candidate;
      return candidate;
    }
  }

  const pathEnv = process.env.PATH || "";
  const pathSep = process.platform === "win32" ? ";" : ":";
  const pathDirs = pathEnv.split(pathSep).map((entry) => entry.replace(/^"|"$/g, ""));
  const pathBinary = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = path.join(dir, pathBinary);
    if (!fs.existsSync(candidate)) continue;
    if (process.platform !== "win32") {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
      } catch {
        continue;
      }
    }
    cachedFFmpegPath = candidate;
    return candidate;
  }

  debugLogger.debug("FFmpeg not found");
  return null;
}

function isWavFormat(buffer) {
  if (!buffer || buffer.length < 12) return false;

  return (
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x41 && // A
    buffer[10] === 0x56 && // V
    buffer[11] === 0x45 // E
  );
}

function convertToWav(inputPath, outputPath, options = {}) {
  const { sampleRate = 16000, channels = 1 } = options;

  return new Promise((resolve, reject) => {
    const ffmpegPath = getFFmpegPath();
    if (!ffmpegPath) {
      reject(
        new Error(
          "FFmpeg not found - the bundled FFmpeg is missing from this install and no system FFmpeg was found on PATH; reinstalling VoiceLab Desktop should fix this"
        )
      );
      return;
    }

    const args = [
      "-i",
      inputPath,
      "-ar",
      String(sampleRate),
      "-ac",
      String(channels),
      "-c:a",
      "pcm_s16le",
      "-y", // Overwrite output file
      outputPath,
    ];

    debugLogger.debug("Converting audio with FFmpeg", {
      input: inputPath,
      output: outputPath,
      sampleRate,
      channels,
    });

    const proc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stderr = "";

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (error) => {
      reject(new Error(`FFmpeg process error: ${error.message}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        const stderrPreview = stderr.slice(-500).trim();
        debugLogger.debug("FFmpeg conversion failed", { code, stderr: stderrPreview });
        reject(
          new Error(`FFmpeg exited with code ${code}${stderrPreview ? `: ${stderrPreview}` : ""}`)
        );
        return;
      }

      if (!fs.existsSync(outputPath)) {
        reject(new Error("FFmpeg conversion produced no output file"));
        return;
      }

      const stats = fs.statSync(outputPath);
      if (stats.size === 0) {
        reject(new Error("FFmpeg conversion produced empty output file"));
        return;
      }

      debugLogger.debug("FFmpeg conversion complete", { outputSize: stats.size });
      resolve();
    });
  });
}

function parseWavFormat(wavBuffer) {
  if (!isWavFormat(wavBuffer)) return null;

  let offset = 12; // Skip RIFF header (4) + size (4) + WAVE (4)
  while (offset < wavBuffer.length - 8) {
    const chunkId = wavBuffer.toString("ascii", offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);

    if (chunkId === "fmt ") {
      return {
        channels: wavBuffer.readUInt16LE(offset + 10),
        sampleRate: wavBuffer.readUInt32LE(offset + 12),
        bitsPerSample: wavBuffer.readUInt16LE(offset + 22),
      };
    }

    offset += 8 + chunkSize;
  }

  return null;
}

function wavToFloat32Samples(wavBuffer) {
  if (!isWavFormat(wavBuffer)) {
    throw new Error("Buffer is not a valid WAV file");
  }

  // Parse WAV header to find data chunk
  let offset = 12; // Skip RIFF header (4) + size (4) + WAVE (4)
  let dataOffset = -1;
  let dataSize = 0;
  let bitsPerSample = 16;

  while (offset < wavBuffer.length - 8) {
    const chunkId = wavBuffer.toString("ascii", offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);

    if (chunkId === "fmt ") {
      bitsPerSample = wavBuffer.readUInt16LE(offset + 22);
    } else if (chunkId === "data") {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  if (dataOffset < 0) {
    throw new Error("WAV data chunk not found");
  }

  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor(dataSize / bytesPerSample);
  const float32 = Buffer.alloc(numSamples * 4);

  for (let i = 0; i < numSamples; i++) {
    const sampleOffset = dataOffset + i * bytesPerSample;
    const intVal =
      bitsPerSample === 16 ? wavBuffer.readInt16LE(sampleOffset) : wavBuffer.readInt8(sampleOffset);
    const maxVal = bitsPerSample === 16 ? 32768 : 128;
    float32.writeFloatLE(intVal / maxVal, i * 4);
  }

  return float32;
}

function computeFloat32RMS(float32Buffer) {
  const numSamples = float32Buffer.length / 4;
  if (numSamples === 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < numSamples; i++) {
    const val = float32Buffer.readFloatLE(i * 4);
    sumSquares += val * val;
  }

  return Math.sqrt(sumSquares / numSamples);
}

function splitAudioFile(inputPath, outputDir, options = {}) {
  const { segmentDuration = 600, audioBitrate = "128k" } = options;

  return new Promise((resolve, reject) => {
    const ffmpegPath = getFFmpegPath();
    if (!ffmpegPath) {
      reject(new Error("FFmpeg not found - required for audio splitting"));
      return;
    }

    const outputPattern = path.join(outputDir, "chunk-%03d.mp3");

    const args = [
      "-i",
      inputPath,
      "-f",
      "segment",
      "-segment_time",
      String(segmentDuration),
      "-c:a",
      "libmp3lame",
      "-b:a",
      audioBitrate,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-y",
      outputPattern,
    ];

    debugLogger.debug("Splitting audio with FFmpeg", {
      input: inputPath,
      outputDir,
      segmentDuration,
      audioBitrate,
    });

    const proc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stderr = "";

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (error) => {
      reject(new Error(`FFmpeg split error: ${error.message}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        const stderrPreview = stderr.slice(-500).trim();
        debugLogger.debug("FFmpeg split failed", { code, stderr: stderrPreview });
        reject(
          new Error(
            `FFmpeg split exited with code ${code}${stderrPreview ? `: ${stderrPreview}` : ""}`
          )
        );
        return;
      }

      const chunks = fs
        .readdirSync(outputDir)
        .filter((f) => f.startsWith("chunk-") && f.endsWith(".mp3"))
        .sort()
        .map((f) => path.join(outputDir, f));

      if (chunks.length === 0) {
        reject(new Error("FFmpeg split produced no output files"));
        return;
      }

      debugLogger.debug("FFmpeg split complete", { chunkCount: chunks.length });
      resolve(chunks);
    });
  });
}

async function mergeAudioSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("At least one audio segment is required");
  }
  if (segments.length === 1) return Buffer.from(segments[0].buffer);

  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) throw new Error("FFmpeg not found - required for audio segment recovery");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-audio-merge-"));
  const outputPath = path.join(tempDir, "merged.webm");
  try {
    const inputPaths = segments.map((segment, index) => {
      const mimeType = segment.mimeType || "audio/webm";
      const extension = mimeType.includes("ogg")
        ? "ogg"
        : mimeType.includes("mp4")
          ? "m4a"
          : "webm";
      const inputPath = path.join(tempDir, `segment-${index}.${extension}`);
      fs.writeFileSync(inputPath, Buffer.from(segment.buffer));
      return inputPath;
    });

    const filters = inputPaths.map(
      (_, index) =>
        `[${index}:a]aresample=16000,aformat=sample_fmts=fltp:channel_layouts=mono[s${index}]`
    );
    filters.push(
      `${inputPaths.map((_, index) => `[s${index}]`).join("")}concat=n=${inputPaths.length}:v=0:a=1[out]`
    );

    await new Promise((resolve, reject) => {
      const args = inputPaths.flatMap((inputPath) => ["-i", inputPath]);
      args.push(
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[out]",
        "-c:a",
        "libopus",
        "-b:a",
        "64k",
        "-y",
        outputPath
      );
      const proc = spawn(ffmpegPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stderr = "";
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      proc.on("error", (error) => reject(new Error(`FFmpeg process error: ${error.message}`)));
      proc.on("close", (code) => {
        if (code !== 0) {
          const preview = stderr.slice(-500).trim();
          reject(
            new Error(`FFmpeg audio merge exited with code ${code}${preview ? `: ${preview}` : ""}`)
          );
          return;
        }
        resolve();
      });
    });

    return fs.readFileSync(outputPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function clearCache() {
  cachedFFmpegPath = null;
}

/** VoiceLab Desktop Dictate accepts these formats without conversion. */
const CLOUD_STT_FORMATS = {
  wav: { ext: "wav", contentType: "audio/wav" },
  mp3: { ext: "mp3", contentType: "audio/mpeg" },
  mpeg: { ext: "mp3", contentType: "audio/mpeg" },
  aac: { ext: "aac", contentType: "audio/aac" },
  ogg: { ext: "ogg", contentType: "audio/ogg" },
  oga: { ext: "ogg", contentType: "audio/ogg" },
  webm: { ext: "webm", contentType: "audio/webm" },
  flac: { ext: "flac", contentType: "audio/flac" },
  m4a: { ext: "m4a", contentType: "audio/mp4" },
  mp4: { ext: "m4a", contentType: "audio/mp4" },
  aiff: { ext: "aiff", contentType: "audio/aiff" },
  amr: { ext: "amr", contentType: "audio/amr" },
  "3gp": { ext: "3gp", contentType: "audio/3gpp" },
  caf: { ext: "caf", contentType: "audio/caf" },
  wma: { ext: "wma", contentType: "audio/x-ms-wma" },
};

function detectAudioContainer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (isWavFormat(buffer)) return "wav";
  if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
    return "ogg";
  }
  if (buffer.subarray(0, 6).toString("ascii") === "#!AMR\n") return "amr";
  if (buffer.subarray(0, 9).toString("ascii") === "#!AMR-WB\n") return "amr";
  if (buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) return "aac";
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return "mp3";
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "mp3";
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return "webm";
  }
  // ISO BMFF: 3GP uses a 3gp* major brand; other accepted audio brands use audio/mp4.
  if (buffer.toString("ascii", 4, 8) === "ftyp") {
    return buffer.toString("ascii", 8, 11).toLowerCase() === "3gp" ? "3gp" : "m4a";
  }
  if (buffer[0] === 0x66 && buffer[1] === 0x4c && buffer[2] === 0x61 && buffer[3] === 0x43) {
    return "flac";
  }
  if (
    buffer.toString("ascii", 0, 4) === "FORM" &&
    ["AIFF", "AIFC"].includes(buffer.toString("ascii", 8, 12))
  ) {
    return "aiff";
  }
  if (buffer.toString("ascii", 0, 4) === "caff") return "caf";
  const asfHeader = Buffer.from("3026b2758e66cf11a6d900aa0062ce6c", "hex");
  if (buffer.length >= asfHeader.length && buffer.subarray(0, asfHeader.length).equals(asfHeader)) {
    return "wma";
  }
  return null;
}

/**
 * Describe a Desktop STT upload without changing its bytes. The Desktop API
 * inspects and normalizes the recording server-side; MIME and file extension
 * are deliberately only hints.
 */
function prepareDesktopSttAudio(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const detected = detectAudioContainer(buffer);
  const detectedFormat = detected ? CLOUD_STT_FORMATS[detected] : null;
  const hintedContentType = String(options.contentType || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const hintedFormat = Object.values(CLOUD_STT_FORMATS).find(
    (format) => format.contentType === hintedContentType
  );
  const format = detectedFormat || hintedFormat;
  return {
    buffer,
    fileName: format ? `audio.${format.ext}` : "audio.bin",
    contentType: format?.contentType || "application/octet-stream",
    detectedContainer: detected,
  };
}

module.exports = {
  getFFmpegPath,
  isWavFormat,
  parseWavFormat,
  convertToWav,
  splitAudioFile,
  wavToFloat32Samples,
  computeFloat32RMS,
  mergeAudioSegments,
  detectAudioContainer,
  prepareDesktopSttAudio,
  clearCache,
};
