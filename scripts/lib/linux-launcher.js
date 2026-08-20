function buildLinuxWrapperScript(binaryName) {
  if (typeof binaryName !== "string" || !/^[A-Za-z0-9._-]+$/.test(binaryName)) {
    throw new Error(`Invalid Linux executable name: ${JSON.stringify(binaryName)}`);
  }

  return `#!/bin/bash
# OpenWhispr launcher
# User flags: ~/.config/${binaryName}-flags.conf (one per line, # = comment)

HERE="$(dirname "$(readlink -f "\${BASH_SOURCE[0]}")")"
FLAGS=()

# Wayland: forces XWayland (overlay positioning requires X11)
if [ "$XDG_SESSION_TYPE" = "wayland" ]; then
  FLAGS+=(--ozone-platform=x11)
fi

# Chromium needs unprivileged user namespaces (restricted on some distributions)
# or a root-owned setuid chrome-sandbox. Never silently drop the sandbox: users
# who understand the risk must opt in explicitly for a diagnostic launch.
if ! { [ "$(stat -c %u "$HERE/chrome-sandbox" 2>/dev/null)" = "0" ] && [ -u "$HERE/chrome-sandbox" ] && [ -x "$HERE/chrome-sandbox" ]; }; then
  if command -v unshare >/dev/null 2>&1 && ! unshare --user --map-root-user true >/dev/null 2>&1; then
    if [ "\${VOICELAB_ALLOW_NO_SANDBOX:-}" = "1" ]; then
      echo "${binaryName}: WARNING: Chromium sandbox disabled by explicit VOICELAB_ALLOW_NO_SANDBOX=1" >&2
      FLAGS+=(--no-sandbox)
    else
      echo "${binaryName}: Chromium sandbox is unavailable; refusing to start insecurely." >&2
      echo "Enable unprivileged user namespaces or install a root-owned setuid chrome-sandbox." >&2
      echo "For one diagnostic launch only, set VOICELAB_ALLOW_NO_SANDBOX=1." >&2
      exit 78
    fi
  fi
fi

# User flags
FLAGS_FILE="\${XDG_CONFIG_HOME:-$HOME/.config}/${binaryName}-flags.conf"
if [ -f "$FLAGS_FILE" ]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    FLAGS+=("$line")
  done < "$FLAGS_FILE"
fi

exec -a "$0" "$HERE/${binaryName}-app" "\${FLAGS[@]}" "$@"
`;
}

module.exports = { buildLinuxWrapperScript };
