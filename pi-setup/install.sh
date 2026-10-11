#!/usr/bin/env bash
#
# WallCalToDo installer for Raspberry Pi OS.
#
# Automates the manual setup guide in the root README: OS packages and
# Node.js (step 3), .env (step 4), dependency install + frontend builds
# (step 5), the systemd backend service (step 6), and kiosk autostart +
# optional portrait rotation + the transparent cursor theme (step 8).
#
# Connecting Google/Microsoft accounts (step 7) is deliberately NOT done
# here -- it needs your own API credentials and a browser on the Pi, so the
# script prints what to do at the end instead.
#
# It is safe to re-run: every step checks current state first, existing
# autostart lines and the cursor theme are left alone if already present,
# and builds are simply redone.
#
# Usage:
#   ./pi-setup/install.sh [options]
#
# Options:
#   --rotate <90|270|left|right|none>
#                        Physical display rotation for a PORTRAIT mount.
#                        Default: none (landscape -- a monitor's native
#                        orientation needs no rotation at all). "90"/"left"
#                        and "270"/"right" are equivalent.
#   --session <wayland|x11>
#                        Force the desktop session type used for kiosk
#                        autostart. Auto-detected when omitted.
#   --user <name>        User the backend runs as and owns the checkout.
#                        Default: $SUDO_USER, else the current user.
#   --dir <path>         Where the checkout lives. Default: the repo this
#                        script is in.
#   --port <number>      Backend port. Default: from .env, else 3000.
#   --skip-apt           Don't touch apt (no OS packages, no Node install).
#   --skip-build         Don't npm install/build (reuse existing dist/).
#   --skip-kiosk         Don't set up kiosk autostart or the cursor theme.
#   --skip-service       Don't install/enable the systemd service.
#   --update             Update mode: git pull, rebuild both frontends,
#                        restart the service. Skips everything else.
#   -h, --help           Show this help and exit.
#
# Environment equivalents: WALLCALTODO_USER, WALLCALTODO_DIR,
# WALLCALTODO_PORT, WALLCALTODO_ROTATE, WALLCALTODO_SESSION.

set -euo pipefail

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  C_RESET="$(tput sgr0)"; C_BOLD="$(tput bold)"
  C_RED="$(tput setaf 1)"; C_GREEN="$(tput setaf 2)"
  C_YELLOW="$(tput setaf 3)"; C_BLUE="$(tput setaf 4)"
else
  C_RESET=""; C_BOLD=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""
fi

log()  { printf '%s==>%s %s\n' "$C_BLUE$C_BOLD" "$C_RESET" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s  !!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '%s error:%s %s\n' "$C_RED$C_BOLD" "$C_RESET" "$*" >&2; exit 1; }
step() { printf '\n%s==> %s%s\n' "$C_BOLD" "$*" "$C_RESET"; }

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default --dir to the repo root (parent of pi-setup/), overridable via env.
DEFAULT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="${WALLCALTODO_DIR:-$DEFAULT_DIR}"
APP_USER="${WALLCALTODO_USER:-${SUDO_USER:-$(id -un)}}"
ROTATE="${WALLCALTODO_ROTATE:-none}"
SESSION="${WALLCALTODO_SESSION:-}"
APP_PORT="${WALLCALTODO_PORT:-}"

SKIP_APT=0
SKIP_BUILD=0
SKIP_KIOSK=0
SKIP_SERVICE=0
UPDATE=0

