# Releasing VoiceLab Desktop

Updates are published to **https://github.com/voicelab-uz/desktop/releases**.  
The app’s `electron-updater` feed points at that repo (`voicelab-uz` / `desktop`).

## One-time setup

1. Push this codebase to `voicelab-uz/desktop` (this repo).
2. Enroll in the Apple Developer Program and create a **Developer ID Application** certificate for the team that owns VoiceLab. Export the certificate together with its matching private key as a password-protected `.p12` file; the `.cer` certificate alone cannot sign builds.
3. Create an App Store Connect API key with permission to submit builds for notarization. Download its `.p8` private key and record its key ID, issuer ID, and Apple team ID.
4. Windows signing is currently disabled. Later, obtain a Windows Authenticode certificate, export it as a password-protected `.pfx` file, and add the Windows secrets below.
5. In GitHub → Settings → Secrets and variables → Actions, add:
   - `APPLE_CERTIFICATE_BASE64` — base64 of the `.p12` file
   - `APPLE_CERTIFICATE_PASSWORD` — password used when exporting the `.p12`
   - `APPLE_API_KEY_BASE64` — base64 of the App Store Connect `.p8` file
   - `APPLE_API_KEY_ID` — App Store Connect API key ID
   - `APPLE_API_ISSUER` — App Store Connect issuer ID
   - `APPLE_TEAM_ID` — Apple Developer Team ID
   - `WINDOWS_CERTIFICATE_BASE64` — base64 of the `.pfx` file
   - `WINDOWS_CERTIFICATE_PASSWORD` — password used when exporting the `.pfx`
   - Optional `GH_TOKEN` if the default `GITHUB_TOKEN` is not enough for downloads

Windows secrets are not needed while Windows publishing is disabled. Enable it later by setting the repository variable `ENABLE_WINDOWS_RELEASE` to `true`.

The private `.p12`, `.p8`, and `.pfx` files must never be committed. The workflow imports them only on the relevant CI runner, signs and notarizes macOS, and deletes temporary files. Linux packages do not require an Apple-style certificate. Windows remains skipped until enabled.

To create the base64 secret values locally on macOS:

```bash
base64 -i VoiceLab-Developer-ID.p12 | pbcopy
base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
base64 -i VoiceLab-Code-Signing.pfx | pbcopy
```

Paste each copied value into the matching GitHub secret.

6. Ensure Releases are enabled on the public repository so anyone can download the installers and the updater can access them without a token.

## Ship a new version

1. Bump `version` in `package.json` (e.g. `1.7.8`).
2. Commit and tag:
   ```bash
   git tag v1.7.8
   git push origin main
   git push origin v1.7.8
   ```
3. GitHub Action **Release VoiceLab Desktop** builds and uploads installers for all supported desktop platforms:
   - `VoiceLab-*-arm64-mac.zip` / `.dmg` (and x64 equivalents)
   - Linux x64 `.AppImage`, `.deb`, `.rpm`, and `.tar.gz`
   - `latest-arm64-mac.yml` / `latest-x64-mac.yml` (updater metadata; required — not `latest-mac.yml`)
4. In a previous install: Settings → Check for Updates (or wait for startup check).

## Notes

- Packaged `.env` must **not** contain a shared `AISHA_API_KEY` (stripped in `afterPack`).
- Local builds may be unsigned for QA; production macOS releases are signed and notarized, and Linux releases are packaged by GitHub Actions. Windows publishing is currently disabled.
- Do not publish secrets (Aisha keys, Apple passwords) in release assets or commit history.
