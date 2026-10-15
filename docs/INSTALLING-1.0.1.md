# Installing WallCalToDo 1.0.1

This page describes how to install WallCalToDo v1.0.1 on a Raspberry Pi for kiosk display use.

## One-line install (fresh Pi)

Run as your normal user (not root) on a freshly flashed Raspberry Pi:

```bash
curl -fsSL https://raw.githubusercontent.com/smccloud/WallCalToDo/v1.0.1/pi-setup/install.sh | bash
```

For portrait orientation:

```bash
curl -fsSL https://raw.githubusercontent.com/smccloud/WallCalToDo/v1.0.1/pi-setup/install.sh | bash -s -- --rotate 90
```

This will install git, clone the repo at `~/WallCalToDo` (checked out to v1.0.1), install dependencies, build frontend and companion apps, set up the systemd service, and configure kiosk autostart.

## If you already have the repo checked out

```bash
cd ~/WallCalToDo
git fetch --tags
git checkout v1.0.1
./pi-setup/install.sh                # landscape (default)
./pi-setup/install.sh --rotate 90    # portrait mount
```

## Notes

- The install script is available directly at: [v1.0.1 pi-setup/install.sh](https://raw.githubusercontent.com/smccloud/WallCalToDo/v1.0.1/pi-setup/install.sh)
- Run `./pi-setup/install.sh --help` for all available options.
- See the [README](https://github.com/smccloud/WallCalToDo/blob/v1.0.1/README.md) for the full setup guide, including flashing the SD card, connecting accounts, and troubleshooting.