usage() {
  cat <<'EOF'
WallCalToDo installer for Raspberry Pi OS.

Automates the manual setup guide in the root README: OS packages and
Node.js (step 3), .env (step 4), dependency install + frontend builds
(step 5), the systemd backend service (step 6), and kiosk autostart +
optional portrait rotation + the transparent cursor theme (step 8).

Connecting Google/Microsoft accounts (step 7) is deliberately NOT done
here -- it needs your own API credentials and a browser on the Pi, so the
script prints what to do at the end instead.

It is safe to re-run: every step checks current state first, existing
autostart lines and the cursor theme are left alone if already present,
and builds are simply redone.

Usage:
  ./pi-setup/install.sh [options]

Options:
  --rotate <90|270|left|right|none>
                       Physical display rotation for a PORTRAIT mount.
                       Default: none (landscape -- a monitor's native
                       orientation needs no rotation at all). "90"/"left"
                       and "270"/"right" are equivalent.
  --session <wayland|x11>
                       Force the desktop session type used for kiosk
                       autostart. Auto-detected when omitted.
  --user <name>        User the backend runs as and owns the checkout.
                       Default: $SUDO_USER, else the current user.
  --dir <path>         Where the checkout lives. Default: the repo this
                       script is in.
  --port <number>      Backend port. Default: from .env, else 3000.
  --skip-apt           Don't touch apt (no OS packages, no Node install).
  --skip-build         Don't npm install/build (reuse existing dist/).
  --skip-kiosk         Don't set up kiosk autostart or the cursor theme.
  --skip-service       Don't install/enable the systemd service.
  --update             Update mode: git pull, rebuild both frontends,
                       restart the service. Skips everything else.
  -h, --help           Show this help and exit.

Environment equivalents: WALLCALTODO_USER, WALLCALTODO_DIR,
WALLCALTODO_PORT, WALLCALTODO_ROTATE, WALLCALTODO_SESSION.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --rotate)      ROTATE="${2:-}"; shift 2 ;;
    --session)     SESSION="${2:-}"; shift 2 ;;
    --user)        APP_USER="${2:-}"; shift 2 ;;
    --dir)         APP_DIR="${2:-}"; shift 2 ;;
    --port)        APP_PORT="${2:-}"; shift 2 ;;
    --skip-apt)    SKIP_APT=1; shift ;;
    --skip-build)  SKIP_BUILD=1; shift ;;
    --skip-kiosk)  SKIP_KIOSK=1; shift ;;
    --skip-service) SKIP_SERVICE=1; shift ;;
    --update)      UPDATE=1; shift ;;
    -h|--help)     usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

case "$ROTATE" in
  none|"") ROTATE="none" ;;
  90|left)  ROTATE="90" ;;
  270|right) ROTATE="270" ;;
  *) die "--rotate must be one of: 90, 270, left, right, none" ;;
esac

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

step "WallCalToDo installer"

if [ "$(id -u)" -eq 0 ]; then
  die "run this as the normal desktop user, not root. It uses sudo where it needs to."
fi

command -v sudo >/dev/null 2>&1 || die "sudo is required."

if [ ! -d "$APP_DIR" ]; then
  die "checkout not found at $APP_DIR (use --dir)"
fi
if [ ! -f "$APP_DIR/server/package.json" ] || [ ! -f "$APP_DIR/pi-setup/kiosk/kiosk.sh" ]; then
  die "$APP_DIR doesn't look like a WallCalToDo checkout (use --dir)"
fi
APP_DIR="$(cd "$APP_DIR" && pwd)"

APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6 || true)"
[ -n "$APP_HOME" ] && [ -d "$APP_HOME" ] || die "no home directory found for user '$APP_USER'"
[ "$APP_USER" != "$(id -un)" ] && warn "target user is '$APP_USER' but you're running as '$(id -un)'"

ok "user:   $APP_USER"
ok "home:   $APP_HOME"
ok "dir:    $APP_DIR"
ok "rotate: $ROTATE"

# ---------------------------------------------------------------------------
# Detect the desktop session (for kiosk autostart)
# ---------------------------------------------------------------------------

detect_session() {
  if [ -n "$SESSION" ]; then
    printf '%s' "$SESSION"; return
  fi
  # A live desktop session is the most reliable signal when present.
  case "${XDG_SESSION_TYPE:-}" in
    wayland) printf 'wayland'; return ;;
    x11)     printf 'x11'; return ;;
  esac
  # Fall back to what's actually installed on the Pi.
  if command -v labwc >/dev/null 2>&1 || command -v wlr-randr >/dev/null 2>&1 \
     || command -v wayfire >/dev/null 2>&1; then
    printf 'wayland'
  elif command -v lxsession >/dev/null 2>&1 || command -v startlxde >/dev/null 2>&1; then
    printf 'x11'
  else
    printf 'wayland'   # current Pi OS default
  fi
}

DETECTED_SESSION="$(detect_session)"
case "$DETECTED_SESSION" in
  wayland|x11) : ;;
  *) die "--session must be 'wayland' or 'x11'" ;;
esac
ok "session: $DETECTED_SESSION"

