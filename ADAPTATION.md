# VoiceLab Desktop — OpenWhispr Adaptation Brief

This repo is a fork of [OpenWhispr](https://github.com/OpenWhispr/openwhispr) being adapted into **VoiceLab Desktop**. Work happens only in this tree (`/Users/commeta/Documents/openwhispr`). The VoiceLab web app lives separately at `voicelab-frontend` (`https://voicelab.uz`).

| Sprint | Goal | Status (as of this brief) |
|--------|------|---------------------------|
| **Sprint 1** | Brand, theme, package identity, URL/env retargeting, uz/en/ru-oriented locales | In progress / mostly surface-level |
| **Sprint 2** | Real VoiceLab auth + cloud STT contract, OAuth desktop callback hosting, meeting ownership decisions | **In progress** — cloud STT uses Aisha API (`back.aisha.group` + `X-Api-Key`; docs: https://aisha.group/uz/api-documentation) |

---

## 1. Sprint 1 — what it covers

Sprint 1 is **product shell only**: make the Electron app look and point like VoiceLab. It does **not** make cloud sign-in or VoiceLab STT work end-to-end.

### Brand / packaging

| Item | Target | Where |
|------|--------|--------|
| npm `name` | `voicelab-desktop` | `package.json` |
| `productName` | `VoiceLab` | `electron-builder.json` |
| `appId` | `uz.voicelab.desktop` | `electron-builder.json` |
| Custom protocol | `voicelab` | `electron-builder.json` → `protocols.schemes` |
| Logos | VoiceLab mark / wordmark | `src/assets/logo.svg`, `voicelab.svg`, `voicelab-logo.svg` |
| macOS usage strings | VoiceLab wording | `electron-builder.json` `NS*UsageDescription` |

Still OpenWhispr-shaped in places (expected leftover for later agents): Windows `BASE_WINDOWS_APP_ID`, Linux desktop filename, macOS signing identity still references the upstream Apple team until VoiceLab’s Developer ID is configured.

**Updates:** published to [`voicelab-uz/desktop`](https://github.com/voicelab-uz/desktop) — see [`docs/releasing.md`](docs/releasing.md).

### Theme

VoiceLab design tokens live in `src/index.css` (`@theme` + brand CSS variables: monochrome foundation, coral `#f25435`, blue `#4b6fff`). Theme mode is still `light` / `dark` / `auto` via `src/hooks/useTheme.ts` + settings store.

### URLs / env

Documented in `.env.example`:

| Variable | Role | Default / notes |
|----------|------|-----------------|
| `VITE_AUTH_URL` | Better Auth client `baseURL` | Falls back to `https://voicelab.uz` in renderer (`src/lib/auth.ts`) |
| `VITE_VOICELAB_API_URL` | Cloud API base (preferred) | Empty unless set |
| `VITE_OPENWHISPR_API_URL` | Legacy alias for the same cloud base | Still accepted in `src/config/constants.ts` and main-process `getApiUrl()` |
| Provider keys | OpenAI / Anthropic / Gemini / Groq / etc. | BYOK; unchanged from upstream |

Support / docs links are being retargeted to `https://docs.voicelab.uz` and `info@voicelab.uz` (e.g. `src/components/ui/SupportDropdown.tsx`).

### Locales

Upstream UI locales (still present): `en`, `es`, `fr`, `de`, `pt`, `it`, `ru`, `ja`, `zh-CN`, `zh-TW` — see `src/i18n.ts` / `src/locales/`.

Sprint 1 intent for VoiceLab: prioritize **uz / en / ru** (matching web `voicelab-frontend` locales), VoiceLab product copy, and sensible defaults. Adding `uz` and stripping unused locales is locale-agent work; do not assume `uz` exists until `src/locales/uz/` and `SUPPORTED_UI_LANGUAGES` are updated.

`package.json` engines: **`"node": ">=24"`**.

---

## 2. Architecture snapshot

```
┌─────────────────────────────────────────────────────────────┐
│ Electron main (main.js)                                     │
│  - app lifecycle, protocol / auth bridge, tray, shortcuts   │
│  - IPC (src/helpers/ipcHandlers.js)                         │
│  - local Whisper / Parakeet servers, meetings, SQLite       │
├─────────────────────────────────────────────────────────────┤
│ preload.js → window.electronAPI                             │
├─────────────────────────────────────────────────────────────┤
│ Renderer (src/ + Vite) — React 19 UI                        │
│  - dictation, settings, notes, meetings overlays            │
│  - better-auth/react client (src/lib/auth.ts)               │
└─────────────────────────────────────────────────────────────┘
         │ local                    │ cloud (optional)
         ▼                          ▼
  whisper.cpp / sherpa-onnx    VITE_VOICELAB_API_URL
  (Metal / CUDA / Vulkan)      → POST /api/transcribe, /api/health, …
                               + BYOK OpenAI-compatible STT
```

### Electron main vs renderer

- **Main:** `main.js` (entry), `preload.js`, helpers under `src/helpers/` (Node/Electron). Channel / userdata: `OPENWHISPR_CHANNEL` (`development` | `staging` | `production`).
- **Renderer:** `src/` Vite app (`npm run dev` → `dev:renderer` + `dev:main`). Talks to main only through `window.electronAPI`.
- **Cloud proxy:** renderer uses `src/services/cloudApi.ts` → IPC `cloudApiRequest`; transcription path uses IPC `cloud-transcribe` in `ipcHandlers.js`.

### Local Whisper

- whisper.cpp binaries / models via download scripts (`download:whisper-cpp`, GPU managers).
- Runtime helpers: `src/helpers/whisper.js`, `whisperServer.js`, CUDA/Vulkan managers.
- Alternative local ASR: NVIDIA Parakeet via sherpa-onnx (`parakeetWsServer.js`, etc.).

### Cloud providers (BYOK)

OpenAI-compatible and vendor endpoints from settings + env keys (OpenAI, Groq, Mistral/Voxtral, Tinfoil, Anthropic/Gemini for LLM cleanup/agent — not STT). Self-hosted mode expects OpenAI wire format: `POST {base}/audio/transcriptions` → `{"text":"..."}`. Non-compatible vendors use `examples/custom-asr-shim/`.

### “OpenWhispr Cloud” API surface (still in code)

When `VITE_VOICELAB_API_URL` / `VITE_OPENWHISPR_API_URL` is set and the user is authenticated, main process calls paths such as:

- `POST {api}/api/transcribe` (multipart audio + client metadata)
- `GET {api}/api/health`
- usage / streaming tokens / Stripe / referrals / agent endpoints (same OpenWhispr cloud shape)

Auth for those calls: Bearer from `tokenStore` (preferred), cookie fallback scoped to auth + API URLs.

### Better Auth URLs (desktop assumptions)

Renderer (`src/lib/auth.ts`):

- `AUTH_URL = import.meta.env.VITE_AUTH_URL || "https://voicelab.uz"`
- `createAuthClient({ baseURL: AUTH_URL, plugins: [ssoClient()], … })`
- Bearer via `set-auth-token` response header ↔ `electronAPI.authGetToken` / `authSetToken`
- Desktop social/SSO: opens browser to `{AUTH_URL}/api/desktop-signin/{provider|sso}` with  
  `callbackURL=https://voicelab.uz/auth/desktop-callback?protocol=…`
- Password reset redirect: `https://voicelab.uz/reset-password`
- Account delete: `{OPENWHISPR_API_URL}/api/auth/delete-account`

Main-process leftovers still default to upstream OpenWhispr in places:

- `main.js` `resolveAuthUrl()` fallback: `https://auth.openwhispr.com`
- Cookie names: `openwhispr.session_token` / `__Secure-openwhispr.session_token`
- OAuth protocol defaults: `openwhispr-dev` / `openwhispr-staging` / `openwhispr` (builder already advertises `voicelab`)

`ipcHandlers.js` `getAuthUrl()` fallback is already `https://voicelab.uz`.

---

## 3. Sprint 2 gaps (VoiceLab)

### 3.1 Auth: Better Auth vs VoiceLab web session

| | OpenWhispr desktop (this fork) | VoiceLab web (`voicelab-frontend`) |
|--|-------------------------------|-------------------------------------|
| Stack | [Better Auth](https://www.better-auth.com) client + bearer plugin | Next.js BFF under `/api/auth/*` → Django/backend session |
| Host | Historically `https://auth.openwhispr.com`; fork defaults renderer to `https://voicelab.uz` | `https://voicelab.uz` (same origin as marketing) |
| Session | Bearer token in Electron `tokenStore` + optional cookies | Cookie session (`sessionid` / app cookies); `/api/auth/me`, login, register, social |
| Social | `/api/desktop-signin/*` shim + Better Auth callback cookies | `/api/auth/social/{google,telegram,commeta}` + callback routes |
| Desktop deep link | Custom protocol + local auth bridge (`127.0.0.1:5199/oauth/callback`) | N/A |

**Gap:** Pointing `VITE_AUTH_URL` at `voicelab.uz` does **not** make Better Auth work. VoiceLab’s `/api/auth` is a different contract (no Better Auth `get-session` / `set-auth-token` / `desktop-signin` unless the backend adds them). Sprint 2 must either:

1. Add a dedicated Better Auth (or compatible) host and keep the desktop client, or  
2. Replace `src/lib/auth.ts` + main OAuth bridge with VoiceLab’s session/token model (and teach cloud STT to accept that credential).

Until then, account features and cloud-metered STT will fail against production VoiceLab.

### 3.2 Cloud STT API contract vs env / custom ASR

Desktop cloud path today:

```text
IPC cloud-transcribe
  → POST {VITE_VOICELAB_API_URL|/VITE_OPENWHISPR_API_URL}/api/transcribe
  → multipart: file + language/prompt/clientType/appVersion/…
  → JSON with text + OpenWhispr usage fields (wordsUsed, plan, sttProvider, …)
```

VoiceLab production STT is documented at `https://docs.voicelab.uz/api/speech-to-text` and served from `https://api.voicelab.uz` (web uses `API_URL`, not this Electron multipart `/api/transcribe` shape).

**Gap:** Map or shim VoiceLab STT to what `ipcHandlers.js` expects, **or** rewrite the cloud transcription IPC to VoiceLab’s API. Until a backend contract is agreed, keep:

- Local Whisper / Parakeet for offline dictation  
- BYOK / self-hosted OpenAI-compatible STT  
- `examples/custom-asr-shim/` when the vendor is not OpenAI-shaped  

Env naming: prefer `VITE_VOICELAB_API_URL`; keep reading `VITE_OPENWHISPR_API_URL` during transition (`src/config/constants.ts`).

### 3.3 OAuth desktop callback hosting on voicelab.uz

Desktop flow depends on a **browser-hosted** page:

`https://voicelab.uz/auth/desktop-callback?protocol=<scheme>&…`

That page must complete the IdP/Better Auth (or VoiceLab) round-trip, then deep-link into the app (`voicelab://…` or channel-specific scheme) so main can store the bearer/session (see auth bridge in `main.js`, Google Calendar reuse in `src/helpers/googleCalendarOAuth.js`).

**Gap:** Confirm/implement `/auth/desktop-callback` on the VoiceLab Next app, align protocol scheme defaults in `main.js` with `electron-builder.json` (`voicelab`), and register OAuth redirect URIs with Google/Microsoft/Apple for the VoiceLab client IDs.

### 3.4 Meeting pipeline ownership

Meeting transcription is **owned entirely by this desktop app**, not by `voicelab-frontend`:

- Detection: `src/helpers/meetingDetectionEngine.js`, `meetingProcessDetector.js` (Zoom / Teams / FaceTime, etc.)
- Capture / AEC: `meetingAecManager.js`, platform audio helpers
- UI: `MeetingRecordingMount.tsx`, notification overlays, `MeetingSettings.tsx`
- Store: `src/stores/meetingRecordingStore.ts`
- Diarization / fingerprints: local models + helpers (no VoiceLab web equivalent)

Sprint 2 decision: keep meetings as a Desktop-differentiator (default), or later sync transcripts into VoiceLab cloud notes/STT history — that requires an explicit API and is out of Sprint 1.

---

## 4. File pointers for next agents

| Area | Paths |
|------|--------|
| Packaging / identity | `package.json`, `electron-builder.json`, `src/assets/*` |
| Theme | `src/index.css`, `src/hooks/useTheme.ts` |
| Auth client | `src/lib/auth.ts`, `src/hooks/useAuth.ts`, `src/components/AuthenticationStep.tsx` |
| Auth main / OAuth bridge | `main.js` (`resolveAuthUrl`, protocol registration, auth bridge), `src/helpers/tokenStore.js`, `src/helpers/googleCalendarOAuth.js` |
| Env / constants | `.env.example`, `src/config/constants.ts`, `src/vite.config.mjs` (injects `VITE_*`) |
| Cloud IPC / STT | `src/helpers/ipcHandlers.js` (`cloud-transcribe`, `getApiUrl`, `getAuthUrl`), `src/services/cloudApi.ts`, `src/helpers/audioManager.js` |
| Self-hosted / shim | `src/helpers/selfHostedTranscription.js`, `examples/custom-asr-shim/` |
| Local Whisper | `src/helpers/whisper.js`, `whisperServer.js`, `scripts/download-whisper-cpp.js` |
| Meetings | `src/helpers/meeting*.js`, `src/components/Meeting*.tsx`, `src/stores/meetingRecordingStore.ts` |
| Locales | `src/i18n.ts`, `src/locales/**` |
| Docs / support links | `src/components/ui/SupportDropdown.tsx`, `src/utils/externalLinks.ts` |
| VoiceLab web reference (read-only) | `../voicelab-frontend/app/api/auth/**`, `lib/auth/server.ts`, `content/apiDocs.ts` |

---

## 5. How to run locally

Requires **Node.js 24+** (`package.json` → `engines.node: ">=24"`).

```bash
cd /Users/commeta/Documents/openwhispr
npm install
npm run dev
```

- `npm run dev` runs renderer (Vite in `src/`) and Electron main concurrently; `predev:main` compiles native helpers and downloads optional binaries (sherpa, qdrant, VAD model, etc.) — first run can take a while.
- Optional: copy `.env.example` → `.env` and set `VITE_AUTH_URL` / `VITE_VOICELAB_API_URL` when Sprint 2 backends exist.
- Upstream README still describes OpenWhispr marketing/download links; treat **this file** as the VoiceLab Desktop adaptation source of truth until README is rewritten.

### Quick verification checklist (Sprint 1)

- [ ] Window title / about / tray show VoiceLab  
- [ ] Logo + coral/blue theme visible in UI  
- [ ] External docs/support links hit `docs.voicelab.uz` / `info@voicelab.uz`  
- [ ] `uz` (or agreed default) selectable once locale agent lands  
- [ ] Cloud sign-in **expected to fail** until Sprint 2 auth + callback exist — use local Whisper for dictation testing  

---

## Sprint 2 entry criteria (for planning)

1. Written STT contract: VoiceLab `api.voicelab.uz` ↔ desktop `cloud-transcribe` (or approved shim).  
2. Auth decision: Better Auth host **or** native VoiceLab session bridge.  
3. `https://voicelab.uz/auth/desktop-callback` live + protocol `voicelab` registered consistently in main + builder.  
4. Explicit yes/no on syncing meeting transcripts to VoiceLab cloud.
