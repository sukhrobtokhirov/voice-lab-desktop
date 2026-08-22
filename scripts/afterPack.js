// electron-builder afterPack hook
//
// Runs after electron-builder assembles the output directory but before the
// final installer (DMG/NSIS/AppImage) is created. Operates only on the output
// directory — never touches source node_modules/.
//
// 1. Strips non-target platform/arch binaries from onnxruntime-node
//    (saves 150–180 MB per build).
// 2. Wraps the Linux binary in a shell script that forces XWayland, reads
//    user flags from ~/.config/open-whispr-flags.conf, and fails closed when
//    the Chromium sandbox is unavailable unless the user explicitly opts in
//    to an insecure diagnostic launch.
// 3. Fails the build if required binaries (ffmpeg-static, ps-list vendor exe,
//    onnx worker script) are missing from app.asar.unpacked/.

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { execFileSync } = require("child_process");
const { Arch } = require("app-builder-lib");
const { getAbi } = require("node-abi");
const { buildLinuxWrapperScript } = require("./lib/linux-launcher");
const WINDOW_CONFIG_KEYS = [
  "MAIN_WINDOW_CONFIG",
  "CONTROL_PANEL_CONFIG",
  "AGENT_OVERLAY_CONFIG",
  "NOTIFICATION_WINDOW_CONFIG",
  "TRANSCRIPTION_PREVIEW_CONFIG",
];

// ---------------------------------------------------------------------------
// macOS resource binary signing
// ---------------------------------------------------------------------------

function resolveAppPath(context) {
  if (context.electronPlatformName !== "darwin") {
    return context.appOutDir;
  }

  if (context.appOutDir.endsWith(".app")) {
    return context.appOutDir;
  }

  return path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
}

function resolveResourcesDir(context) {
  return context.electronPlatformName === "darwin"
    ? path.join(resolveAppPath(context), "Contents", "Resources")
    : path.join(context.appOutDir, "resources");
}

function collectFiles(rootDir, skipDirs = new Set()) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const currentDir = queue.pop();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (skipDirs.has(fullPath)) continue;
        queue.push(fullPath);
        continue;
      }

      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function collectFrameworks(rootDir) {
  if (!fs.existsSync(rootDir)) return [];

  const out = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const currentDir = queue.pop();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.name.endsWith(".framework")) {
        out.push(fullPath);
        // Don't descend into a framework — the bundle is signed as a unit.
        continue;
      }
      queue.push(fullPath);
    }
  }

  return out;
}

function isMachOBinary(filePath) {
  try {
    const description = execFileSync("file", ["-b", filePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    return description.includes("Mach-O");
  } catch {
    return false;
  }
}

function registerMacResourceBinariesForSigning(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const resourcesDir = resolveResourcesDir(context);
  const frameworks = collectFrameworks(resourcesDir);
  const skipDirs = new Set(frameworks);
  const machOFiles = collectFiles(resourcesDir, skipDirs).filter(isMachOBinary);
  const toRegister = [...frameworks, ...machOFiles];

  if (toRegister.length === 0) {
    return;
  }

  const macConfig = context.packager.platformSpecificBuildOptions;
  const existingBinaries = Array.isArray(macConfig.binaries) ? macConfig.binaries : [];

  macConfig.binaries = [...new Set([...existingBinaries, ...toRegister])];

  console.log(
    `  afterPack: registered ${frameworks.length} framework(s) and ${machOFiles.length} loose Mach-O file(s) under Contents/Resources for signing`
  );
}

function enforceMacTransportSecurity(context) {
  if (context.electronPlatformName !== "darwin") return;
  const infoPlist = path.join(resolveAppPath(context), "Contents", "Info.plist");
  execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    "Set :NSAppTransportSecurity:NSAllowsArbitraryLoads false",
    infoPlist,
  ]);
  const value = execFileSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :NSAppTransportSecurity:NSAllowsArbitraryLoads", infoPlist],
    { encoding: "utf8" }
  ).trim();
  if (value !== "false") {
    throw new Error("afterPack: macOS arbitrary network loads remain enabled");
  }
  console.log("  afterPack: enforced macOS transport security");
}

// ---------------------------------------------------------------------------
// onnxruntime-node binary stripping
// ---------------------------------------------------------------------------

