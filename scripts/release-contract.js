#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const LOCK = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
const TARGETS = [
  ["macos", "arm64"],
  ["macos", "x64"],
  ["linux", "x64"],
  ["windows", "x64"],
];
const TEXT_EXTENSIONS = new Set([".json", ".yml", ".yaml", ".txt", ".js", ".cjs", ".mjs"]);
const SECRET_ASSIGNMENT =
  /(?:AISHA_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENROUTER_API_KEY|GROQ_API_KEY|GOOGLE_CLIENT_SECRET|AWS_SECRET_ACCESS_KEY|AZURE_OPENAI_API_KEY|DATABASE_URL|DJANGO_SECRET_KEY|JWT_SECRET)\s*[=:]\s*["']?(?!["']?(?:\s|$))[^\s,"'}]+/i;

function die(message) {
  throw new Error(`release-contract: ${message}`);
}

function args(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      parsed._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) die(`missing value for --${key}`);
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function requireArg(options, name) {
  const value = options[name];
  if (!value) die(`--${name} is required`);
  return value;
}

function validateVersionContract(tag) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(PACKAGE.version)) {
    die(`package version is not release-safe SemVer: ${PACKAGE.version}`);
  }
  if (tag !== `v${PACKAGE.version}`) {
    die(`tag ${tag} must equal v${PACKAGE.version}`);
  }
  if (LOCK.version !== PACKAGE.version || LOCK.packages?.[""]?.version !== PACKAGE.version) {
    die("package-lock.json version must equal package.json version");
  }
}

function appendOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function provenance(options) {
  const tag = requireArg(options, "tag");
  const event = requireArg(options, "event");
  const eventSha = requireArg(options, "event-sha");
  const tagSha = requireArg(options, "tag-sha");
  const checkoutSha = requireArg(options, "checkout-sha");
  validateVersionContract(tag);
  if (!["push", "workflow_dispatch"].includes(event)) {
    die(`unsupported release event: ${event}`);
  }
  if (!/^[0-9a-f]{40}$/i.test(tagSha) || checkoutSha !== tagSha) {
    die("checkout must resolve exactly to the requested tag commit");
  }
  if (event === "push" && eventSha !== tagSha) {
    die("tag push SHA must equal the checked-out tag commit");
  }
  appendOutput("tag", tag);
  appendOutput("version", PACKAGE.version);
  appendOutput("source_sha", tagSha);
  process.stdout.write(
    `${JSON.stringify({
      event,
      tag,
      version: PACKAGE.version,
      sourceSha: tagSha,
      requestedFromSha: eventSha,
    })}\n`
  );
}

function walk(root) {
  const files = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) die(`symbolic link is not allowed in release output: ${fullPath}`);
      if (entry.isDirectory()) queue.push(fullPath);
      if (entry.isFile()) files.push(fullPath);
    }
  }
  return files;
}

function sha256(filePath) {
  const digest = crypto.createHash("sha256");
  digest.update(fs.readFileSync(filePath));
  return digest.digest("hex");
}

function scanSecrets(root) {
  for (const filePath of walk(root)) {
    const basename = path.basename(filePath).toLowerCase();
    if (basename === ".env" || basename.startsWith(".env.")) {
      die(`environment file found in release output: ${filePath}`);
    }
    if (!TEXT_EXTENSIONS.has(path.extname(basename))) continue;
    if (fs.statSync(filePath).size > 2 * 1024 * 1024) continue;
    if (SECRET_ASSIGNMENT.test(fs.readFileSync(filePath, "utf8"))) {
      die(`shared credential assignment found in release output: ${filePath}`);
    }
  }
}

function updaterVersion(filePath) {
  const match = fs.readFileSync(filePath, "utf8").match(/^version:\s*["']?([^"'\s]+)["']?\s*$/m);
  if (!match) die(`updater metadata has no version: ${filePath}`);
  return match[1];
}

