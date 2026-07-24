# Releasing VoiceLab Desktop

Updates are published to **https://github.com/voicelab-uz/desktop/releases**.  
The app’s `electron-updater` feed points at that repo (`voicelab-uz` / `desktop`).

## One-time setup

1. Push this codebase to `voicelab-uz/desktop` (this repo).
2. In GitHub → Settings → Secrets, add as needed:
   - `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD` — Developer ID Application `.p12`
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — notarization
   - Optional `GH_TOKEN` if the default `GITHUB_TOKEN` is not enough for downloads
3. Ensure Releases are enabled on the repo (public releases recommended so the updater needs no token).

## Ship a new version

1. Bump `version` in `package.json` (e.g. `1.7.8`).
2. Commit and tag:
   ```bash
   git tag v1.7.8
   git push origin main
   git push origin v1.7.8
   ```
3. GitHub Action **Release VoiceLab Desktop** builds macOS arm64/x64 and uploads:
   - `VoiceLab-*-arm64-mac.zip` / `.dmg` (and x64 equivalents)
   - `latest-arm64-mac.yml` / `latest-x64-mac.yml` (updater metadata; required — not `latest-mac.yml`)
4. In a previous install: Settings → Check for Updates (or wait for startup check).

## Notes

- Packaged `.env` must **not** contain a shared `AISHA_API_KEY` (stripped in `afterPack`).
- Unsigned local builds work for QA; production auto-update needs Apple signing + notarize.
- Do not publish secrets (Aisha keys, Apple passwords) in release assets or commit history.