# ---------------------------------------------------------------------------
# Package installation
# ---------------------------------------------------------------------------

apt_install() {
  # Install only the named packages that apt actually knows about, so a
  # package name that doesn't exist on this release (chromium-browser vs
  # chromium, unclutter on Wayland, ...) is skipped rather than aborting.
  local available=() p
  for p in "$@"; do
    if apt-cache show "$p" >/dev/null 2>&1; then
      available+=("$p")
    else
      warn "package '$p' not available on this system -- skipping"
    fi
  done
  [ "${#available[@]}" -gt 0 ] || return 0
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${available[@]}" \
    || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${available[@]}"
}

install_node() {
  local major=0
  if command -v node >/dev/null 2>&1; then
    major="$(node -v | sed 's/^v//' | cut -d. -f1)"
  fi
  if [ "$major" -ge 20 ] 2>/dev/null; then
    ok "Node.js $(node -v) already installed"
    return 0
  fi
  log "installing Node.js 20.x from NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  ok "Node.js $(node -v) installed"
}

if [ "$UPDATE" -eq 0 ] && [ "$SKIP_APT" -eq 0 ]; then
  step "OS packages and Node.js"
  log "apt-get update"
  sudo apt-get update

  install_node

  PKGS=(git)
  if [ "$DETECTED_SESSION" = "x11" ]; then
    PKGS+=(unclutter)
  fi
  # wtype powers kiosk.sh's synthetic F5 recovery; it is Wayland-targeted
  # but harmless to request where unavailable (apt_install filters it out).
  PKGS+=(wtype)
  if [ "$DETECTED_SESSION" = "wayland" ]; then
    PKGS+=(wlr-randr)
  fi
  # Chromium: package name varies by release.
  if apt-cache show chromium >/dev/null 2>&1; then
    PKGS+=(chromium)
  elif apt-cache show chromium-browser >/dev/null 2>&1; then
    PKGS+=(chromium-browser)
  else
    warn "no chromium package found -- install a browser for the kiosk manually"
  fi
  # Color emoji font: without it emoji in event titles render as tofu boxes.
  PKGS+=(fonts-noto-color-emoji)

  log "installing: ${PKGS[*]}"
  apt_install "${PKGS[@]}"
  ok "packages installed"
fi

# ---------------------------------------------------------------------------
# Install dependencies and build both frontends
# ---------------------------------------------------------------------------

require_node() {
  command -v node >/dev/null 2>&1 || die "node not found; re-run without --skip-apt"
}

build_all() {
  require_node
  local pkg
  for pkg in server frontend companion; do
    if [ -d "$APP_DIR/$pkg" ]; then
      step "npm install + build: $pkg"
      ( cd "$APP_DIR/$pkg" && npm install )
    fi
  done
  for pkg in frontend companion; do
    if [ -d "$APP_DIR/$pkg" ]; then
      ( cd "$APP_DIR/$pkg" && npm run build )
      ok "built $pkg/dist"
    fi
  done
}

if [ "$UPDATE" -eq 1 ]; then
  step "Update: git pull + rebuild + restart"
  if [ -d "$APP_DIR/.git" ]; then
    ( cd "$APP_DIR" && git pull --ff-only )
  else
    warn "$APP_DIR is not a git checkout -- skipping git pull"
  fi
  build_all
  if systemctl list-unit-files 2>/dev/null | grep -q '^wallcaltodo\.service'; then
    sudo systemctl restart wallcaltodo
    ok "wallcaltodo service restarted"
  else
    warn "wallcaltodo.service not installed -- nothing to restart"
  fi
  printf '\n%sUpdate complete.%s Give the wall a few seconds to pick up the new build.\n' "$C_GREEN$C_BOLD" "$C_RESET"
  exit 0
fi

if [ "$SKIP_BUILD" -eq 0 ]; then
  step "Application dependencies and builds"
  build_all
else
  warn "skipping npm install/build (--skip-build)"
fi

# ---------------------------------------------------------------------------
# server/.env
# ---------------------------------------------------------------------------

step "server/.env"

ENV_FILE="$APP_DIR/server/.env"
ENV_EXAMPLE="$APP_DIR/server/.env.example"

if [ -f "$ENV_FILE" ]; then
  ok ".env already exists -- leaving it untouched"