function stripOnnxruntimeBinaries(context) {
  const platform = context.electronPlatformName; // darwin | linux | win32
  const archName = Arch[context.arch]; // x64 | arm64 | ia32 | universal

  // Resolve the resources directory inside the packed output
  const resourcesDir = resolveResourcesDir(context);

  const onnxBinDir = path.join(
    resourcesDir,
    "app.asar.unpacked",
    "node_modules",
    "onnxruntime-node",
    "bin",
    "napi-v6"
  );

  if (!fs.existsSync(onnxBinDir)) return;

  // For universal macOS builds keep both arm64 and x64 under darwin/
  const keepArchs = archName === "universal" ? ["arm64", "x64"] : [archName];

  const platformDirs = fs.readdirSync(onnxBinDir);
  let totalRemoved = 0;

  for (const dir of platformDirs) {
    const fullPath = path.join(onnxBinDir, dir);
    if (!fs.statSync(fullPath).isDirectory()) continue;

    if (dir !== platform) {
      // Wrong platform — remove entirely
      fs.rmSync(fullPath, { recursive: true, force: true });
      totalRemoved++;
      continue;
    }

    // Right platform — strip non-target architectures
    const archDirs = fs.readdirSync(fullPath);
    for (const arch of archDirs) {
      const archPath = path.join(fullPath, arch);
      if (!fs.statSync(archPath).isDirectory()) continue;
      if (!keepArchs.includes(arch)) {
        fs.rmSync(archPath, { recursive: true, force: true });
        totalRemoved++;
      }
    }
  }

  if (totalRemoved > 0) {
    console.log(
      `  afterPack: stripped ${totalRemoved} non-target onnxruntime-node directories (keeping ${platform}/${keepArchs.join(",")})`
    );
  }
}

// ---------------------------------------------------------------------------
// Linux XWayland wrapper and Electron fuses
// ---------------------------------------------------------------------------

async function applyLinuxFusesBeforeWrapping(context) {
  if (context.electronPlatformName !== "linux") return;

  // electron-builder invokes afterPack *before* its automatic fuse pass. The
  // wrapper below replaces the executable name with a shell script, so letting
  // that later pass run would make it scan the script instead of the Electron
  // ELF binary. Flip the configured fuses while the real binary is still at
  // the expected path, then disable only the duplicate automatic pass.
  const configuredFuses = context.packager.config.electronFuses;
  if (configuredFuses != null) {
    const fuseConfig = await context.packager.generateFuseConfig(configuredFuses);
    await context.packager.addElectronFuses(context, fuseConfig);
    context.packager.config.electronFuses = null;
    console.log("  afterPack: applied Linux Electron fuses before installing launcher wrapper");
  }

  const appDir = context.appOutDir;
  const binaryName = context.packager.executableName;
  const binaryPath = path.join(appDir, binaryName);
  const realBinaryPath = path.join(appDir, binaryName + "-app");

  fs.renameSync(binaryPath, realBinaryPath);

  fs.writeFileSync(binaryPath, buildLinuxWrapperScript(binaryName), { mode: 0o755 });
}

function verifyMeetingAecHelper(context) {
  const platform = context.electronPlatformName;
  const archName = Arch[context.arch];

  if (!["darwin", "linux", "win32"].includes(platform)) {
    return;
  }

  const binaryName = `meeting-aec-helper-${platform}-${archName}${platform === "win32" ? ".exe" : ""}`;
  const resourcesDir = resolveResourcesDir(context);
  const binaryPath = path.join(resourcesDir, "bin", binaryName);

  if (!fs.existsSync(binaryPath)) {
    console.warn(`  afterPack: missing optional meeting AEC helper (${binaryName})`);
    return;
  }

  if (platform !== "win32") {
    fs.chmodSync(binaryPath, 0o755);
  }
}

function verifyUnpackedBinaries(context) {
  const unpackedDir = path.join(resolveResourcesDir(context), "app.asar.unpacked");
  const unpackedModulesDir = path.join(unpackedDir, "node_modules");

  const isWindows = context.electronPlatformName === "win32";

  const ffmpegPath = path.join(
    unpackedModulesDir,
    "ffmpeg-static",
    isWindows ? "ffmpeg.exe" : "ffmpeg"
  );
  if (!fs.existsSync(ffmpegPath)) {
    throw new Error(
      `afterPack: missing ${ffmpegPath} — ffmpeg-static was not unpacked from app.asar (asarUnpack/packaging failure); the packed app cannot spawn FFmpeg`
    );
  }

  const onnxWorkerPath = path.join(unpackedDir, "src", "workers", "onnxWorker.js");
  if (!fs.existsSync(onnxWorkerPath)) {
    throw new Error(
      `afterPack: missing ${onnxWorkerPath} — src/workers was not unpacked from app.asar (asarUnpack/packaging failure); the ONNX utility process would crash-loop in the packed app`
    );
  }

  // electron-builder strips *.exe from node_modules on non-Windows targets,
  // so the ps-list vendor executable only exists in Windows builds.
  if (isWindows) {
    const psListVendorDir = path.join(unpackedModulesDir, "ps-list", "vendor");
    const hasFastlist =
      fs.existsSync(psListVendorDir) &&
      fs.readdirSync(psListVendorDir).some((name) => /^fastlist-.*\.exe$/.test(name));
    if (!hasFastlist) {
      throw new Error(
        `afterPack: no fastlist-*.exe in ${psListVendorDir} — ps-list vendor executable was not unpacked from app.asar (asarUnpack/packaging failure); Windows process detection would break`
      );
    }
  }

  console.log("  afterPack: verified unpacked bundled binaries");
}

