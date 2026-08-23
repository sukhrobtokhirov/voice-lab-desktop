<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src/assets/voicelab-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="src/assets/voicelab.svg" />
    <img src="src/assets/voicelab.svg" alt="VoiceLab" width="360" />
  </picture>
</p>

<h1 align="center">VoiceLab Desktop</h1>

<p align="center">
  You speak, Voicelab won't miss a word.
</p>

<p align="center">
  <a href="https://github.com/voicelab-uz/desktop/releases/latest"><strong>Download VoiceLab</strong></a>
  &nbsp;·&nbsp;
  <a href="https://voicelab.uz">VoiceLab website</a>
</p>

<p align="center">
  <a href="https://github.com/voicelab-uz/desktop/releases/latest"><img src="https://img.shields.io/github/v/release/voicelab-uz/desktop?display_name=tag&sort=semver" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/voicelab-uz/desktop" alt="MIT license" /></a>
</p>

---

VoiceLab Desktop records your speech and sends it to the VoiceLab API for transcription. Sign in with your VoiceLab account, speak, and use the result in your work.

## Download

[**Download the latest version**](https://github.com/voicelab-uz/desktop/releases/latest)

That link always opens the newest published release—no README update is needed when you publish a new version.

| Your computer                           | Download                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Mac with Apple Silicon (M1, M2, M3, M4) | [`VoiceLab-*-arm64.dmg`](https://github.com/voicelab-uz/desktop/releases/latest)                    |
| Mac with Intel                          | [`VoiceLab-*-x64.dmg`](https://github.com/voicelab-uz/desktop/releases/latest)                      |
| Linux                                   | [`.AppImage`, `.deb`, `.rpm`, or `.tar.gz`](https://github.com/voicelab-uz/desktop/releases/latest) |
| Windows                                 | Coming soon                                                                                         |

### Install on macOS

1. Download the `.dmg` for your Mac.
2. Open it and drag **VoiceLab** to **Applications**.
3. Open VoiceLab, allow microphone and accessibility access when asked, then sign in.

### Install on Linux

- **AppImage:** make the file executable, then open it.
- **Ubuntu / Debian:** install the `.deb` file.
- **Fedora / RHEL:** install the `.rpm` file.

## What it does

- Records audio from your microphone.
- Sends it to the VoiceLab API for transcription.
- Helps you turn speech into text without managing API keys or local speech models.

## Run it locally

You need [Node.js 24+](https://nodejs.org/) and npm.

```bash
git clone https://github.com/voicelab-uz/desktop.git
cd desktop
cp .env.example .env
npm ci
npm run dev
```

Keep `.env` private. It is for local configuration and must not be committed.

### Build a local installer

```bash
# macOS, unsigned local build
npm run build:mac:unsigned

# Linux packages
npm run build:linux
```

Signed public installers are built by GitHub Actions when a maintainer pushes a `vX.Y.Z` tag. The **Download VoiceLab** link above will then automatically point people to that new release.

## Help

For a bug or a feature request, please [open an issue](https://github.com/voicelab-uz/desktop/issues).

## License

[MIT](LICENSE)