else
  [ -f "$ENV_EXAMPLE" ] || die "missing $ENV_EXAMPLE"
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  ok "created .env from .env.example"
fi

# Resolve the port the service actually uses (flag > .env > default).
if [ -z "$APP_PORT" ] && [ -f "$ENV_FILE" ]; then
  APP_PORT="$(grep -E '^PORT=' "$ENV_FILE" | tail -n1 | cut -d= -f2 | tr -d '[:space:]' || true)"
fi
APP_PORT="${APP_PORT:-3000}"
ok "port: $APP_PORT"

# The user running the installer owns the file; make sure the service user can
# read it too if they differ.
if [ "$APP_USER" != "$(id -un)" ]; then
  sudo chown "$APP_USER:" "$ENV_FILE" 2>/dev/null || true
fi
chmod 600 "$ENV_FILE" 2>/dev/null || true

# ---------------------------------------------------------------------------
# systemd service
# ---------------------------------------------------------------------------

if [ "$SKIP_SERVICE" -eq 0 ]; then
  step "systemd service"

  SERVICE_FILE="/etc/systemd/system/wallcaltodo.service"
  NODE_BIN="$(command -v node || echo /usr/bin/node)"

  # Generated rather than copied from pi-setup/wallcaltodo.service so the
  # user and checkout path match this machine automatically. The unit pulled
  # from the repo hardcodes /home/pi and User=pi; this template keeps them in
  # sync with --user/--dir (and the README's own advice to edit them).
  log "writing $SERVICE_FILE"
  sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=WallCalToDo backend (Google/Microsoft sync + web server)
After=network-online.target
Wants=network-online.target

[Service]
# systemd's own Starting/Started/Stopped/Consumed lines are info-level, so
# this keeps a restart from printing them. Needs systemd 240+ (Pi OS
# Bullseye and later); on anything older the unit won't start at all.
LogLevelMax=notice
WorkingDirectory=$APP_DIR/server
ExecStart=$NODE_BIN src/index.js
Restart=on-failure
RestartSec=5
User=$APP_USER
# Leading "-" makes the file optional: PORT and POLL_INTERVAL_MS fall back to
# defaults and credentials live in the companion app / apiCredentials.json,
# so a Pi with no .env still serves.
EnvironmentFile=-$APP_DIR/server/.env

[Install]
WantedBy=multi-user.target
EOF

  # daemon-reload is not optional: systemd caches unit definitions, so a
  # freshly written file isn't seen without it.
  sudo systemctl daemon-reload
  sudo systemctl enable --now wallcaltodo
  ok "wallcaltodo.service enabled and started"
fi

# ---------------------------------------------------------------------------
# Kiosk autostart + rotation + transparent cursor
# ---------------------------------------------------------------------------

setup_cursor_theme() {
  local cursors="$APP_HOME/.local/share/icons/xcursor-transparent/cursors"
  if [ -f "$cursors/default" ]; then
    ok "transparent cursor theme already installed"
  else
    log "installing transparent cursor theme"
    mkdir -p "$cursors"
    if curl -fsSL -o "$cursors/transp" \
        https://raw.githubusercontent.com/ebe-forks/xcursor-transparent-theme/master/transp; then
      local name
      for name in default left_ptr arrow hand pointer text xterm crosshair watch \
                  wait move fleur top_left_arrow right_ptr sb_v_double_arrow \
                  sb_h_double_arrow size_hor size_ver size_all openhand closedhand; do
        ln -sf transp "$cursors/$name"
      done
      mkdir -p "$APP_HOME/.local/share/icons/default"
      printf '[Icon Theme]\nInherits=xcursor-transparent\n' > "$APP_HOME/.local/share/icons/default/index.theme"
      ok "cursor theme files installed"
    else
      warn "couldn't download the cursor theme -- skipping (the wall still works)"
    fi
  fi

  if [ "$DETECTED_SESSION" = "wayland" ]; then
    mkdir -p "$APP_HOME/.config/labwc"
    if ! grep -qxF 'XCURSOR_THEME=xcursor-transparent' "$APP_HOME/.config/labwc/environment" 2>/dev/null; then
      echo 'XCURSOR_THEME=xcursor-transparent' >> "$APP_HOME/.config/labwc/environment"
      ok "set XCURSOR_THEME in labwc environment"
    fi
    # Older Bookworm installs still on Wayfire need it in .profile too.
    if command -v wayfire >/dev/null 2>&1; then
      if ! grep -qxF 'export XCURSOR_THEME=xcursor-transparent' "$APP_HOME/.profile" 2>/dev/null; then
        echo 'export XCURSOR_THEME=xcursor-transparent' >> "$APP_HOME/.profile"
      fi
    fi
  else
    mkdir -p "$APP_HOME/.icons/default"
    printf '[Icon Theme]\nInherits=xcursor-transparent\n' > "$APP_HOME/.icons/default/index.theme"
    ok "set transparent cursor theme for X11"
  fi
}

