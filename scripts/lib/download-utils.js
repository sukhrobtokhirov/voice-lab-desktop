const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REQUEST_TIMEOUT = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
const MAX_REDIRECTS = 5;

/**
 * Fetch JSON from a URL with proper error handling.
 * @param {string} url - URL to fetch
 * @param {number} [redirectCount=0] - Current redirect count (internal use)
 * @returns {Promise<object>} - Parsed JSON response
 */
function fetchJson(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error("Too many redirects"));
      return;
    }

    const headers = {
      "User-Agent": "OpenWhispr-Downloader",
      Accept: "application/vnd.github+json",
    };

    // Use GitHub token if available (increases rate limit from 60 to 5000/hour)
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const options = {
      headers,
      timeout: REQUEST_TIMEOUT,
    };

    https
      .get(url, options, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const location = res.headers.location;
          if (!location) {
            reject(new Error("Redirect without location header"));
            return;
          }
          const redirectUrl = location.startsWith("/") ? new URL(location, url).href : location;
          fetchJson(redirectUrl, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON: ${e.message}`));
          }
        });
        res.on("error", reject);
      })
      .on("error", reject)
      .on("timeout", () => reject(new Error("Request timeout")));
  });
}

/**
 * Fetch a release from a GitHub repository.
 * @param {string} repo - Repository in "owner/repo" format
 * @param {object} options - Options
 * @param {string} [options.tag] - Exact tag to fetch (works for any release age, no pagination)
 * @param {string} [options.tagPrefix] - Latest release whose tag starts with this prefix (searches the 50 most recent only)
 * @param {boolean} [options.includePrerelease=false] - Include prereleases (tagPrefix only)
 * @returns {Promise<{tag: string, assets: Array<{name: string, url: string}>, url: string} | null>}
 */
async function fetchLatestRelease(repo, options = {}) {
  const { tag, tagPrefix, includePrerelease = false } = options;

  try {
    if (tag) {
      const url = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
      const release = await fetchJson(url);
      return formatRelease(release);
    }

    if (!tagPrefix) {
      const url = `https://api.github.com/repos/${repo}/releases/latest`;
      const release = await fetchJson(url);
      return formatRelease(release);
    }

    const url = `https://api.github.com/repos/${repo}/releases?per_page=50`;
    const releases = await fetchJson(url);

    if (!Array.isArray(releases)) {
      return null;
    }

    // Find the latest release matching the prefix
    for (const release of releases) {
      if (release.draft) continue;
      if (!includePrerelease && release.prerelease) continue;
      if (release.tag_name && release.tag_name.startsWith(tagPrefix)) {
        return formatRelease(release);
      }
    }

    return null;
  } catch (error) {
    console.error(`  Failed to fetch latest release for ${repo}: ${error.message}`);
    return null;
  }
}

/**
 * Format a GitHub release response into a simplified object.
 * @param {object} release - GitHub release API response
 * @returns {{tag: string, assets: Array<{name: string, url: string}>, url: string}}
 */
function formatRelease(release) {
  return {
    tag: release.tag_name,
    url: release.html_url,
    assets: (release.assets || []).map((asset) => ({
      name: asset.name,
      url: asset.browser_download_url,
    })),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function downloadFile(url, dest, retryCount = 0) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let activeRequest = null;

    const cleanup = () => {
      if (activeRequest) {
        activeRequest.destroy();
        activeRequest = null;
      }
      file.close();
    };

    const request = (currentUrl, redirectCount = 0) => {
      if (redirectCount > MAX_REDIRECTS) {
        cleanup();
        reject(new Error("Too many redirects"));
        return;
      }

      activeRequest = https.get(currentUrl, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          const location = response.headers.location;
          if (!location) {
            cleanup();
            reject(new Error("Redirect without location header"));
            return;
          }
          const redirectUrl = location.startsWith("/")
            ? new URL(location, currentUrl).href
            : location;
          request(redirectUrl, redirectCount + 1);
          return;
        }

        if (response.statusCode !== 200) {
          cleanup();
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const total = parseInt(response.headers["content-length"], 10);
        let downloaded = 0;

        response.on("data", (chunk) => {
          downloaded += chunk.length;
          const pct = total ? Math.round((downloaded / total) * 100) : 0;
          process.stdout.write(`\r  Downloading: ${pct}%`);
        });

        response.on("error", (err) => {
          cleanup();
          reject(err);
        });

        response.pipe(file);
        file.on("finish", () => {
          file.close();
          console.log(" Done");
          resolve();
        });

        file.on("error", (err) => {
          cleanup();
          reject(err);
        });
      });

      activeRequest.on("error", (err) => {
        cleanup();
        reject(err);
      });

      activeRequest.setTimeout(REQUEST_TIMEOUT, () => {
        cleanup();
        reject(new Error("Connection timed out"));
      });
    };

    request(url);
  }).catch(async (error) => {
    const isTransient =
      error.message.includes("timed out") ||
      error.code === "ECONNRESET" ||
      error.code === "ETIMEDOUT";

    if (isTransient && retryCount < MAX_RETRIES) {
      console.log(`\n  Retry ${retryCount + 1}/${MAX_RETRIES}: ${error.message}`);
      await sleep(RETRY_DELAY);
      if (fs.existsSync(dest)) {
        fs.unlinkSync(dest);
      }
      return downloadFile(url, dest, retryCount + 1);
    }
    throw error;
  });
}

