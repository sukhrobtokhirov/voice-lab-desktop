<p align="center">
  <img src="src/assets/logo.svg" alt="VoiceLab" width="120" />
</p>

<h1 align="center">VoiceLab Desktop</h1>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat" alt="Platform" />
  <a href="https://github.com/voicelab-uz/desktop/releases/latest"><img src="https://img.shields.io/github/v/release/voicelab-uz/desktop?style=flat&sort=semver" alt="GitHub release" /></a>
  <a href="https://github.com/voicelab-uz/desktop/blob/main/LICENSE"><img src="https://img.shields.io/github/license/voicelab-uz/desktop?style=flat" alt="License" /></a>
</p>

<p align="center">
  Desktop dictation for VoiceLab — press a hotkey, speak, and text appears at your cursor.<br/>
  Cloud speech-to-text via <a href="https://aisha.group">Aisha</a>, with local Whisper/Parakeet still available.
</p>

<p align="center">
  <a href="https://voicelab.uz">Website</a> &middot;
  <a href="https://github.com/voicelab-uz/desktop/releases/latest">Download</a> &middot;
  <a href="docs/releasing.md">Releasing</a> &middot;
  <a href="ADAPTATION.md">Adaptation notes</a>
</p>

---

## Download

| Platform | File |
| -------- | ---- |
| macOS (Apple Silicon) | [`VoiceLab-*-arm64-mac.dmg`](https://github.com/voicelab-uz/desktop/releases/latest) |
| macOS (Intel) | [`VoiceLab-*-x64-mac.dmg`](https://github.com/voicelab-uz/desktop/releases/latest) |
| Windows (x64) | [`VoiceLab Setup *.exe`](https://github.com/voicelab-uz/desktop/releases/latest) |
| Linux (x64) | [`VoiceLab-*-linux-x64.AppImage`](https://github.com/voicelab-uz/desktop/releases/latest) |
| Linux packages | `.deb`, `.rpm`, and `.tar.gz` files on the release page |

All releases: **[github.com/voicelab-uz/desktop/releases](https://github.com/voicelab-uz/desktop/releases)**

### Install (macOS)

1. Download the `.dmg` for your chip (Apple Silicon vs Intel).
2. Open the disk image and drag **VoiceLab** into **Applications**.
3. Open **VoiceLab**. New public release builds are signed and notarized, so macOS should not show the unidentified-developer warning. Older unsigned releases may still require **Open Anyway**. Grant microphone and accessibility permissions when prompted.
4. On first run, paste your **Aisha API key** from [space.aisha.group](https://space.aisha.group).

### Share with friends

This repo is **public**. Send them:

- Latest release: https://github.com/voicelab-uz/desktop/releases/latest
- Or the direct installer link for their operating system from that page

Each person needs their own Aisha API key. You can also share the appropriate installer file directly.

### Install (Windows)

1. Download the Windows `.exe` installer from the latest release.
2. Run it and follow the installation prompts.
3. Grant microphone and accessibility permissions if Windows requests them.
4. On first run, paste your **Aisha API key** from [space.aisha.group](https://space.aisha.group).

### Install (Linux)

- **AppImage:** download the `.AppImage`, make it executable, and run it.
- **Debian/Ubuntu:** download the `.deb` package and install it with your package manager.
- **Fedora/RHEL:** download the `.rpm` package and install it with your package manager.
- **Other distributions:** use the `.tar.gz` archive.

On Linux, grant microphone and desktop accessibility permissions through your distribution’s settings when prompted.

## Features

- **Voice dictation** — global hotkey, auto-paste into the focused app
- **VoiceLab Cloud STT** — Aisha API (`back.aisha.group`) with per-user API key
- **Local STT** — Whisper / Parakeet on-device when you want offline
- **Notes & meetings** — carry over from the OpenWhispr base (product surface still evolving)
- **uz / en / ru** UI focus for VoiceLab

## Develop

```bash
git clone https://github.com/voicelab-uz/desktop.git
cd desktop
cp .env.example .env   # fill values as needed; do not commit .env
npm install
npm run dev
```

Requires **Node.js 24+**.

Useful scripts:

| Command | Purpose |
| ------- | ------- |
| `npm run dev` | Electron + Vite development |
| `npm run build:mac:arm64` | Local macOS arm64 package |
| `npm run build:win` | Local Windows x64 package |
| `npm run build:linux` | Local Linux x64 packages |
| `npm run build:mac:cloud` | Unsigned arm64 build (CI-style) |

See [ADAPTATION.md](ADAPTATION.md) for fork architecture and Aisha integration notes.

## Releases & auto-update

Tagged versions (`v*.*.*`) publish macOS arm64/x64, Windows x64, and Linux x64 artifacts via GitHub Actions (**Release VoiceLab Desktop**). The app checks **this repo’s** releases for updates.

Details: [docs/releasing.md](docs/releasing.md).

## License

[MIT](LICENSE) — free for personal and commercial use.

## Acknowledgments

VoiceLab Desktop is adapted from [OpenWhispr](https://github.com/OpenWhispr/openwhispr).

- [OpenAI Whisper](https://github.com/openai/whisper) / [whisper.cpp](https://github.com/ggerganov/whisper.cpp)
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) / [NVIDIA Parakeet](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
- [Electron](https://www.electronjs.org/) · [React](https://react.dev/) · [Aisha](https://aisha.group)