detect_output() {
  # Best-effort connected-output name for the rotation command. Empty if
  # unknown, in which case the user is told to fill it in.
  if [ "$DETECTED_SESSION" = "wayland" ] && command -v wlr-randr >/dev/null 2>&1; then
    wlr-randr 2>/dev/null | awk 'NF && $0 !~ /^[[:space:]]/ {print $1; exit}'
  elif command -v xrandr >/dev/null 2>&1; then
    xrandr --query 2>/dev/null | awk '/ connected/ {print $1; exit}'
  fi
}

add_autostart() {
  local file="$1" line="$2"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  if grep -qF "$line" "$file" 2>/dev/null; then
    ok "autostart entry already present in $file"
  else
    printf '%s\n' "$line" >> "$file"
    ok "added to $file: $line"
  fi
}

setup_kiosk() {
  step "kiosk autostart"

  chmod +x "$APP_DIR/pi-setup/kiosk/kiosk.sh" 2>/dev/null || true
  local kiosk_script="$APP_DIR/pi-setup/kiosk/kiosk.sh"
  local output rotation_cmd=""

  if [ "$ROTATE" != "none" ]; then
    output="$(detect_output || true)"
    if [ -z "$output" ]; then
      warn "couldn't detect the display output name -- edit the rotation line by hand"
      output="<output>"
    fi
    if [ "$DETECTED_SESSION" = "wayland" ]; then
      rotation_cmd="wlr-randr --output $output --transform $ROTATE"
    else
      case "$ROTATE" in
        90)  rotation_cmd="xrandr --output $output --rotate left" ;;
        270) rotation_cmd="xrandr --output $output --rotate right" ;;
      esac
    fi
  fi

  if [ "$DETECTED_SESSION" = "wayland" ]; then
    local autostart="$APP_HOME/.config/labwc/autostart"
    [ -n "$rotation_cmd" ] && add_autostart "$autostart" "$rotation_cmd"
    add_autostart "$autostart" "sleep 2"
    add_autostart "$autostart" "$kiosk_script &"
  else
    local autostart="$APP_HOME/.config/lxsession/LXDE-pi/autostart"
    [ -n "$rotation_cmd" ] && add_autostart "$autostart" "@$rotation_cmd"
    add_autostart "$autostart" "@$kiosk_script"
  fi

  setup_cursor_theme
}

if [ "$SKIP_KIOSK" -eq 0 ]; then
  setup_kiosk
else
  warn "skipping kiosk setup (--skip-kiosk)"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

step "Installation complete"

printf '%s\n' \
  "" \
  "Backend:    http://localhost:$APP_PORT" \
  "Companion:  http://localhost:$APP_PORT/companion" \
  "" \
  "Check it with:" \
  "  sudo systemctl status wallcaltodo" \
  "  curl -s localhost:$APP_PORT/api/status" \
  ""

if [ "$DETECTED_SESSION" = "wayland" ]; then
  printf '%sReboot to start kiosk mode%s (labwc reads its environment only at startup):\n  sudo reboot\n\n' "$C_BOLD" "$C_RESET"
else
  printf '%sReboot to start kiosk mode:%s\n  sudo reboot\n\n' "$C_BOLD" "$C_RESET"
fi

printf '%sNext: connect your accounts%s (setup step 7) -- on the Pi'\''s own screen, open:\n' "$C_BOLD" "$C_RESET"
printf '  http://localhost:%s/companion\n' "$APP_PORT"
printf 'and add your Google/Microsoft API credentials there. See the README'\''s\n'
printf '"Setup guide" for the console walkthroughs.\n'
