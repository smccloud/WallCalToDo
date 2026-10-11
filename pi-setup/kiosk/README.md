# Kiosk autostart

Make the script executable once:

```
chmod +x pi-setup/kiosk/kiosk.sh
```

Then wire it into autostart depending on your Raspberry Pi OS version.
Mounting in **landscape**? Skip the rotation line in whichever snippet
below matches your OS — landscape is a monitor's native orientation, the
browser layout already adapts to it on its own (see the root README's
"Screen orientation" section). The rotation commands below are only for a
**portrait** mount: the display needs to be rotated at the OS level to
match how the monitor is physically mounted — the browser layout assumes
a tall, narrow viewport in that case.

## Bookworm (Wayland / labwc), current Pi OS default

Find your output name with `wlr-randr` (e.g. `HDMI-A-1`), then create/edit
`~/.config/labwc/autostart` and add:

```
wlr-randr --output HDMI-A-1 --transform 90
sleep 2
/home/pi/WallCalToDo/pi-setup/kiosk/kiosk.sh &
```

Use `--transform 270` instead of `90` if the display comes up upside down
for your particular mounting orientation. Mounting in landscape instead?
Drop the `wlr-randr` line entirely — just:

```
sleep 2
/home/pi/WallCalToDo/pi-setup/kiosk/kiosk.sh &
```

The `sleep 2` matters: launching the browser immediately after rotating
the output races the compositor's own transform handling and is what
causes a grey/blank screen on boot that only a manual refresh fixes.
`kiosk.sh` also waits a few seconds and disables Chromium's GPU
compositor for the same reason — see the comments in that script.

`xset`/`unclutter` are X11 tools and are no-ops under Wayland (the script
swallows their errors). Screen blanking under labwc is off by default on
Pi OS; if yours isn't, disable it via `wlopm` or your compositor's config.

## Bullseye and earlier (X11 / LXDE)

Find your output name with `xrandr` (no args), then edit
`~/.config/lxsession/LXDE-pi/autostart` and add:

```
@xrandr --output HDMI-1 --rotate left
@/home/pi/WallCalToDo/pi-setup/kiosk/kiosk.sh
```

Use `--rotate right` instead of `left` if it comes out upside down.
Mounting in landscape instead? Drop the `@xrandr` line entirely — just:

```
@/home/pi/WallCalToDo/pi-setup/kiosk/kiosk.sh
```

Install `unclutter` if you want the (nonexistent, but just in case) cursor
hidden at the OS level too: `sudo apt install unclutter`.

## Either way

Reboot and the Pi should come up straight into the kiosk. To get back to a
desktop for debugging, SSH in instead of touching the display — kiosk mode
intentionally has no window chrome.

## Hiding the cursor

The `cursor: none` baked into the page (`frontend/index.html` + `base.css`)
hides the pointer only while it is over the browser's own surface. On a
headless kiosk with no mouse there is no "move it and let it time out", so
the compositor's own default pointer stays visible — at boot before
Chromium's window appears, and anywhere the page doesn't cover. That one
can only be hidden at the compositor level.

On **Wayland/labwc** (Bookworm/Trixie) the reliable fix is a transparent
cursor theme, so no pointer is ever drawn. Raspberry Pi OS doesn't package
one, but the theme is a single ready-made cursor file plus symlinks — no
compiler and no apt package:

```
mkdir -p ~/.local/share/icons/xcursor-transparent/cursors
cd ~/.local/share/icons/xcursor-transparent/cursors
curl -fsSL -o transp \
  https://raw.githubusercontent.com/ebe-forks/xcursor-transparent-theme/master/transp
for name in default left_ptr arrow hand pointer text xterm crosshair watch \
            wait move fleur top_left_arrow right_ptr sb_v_double_arrow \
            sb_h_double_arrow size_hor size_ver size_all openhand closedhand; do
  ln -sf transp "$name"
done
mkdir -p ~/.local/share/icons/default
printf '[Icon Theme]\nInherits=xcursor-transparent\n' > ~/.local/share/icons/default/index.theme
mkdir -p ~/.config/labwc
grep -qxF 'XCURSOR_THEME=xcursor-transparent' ~/.config/labwc/environment 2>/dev/null || \
  echo 'XCURSOR_THEME=xcursor-transparent' >> ~/.config/labwc/environment
```

labwc reads `~/.config/labwc/environment` only at startup, so reboot for it
to take effect. On an older Bookworm install still running **Wayfire**
instead of labwc, add `export XCURSOR_THEME=xcursor-transparent` to
`~/.profile` as well.

On **X11/LXDE** the script's `unclutter` already handles this; if you'd
rather not run it, the transparent theme works there too via
`~/.icons/default/index.theme`:

```
printf '[Icon Theme]\nInherits=xcursor-transparent\n' > ~/.icons/default/index.theme
```

Alternatively, labwc 0.8.4 and newer has a built-in `HideCursor` action.
Bind it in `~/.config/labwc/rc.xml`:

```xml
<keyboard>
  <keybind key="A-W-h">
    <action name="HideCursor" />
    <action name="WarpCursor" x="-1" y="-1" />
  </keybind>
</keyboard>
```

and trigger it once on startup by adding `wtype -M alt -M logo h -m alt -m
logo` to `~/.config/labwc/autostart` (the same `wtype` package the script
already uses for its F5 refresh). It becomes visible again on any pointer
input, so the transparent theme above is the better choice on a kiosk with
no pointer at all.