function safeArchivePath(destDir, archivePath) {
  const root = path.resolve(destDir);
  const normalized = String(archivePath || "").replace(/\\/g, "/");
  if (
    !normalized
    || normalized.startsWith("/")
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split("/").includes("..")
  ) {
    throw new Error(`Unsafe archive path: ${archivePath}`);
  }
  const target = path.resolve(root, normalized);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Archive entry escapes destination: ${archivePath}`);
  }
  return target;
}

function zipEntryIsLink(entry) {
  const unixMode = (Number(entry.externalFileAttributes) >>> 16) & 0xffff;
  return (unixMode & 0xf000) === 0xa000;
}

async function extractZip(zipPath, destDir) {
  const unzipper = require("unzipper");
  const archive = await unzipper.Open.file(zipPath);
  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
  for (const entry of archive.files) {
    if (zipEntryIsLink(entry)) {
      throw new Error(`Archive links are not allowed: ${entry.path}`);
    }
    const target = safeArchivePath(destDir, entry.path);
    if (entry.type === "Directory") {
      fs.mkdirSync(target, { recursive: true, mode: 0o700 });
      continue;
    }
    if (entry.type !== "File") {
      throw new Error(`Unsupported archive entry type: ${entry.path}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(target, { mode: 0o600 });
      entry.stream().on("error", reject).pipe(output).on("error", reject).on("finish", resolve);
    });
  }
}

async function extractTarGz(tarPath, destDir) {
  const tar = require("tar");
  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
  await tar.x({
    file: tarPath,
    cwd: destDir,
    strict: true,
    preservePaths: false,
    filter(entryPath, entry) {
      safeArchivePath(destDir, entryPath);
      if (["SymbolicLink", "Link"].includes(entry?.type)) {
        throw new Error(`Archive links are not allowed: ${entryPath}`);
      }
      return true;
    },
  });
}

async function extractArchive(archivePath, destDir) {
  if (archivePath.endsWith(".tar.gz") || archivePath.endsWith(".tgz")) {
    await extractTarGz(archivePath, destDir);
  } else {
    await extractZip(archivePath, destDir);
  }
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function verifySha256(filePath, expectedSha256) {
  const expected = String(expectedSha256 || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error(`Missing or invalid owned sha256 for ${path.basename(filePath)}`);
  }
  const actual = sha256File(filePath);
  if (actual !== expected) {
    throw new Error(
      `sha256 mismatch for ${path.basename(filePath)}: expected ${expected}, got ${actual}`
    );
  }
  return actual;
}

function findBinaryInDir(dir, binaryName, maxDepth = 5, currentDepth = 0) {
  if (currentDepth >= maxDepth) return null;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const found = findBinaryInDir(fullPath, binaryName, maxDepth, currentDepth + 1);
      if (found) return found;
    } else if (entry.name === binaryName) {
      return fullPath;
    }
  }

  return null;
}

function parseArgs() {
  const args = process.argv;
  let targetPlatform = process.env.TARGET_PLATFORM || process.platform;
  let targetArch = process.env.TARGET_ARCH || process.arch;

  // CLI args override env vars
  const platformIndex = args.indexOf("--platform");
  if (platformIndex !== -1 && args[platformIndex + 1]) {
    targetPlatform = args[platformIndex + 1];
  }

  const archIndex = args.indexOf("--arch");
  if (archIndex !== -1 && args[archIndex + 1]) {
    targetArch = args[archIndex + 1];
  }

  return {
    targetPlatform,
    targetArch,
    platformArch: `${targetPlatform}-${targetArch}`,
    isCurrent: args.includes("--current"),
    isAll: args.includes("--all"),
    isForce: args.includes("--force"),
    shouldCleanup:
      args.includes("--clean") ||
      process.env.CI === "true" ||
      process.env.GITHUB_ACTIONS === "true",
  };
}

function setExecutable(filePath) {
  if (process.platform !== "win32") {
    fs.chmodSync(filePath, 0o755);
  }
}

function cleanupFiles(binDir, prefix, keepPrefix) {
  const keepPrefixes = Array.isArray(keepPrefix) ? keepPrefix : [keepPrefix];
  // Never delete shared libraries; only platform binaries. The b9763 split ships
  // llama-server-impl.dll, which shares the "llama-server" prefix and must survive.
  const isLibrary = (f) => /\.(dll|dylib)$/i.test(f) || /\.so(\.\d+)*$/.test(f);
  const files = fs.readdirSync(binDir).filter((f) => f.startsWith(prefix));
  files.forEach((file) => {
    if (!keepPrefixes.some((keep) => file.startsWith(keep)) && !isLibrary(file)) {
      const filePath = path.join(binDir, file);
      console.log(`Removing old binary: ${file}`);
      fs.unlinkSync(filePath);
    }
  });
}

module.exports = {
  downloadFile,
  extractArchive,
  extractZip,
  fetchLatestRelease,
  findBinaryInDir,
  parseArgs,
  safeArchivePath,
  setExecutable,
  sha256File,
  verifySha256,
  cleanupFiles,
};