function expectedMetadata(platform, arch) {
  if (platform === "macos") return `latest-${arch}-mac.yml`;
  if (platform === "linux") return "latest-linux.yml";
  if (platform === "windows") return "latest.yml";
  die(`unsupported platform: ${platform}`);
}

function selectAssets(dist, platform, arch) {
  const entries = fs
    .readdirSync(dist, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dist, entry.name));
  const metadataName = expectedMetadata(platform, arch);
  const metadataPath = entries.find((entry) => path.basename(entry) === metadataName);
  if (!metadataPath) die(`missing updater metadata ${metadataName}`);

  let installers;
  if (platform === "macos") {
    installers = entries.filter((entry) => /\.(dmg|zip)$/i.test(entry));
    if (!installers.some((entry) => /\.dmg$/i.test(entry)) || !installers.some((entry) => /\.zip$/i.test(entry))) {
      die(`macOS ${arch} requires both DMG and ZIP artifacts`);
    }
  } else if (platform === "linux") {
    installers = entries.filter((entry) => /\.(AppImage|deb|rpm|tar\.gz)$/i.test(entry));
    for (const extension of [".AppImage", ".deb", ".rpm", ".tar.gz"]) {
      if (!installers.some((entry) => entry.endsWith(extension))) {
        die(`Linux x64 artifact ${extension} is missing`);
      }
    }
  } else {
    installers = entries.filter(
      (entry) => /\.exe$/i.test(entry) && !/uninstaller/i.test(path.basename(entry))
    );
    if (installers.length < 2) die("Windows requires signed NSIS and portable executables");
  }

  for (const installer of installers) {
    if (!path.basename(installer).includes(PACKAGE.version)) {
      die(`artifact filename does not contain package version: ${installer}`);
    }
  }
  const blockmaps = entries.filter((entry) => /\.blockmap$/i.test(entry));
  return [...new Set([metadataPath, ...installers, ...blockmaps])];
}

function findPackageMarker(dist, platform, arch) {
  const markers = walk(dist).filter(
    (filePath) => path.basename(filePath) === ".voicelab-package-verification.json"
  );
  for (const markerPath of markers) {
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    const expectedPlatform = platform === "macos" ? "darwin" : platform === "windows" ? "win32" : "linux";
    if (marker.platform !== expectedPlatform || marker.arch !== arch) continue;
    if (marker.version !== PACKAGE.version || marker.schema !== 1) {
      die(`invalid package verification marker: ${markerPath}`);
    }
    if (
      !Array.isArray(marker.checks?.preloads) ||
      marker.checks.preloads.length !== 5 ||
      !Number.isInteger(marker.checks?.sidecars) ||
      marker.checks.sidecars < 1 ||
      !marker.checks.unpackedBinaries ||
      !marker.checks.packagedResourcesSecretFree
    ) {
      die(`incomplete package verification marker: ${markerPath}`);
    }
    return marker;
  }
  die(`no verified package marker for ${platform}-${arch}`);
}

function packageArtifacts(options) {
  const platform = requireArg(options, "platform");
  const arch = requireArg(options, "arch");
  const tag = requireArg(options, "tag");
  const sourceSha = requireArg(options, "source-sha");
  const dist = path.resolve(requireArg(options, "dist"));
  const out = path.resolve(requireArg(options, "out"));
  validateVersionContract(tag);
  if (!TARGETS.some(([candidatePlatform, candidateArch]) => candidatePlatform === platform && candidateArch === arch)) {
    die(`unexpected target ${platform}-${arch}`);
  }
  if (!/^[0-9a-f]{40}$/i.test(sourceSha)) die("source SHA is invalid");
  if (!fs.existsSync(dist)) die(`dist directory does not exist: ${dist}`);

  scanSecrets(dist);
  const marker = findPackageMarker(dist, platform, arch);
  const assets = selectAssets(dist, platform, arch);
  const metadata = assets.find((asset) => path.basename(asset) === expectedMetadata(platform, arch));
  if (updaterVersion(metadata) !== PACKAGE.version) {
    die(`updater metadata version must equal ${PACKAGE.version}`);
  }

  const signatureVerified =
    platform === "linux" || process.env.VOICELAB_SIGNATURE_VERIFIED === "1";
  const notarizationVerified =
    platform !== "macos" || process.env.VOICELAB_NOTARIZATION_VERIFIED === "1";
  if (!signatureVerified) die(`${platform}-${arch} signature verification was not attested`);
  if (!notarizationVerified) die(`${platform}-${arch} notarization verification was not attested`);

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const artifactRecords = assets.map((source) => {
    const name = path.basename(source);
    const destination = path.join(out, name);
    fs.copyFileSync(source, destination);
    return { name, sha256: sha256(destination), bytes: fs.statSync(destination).size };
  });
  const attestation = {
    schema: 1,
    tag,
    version: PACKAGE.version,
    sourceSha,
    platform,
    arch,
    signatureVerified,
    notarizationVerified,
    packageChecks: marker.checks,
    artifacts: artifactRecords,
  };
  fs.writeFileSync(
    path.join(out, `attestation-${platform}-${arch}.json`),
    `${JSON.stringify(attestation, null, 2)}\n`
  );
}