function verifyBetterSqliteElectronAbi(context) {
  const projectDir = context.packager.projectDir;
  const platform = context.electronPlatformName;
  const arch = Arch[context.arch];
  const electronVersion = require(
    path.join(projectDir, "node_modules", "electron", "package.json")
  ).version;
  const abi = String(getAbi(electronVersion, "electron"));
  const rebuiltBinary = path.join(
    projectDir,
    "node_modules",
    "better-sqlite3",
    "bin",
    `${platform}-${arch}-${abi}`,
    "better-sqlite3.node"
  );
  const packagedBinary = path.join(
    resolveResourcesDir(context),
    "app.asar.unpacked",
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node"
  );
  const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

  for (const binary of [rebuiltBinary, packagedBinary]) {
    if (!fs.statSync(binary, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`afterPack: missing Electron ABI ${abi} binary ${binary}`);
    }
  }
  if (digest(rebuiltBinary) !== digest(packagedBinary)) {
    throw new Error(
      `afterPack: packaged better-sqlite3 does not match Electron ${electronVersion} ABI ${abi}`
    );
  }
  console.log(`  afterPack: verified better-sqlite3 Electron ABI ${abi} (${platform}-${arch})`);
}

function configuredPreloadPaths(projectDir) {
  const windowConfigs = require(path.join(projectDir, "src", "helpers", "windowConfig.js"));
  return WINDOW_CONFIG_KEYS.map((key) => {
    const preloadPath = windowConfigs[key]?.webPreferences?.preload;
    if (!preloadPath) {
      throw new Error(`afterPack: ${key} does not declare a preload`);
    }
    const relativePath = path.relative(projectDir, preloadPath);
    if (
      relativePath.startsWith("..") ||
      path.isAbsolute(relativePath) ||
      !relativePath.split(path.sep).includes("preloads")
    ) {
      throw new Error(`afterPack: ${key} preload is outside the project preload directory`);
    }
    return relativePath.split(path.sep).join("/");
  });
}

function assertPackagedPreloads(context) {
  const expectedPreloads = configuredPreloadPaths(context.packager.projectDir);
  const resourcesDir = resolveResourcesDir(context);
  const unpackedAppDir = path.join(resourcesDir, "app");
  const asarPath = path.join(resourcesDir, "app.asar");
  let packagedFiles;

  if (fs.existsSync(unpackedAppDir)) {
    packagedFiles = new Set(
      collectFiles(unpackedAppDir).map((filePath) =>
        path.relative(unpackedAppDir, filePath).split(path.sep).join("/")
      )
    );
  } else if (fs.existsSync(asarPath)) {
    let asar;
    try {
      asar = require("@electron/asar");
    } catch {
      asar = require("asar");
    }
    packagedFiles = new Set(
      asar.listPackage(asarPath).map((entry) => entry.replace(/^[/\\]+/, "").replace(/\\/g, "/"))
    );
  } else {
    throw new Error(`afterPack: packaged application payload is missing under ${resourcesDir}`);
  }

  const missing = expectedPreloads.filter((preloadPath) => !packagedFiles.has(preloadPath));
  if (missing.length > 0) {
    throw new Error(
      `afterPack: packaged application is missing configured preload(s): ${missing.join(", ")}`
    );
  }
  console.log(`  afterPack: verified ${expectedPreloads.length} configured preloads`);
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

const SHARED_SECRET_KEYS = [
  "AISHA_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "XAI_API_KEY",
  "TINFOIL_API_KEY",
  "CORTI_CLIENT_SECRET",
  "DEEPGRAM_API_KEY",
  "ASSEMBLYAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_CLIENT_SECRET",
  "AWS_SECRET_ACCESS_KEY",
  "AZURE_OPENAI_API_KEY",
  "DATABASE_URL",
  "DJANGO_SECRET_KEY",
  "JWT_SECRET",
];

function hasNonEmptySecretAssignment(contents) {
  return SHARED_SECRET_KEYS.some((key) => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const envAssignment = new RegExp(
      `(?:^|\\r?\\n)\\s*${escaped}\\s*=\\s*(?:"[^"\\r\\n]+"|'[^'\\r\\n]+'|[^\\s#][^\\r\\n]*)`,
      "m"
    );
    const jsonAssignment = new RegExp(`"${escaped}"\\s*:\\s*"[^"\\r\\n]+"`);
    return envAssignment.test(contents) || jsonAssignment.test(contents);
  });
}

