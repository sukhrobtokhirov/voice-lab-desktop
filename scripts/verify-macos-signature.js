#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const EXPECTED_BUNDLE_ID = "uz.voicelab.desktop";

function fail(message) {
  console.error(`[mac-signature] ${message}`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    ...result,
    output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
  };
}

function signingInfo(appPath) {
  const result = run("codesign", ["--display", "--verbose=4", appPath]);
  if (result.status !== 0) {
    fail(`Unable to inspect ${appPath}: ${result.output || "codesign failed"}`);
  }

  const identifier = result.output.match(/^Identifier=(.+)$/m)?.[1]?.trim();
  const teamIdentifier = result.output.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim();
  const isAdHoc = /^Signature=adhoc$/m.test(result.output) || /^flags=.*\(adhoc\)/m.test(result.output);

  return { identifier, teamIdentifier, isAdHoc };
}

function designatedRequirement(appPath) {
  const result = run("codesign", ["--display", "--requirements", "-", appPath]);
  if (result.status !== 0) {
    fail(`Unable to read the designated requirement for ${appPath}: ${result.output}`);
  }

  const requirement = result.output.match(/designated => (.+)$/m)?.[1]?.trim();
  if (!requirement) fail(`No designated requirement found for ${appPath}`);
  return requirement;
}

function verifyApp(appPath) {
  if (process.platform !== "darwin") fail("This check only runs on macOS.");

  const resolvedPath = path.resolve(appPath);
  if (!fs.statSync(resolvedPath, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`App bundle not found: ${resolvedPath}`);
  }

  const verification = run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", resolvedPath]);
  if (verification.status !== 0) {
    fail(`Code signature verification failed for ${resolvedPath}: ${verification.output}`);
  }

  const info = signingInfo(resolvedPath);
  if (info.identifier !== EXPECTED_BUNDLE_ID) {
    fail(`Expected bundle identifier ${EXPECTED_BUNDLE_ID}, got ${info.identifier || "none"}.`);
  }
  if (info.isAdHoc || !info.teamIdentifier || info.teamIdentifier === "not set") {
    fail(
      "The app is ad-hoc signed. Installing it will invalidate macOS Accessibility permission after every rebuild. Build with the VoiceLab Developer ID Application identity instead."
    );
  }

  return { path: resolvedPath, ...info, requirement: designatedRequirement(resolvedPath) };
}

function verifyCompatibleUpdate(currentApp, newApp) {
  if (currentApp.teamIdentifier !== newApp.teamIdentifier) {
    fail(
      `Signing team changed (${currentApp.teamIdentifier} -> ${newApp.teamIdentifier}); refusing an update that would invalidate privacy permissions.`
    );
  }

  for (const [requirement, candidate, label] of [
    [currentApp.requirement, newApp.path, "new app does not satisfy the installed app identity"],
    [newApp.requirement, currentApp.path, "installed app does not satisfy the new app identity"],
  ]) {
    const result = run("codesign", [
      "--verify",
      "--strict",
      "--verbose=2",
      `-R=${requirement}`,
      candidate,
    ]);
    if (result.status !== 0) fail(`${label}: ${result.output}`);
  }
}

const args = process.argv.slice(2);
const compareIndex = args.indexOf("--compare");
const appPath = args[0];
if (!appPath || appPath === "--compare") {
  fail("Usage: node scripts/verify-macos-signature.js <VoiceLab.app> [--compare <installed VoiceLab.app>]");
}

const candidate = verifyApp(appPath);
if (compareIndex !== -1) {
  const comparisonPath = args[compareIndex + 1];
  if (!comparisonPath) fail("--compare requires an app bundle path.");
  const installed = verifyApp(comparisonPath);
  verifyCompatibleUpdate(installed, candidate);
}

console.log(
  `[mac-signature] Verified ${candidate.path}: ${candidate.identifier}, team ${candidate.teamIdentifier}, stable designated requirement.`
);