function promote(options) {
  const tag = requireArg(options, "tag");
  const sourceSha = requireArg(options, "source-sha");
  const dir = path.resolve(requireArg(options, "dir"));
  validateVersionContract(tag);
  scanSecrets(dir);

  const allArtifacts = new Map();
  const attestations = [];
  for (const [platform, arch] of TARGETS) {
    const attestationPath = path.join(dir, `attestation-${platform}-${arch}.json`);
    if (!fs.existsSync(attestationPath)) die(`missing target attestation: ${platform}-${arch}`);
    const attestation = JSON.parse(fs.readFileSync(attestationPath, "utf8"));
    if (
      attestation.schema !== 1 ||
      attestation.tag !== tag ||
      attestation.version !== PACKAGE.version ||
      attestation.sourceSha !== sourceSha ||
      attestation.platform !== platform ||
      attestation.arch !== arch ||
      !attestation.signatureVerified ||
      !attestation.notarizationVerified
    ) {
      die(`invalid target attestation: ${platform}-${arch}`);
    }
    for (const artifact of attestation.artifacts) {
      const artifactPath = path.join(dir, artifact.name);
      if (!fs.existsSync(artifactPath)) die(`attested artifact is missing: ${artifact.name}`);
      const actualHash = sha256(artifactPath);
      if (actualHash !== artifact.sha256 || fs.statSync(artifactPath).size !== artifact.bytes) {
        die(`attested artifact changed after verification: ${artifact.name}`);
      }
      const existing = allArtifacts.get(artifact.name);
      if (existing && existing.sha256 !== actualHash) {
        die(`conflicting duplicate artifact: ${artifact.name}`);
      }
      allArtifacts.set(artifact.name, { ...artifact, platform, arch });
    }
    attestations.push({ platform, arch, file: path.basename(attestationPath) });
  }

  for (const metadataName of [
    "latest-arm64-mac.yml",
    "latest-x64-mac.yml",
    "latest-linux.yml",
    "latest.yml",
  ]) {
    const metadataPath = path.join(dir, metadataName);
    if (!fs.existsSync(metadataPath) || updaterVersion(metadataPath) !== PACKAGE.version) {
      die(`missing or stale updater metadata: ${metadataName}`);
    }
  }

  fs.writeFileSync(
    path.join(dir, "release-manifest.json"),
    `${JSON.stringify(
      {
        schema: 1,
        tag,
        version: PACKAGE.version,
        sourceSha,
        targets: attestations,
        artifacts: [...allArtifacts.values()].sort((left, right) =>
          left.name.localeCompare(right.name)
        ),
      },
      null,
      2
    )}\n`
  );
}

const options = args(process.argv.slice(2));
const command = options._[0];
if (command === "provenance") provenance(options);
else if (command === "package") packageArtifacts(options);
else if (command === "promote") promote(options);
else die("expected provenance, package, or promote command");