function assertSourceEnvironmentIsSecretFree(context) {
  const sourceEnv = path.join(context.packager.projectDir, ".env");
  if (!fs.existsSync(sourceEnv)) return;
  const contents = fs.readFileSync(sourceEnv, "utf8");
  if (hasNonEmptySecretAssignment(contents)) {
    throw new Error(
      "afterPack: release blocked because the source .env contains a shared API credential"
    );
  }
}

function assertPackagedResourcesAreSecretFree(context) {
  const resourcesDir = resolveResourcesDir(context);
  const files = collectFiles(resourcesDir);

  for (const filePath of files) {
    const basename = path.basename(filePath).toLowerCase();
    if (basename === ".env" || basename.startsWith(".env.")) {
      throw new Error(
        `afterPack: release blocked because an environment file was packaged at ${path.relative(
          resourcesDir,
          filePath
        )}`
      );
    }

    const extension = path.extname(basename);
    if (
      ![
        ".json",
        ".txt",
        ".yaml",
        ".yml",
        ".config",
        ".ini",
        ".js",
        ".cjs",
        ".mjs",
        ".html",
      ].includes(extension) ||
      fs.statSync(filePath).size > 10 * 1024 * 1024
    ) {
      continue;
    }

    const contents = fs.readFileSync(filePath, "utf8");
    if (hasNonEmptySecretAssignment(contents)) {
      throw new Error(
        `afterPack: release blocked because a packaged configuration contains a shared credential at ${path.relative(
          resourcesDir,
          filePath
        )}`
      );
    }
  }

  console.log(
    "  afterPack: verified packaged resources contain no environment files or shared credentials"
  );
}

function assertCompiledRendererIsSecretFree(context) {
  const rendererDir = path.join(context.packager.projectDir, "src", "dist");
  if (!fs.existsSync(rendererDir)) return;
  for (const filePath of collectFiles(rendererDir)) {
    if (![".js", ".html", ".json"].includes(path.extname(filePath).toLowerCase())) continue;
    if (fs.statSync(filePath).size > 10 * 1024 * 1024) continue;
    if (hasNonEmptySecretAssignment(fs.readFileSync(filePath, "utf8"))) {
      throw new Error(
        `afterPack: release blocked because compiled renderer assets contain a shared credential at ${path.relative(
          rendererDir,
          filePath
        )}`
      );
    }
  }
}

function writePackageVerification(context) {
  const projectDir = context.packager.projectDir;
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
  const markerPath = path.join(resolveResourcesDir(context), ".voicelab-package-verification.json");
  const marker = {
    schema: 1,
    product: "VoiceLab",
    version: packageJson.version,
    platform: context.electronPlatformName,
    arch: Arch[context.arch],
    checks: {
      preloads: configuredPreloadPaths(projectDir),
      unpackedBinaries: true,
      sourceEnvironmentSecretFree: true,
      rendererSecretFree: true,
      packagedResourcesSecretFree: true,
    },
  };
  fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, {
    mode: 0o644,
  });
  console.log(
    `  afterPack: wrote package verification marker for ${marker.platform}-${marker.arch}`
  );
}

exports.default = async function (context) {
  assertSourceEnvironmentIsSecretFree(context);
  assertCompiledRendererIsSecretFree(context);
  assertPackagedPreloads(context);
  stripOnnxruntimeBinaries(context);
  await applyLinuxFusesBeforeWrapping(context);
  verifyMeetingAecHelper(context);
  verifyUnpackedBinaries(context);
  verifyBetterSqliteElectronAbi(context);
  enforceMacTransportSecurity(context);
  registerMacResourceBinariesForSigning(context);
  assertPackagedResourcesAreSecretFree(context);
  writePackageVerification(context);
};

exports.configuredPreloadPaths = configuredPreloadPaths;
exports.assertPackagedPreloads = assertPackagedPreloads;
exports.writePackageVerification = writePackageVerification;
exports.enforceMacTransportSecurity = enforceMacTransportSecurity;
exports.applyLinuxFusesBeforeWrapping = applyLinuxFusesBeforeWrapping;
