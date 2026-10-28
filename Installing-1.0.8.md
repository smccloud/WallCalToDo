# Installing WallCalToDo 1.0.8

How to install WallCalToDo **v1.0.8** on a Raspberry Pi for kiosk display use.

- **Release:** [WallCalToDo 1.0.8](https://github.com/smccloud/WallCalToDo/releases/tag/v1.0.8)
- **Source code (v1.0.8):** [github.com/smccloud/WallCalToDo/tree/v1.0.8](https://github.com/smccloud/WallCalToDo/tree/v1.0.8)
- **Source archive — tar.gz:** [WallCalToDo v1.0.8.tar.gz](https://github.com/smccloud/WallCalToDo/archive/refs/tags/v1.0.8.tar.gz)
- **Source archive — zip:** [WallCalToDo v1.0.8.zip](https://github.com/smccloud/WallCalToDo/archive/refs/tags/v1.0.8.zip)
- **Install script (v1.0.8):** [pi-setup/install.sh](https://raw.githubusercontent.com/smccloud/WallCalToDo/v1.0.8/pi-setup/install.sh)

The installer automates the manual setup guide: OS packages and Node.js, `.env`, the dependency installs and both frontend builds, the systemd backend service, and kiosk autostart (with the transparent cursor and optional portrait rotation). Connecting Google/Microsoft accounts still has to be done by hand in a browser, since it needs your own API credentials — the installer prints where to go when it finishes.

## Option A — One-line install (fresh Pi)

Run as your normal user (not root) on a freshly flashed Raspberry Pi:

```bash
curl -fsSL https://raw.githubusercontent.com/smccloud/WallCalToDo/v1.0.8/pi-setup/install.sh \
  | WALLCALTODO_REF=v1.0.8 bash
```

For portrait orientation:

```bash
curl -fsSL https://raw.githubusercontent.com/smccloud/WallCalToDo/v1.0.8/pi-setup/install.sh \
  | WALLCALTODO_REF=v1.0.8 bash -s -- --rotate 90
```

`WALLCALTODO_REF=v1.0.8` pins the clone to the v1.0.8 tag; without it the installer clones the default branch (`main`). It installs git, clones the repo to `~/WallCalToDo` at that tag, then re-runs itself from the checkout to do everything else.

## Option B — Install from the release source archive

Use this when you want the exact tagged source without a git checkout (for example, no git on the Pi, or you'd rather download the archive by hand).

1. Download the **Source code (tar.gz)** from the [v1.0.8 release page](https://github.com/smccloud/WallCalToDo/releases/tag/v1.0.8), or fetch it directly:

   ```bash
   curl -fsSL -o wallcaltodo-v1.0.8.tar.gz \
     https://github.com/smccloud/WallCalToDo/archive/refs/tags/v1.0.8.tar.gz
   ```

2. Extract it into your home directory:

   ```bash
   mkdir -p ~/WallCalToDo
   tar -xzf wallcaltodo-v1.0.8.tar.gz --strip-components=1 -C ~/WallCalToDo
   cd ~/WallCalToDo
   ```

   `--strip-components=1` drops the archive's own `WallCalToDo-1.0.8/` top-level folder so the files land directly in `~/WallCalToDo`.

3. Run the installer from the extracted source:

   ```bash
   ./pi-setup/install.sh
   ```

   For a portrait mount:

   ```bash
   ./pi-setup/install.sh --rotate 90
   ```

The installer detects the checkout from its own location, so an extracted archive is installed exactly like a git clone.

**Using the zip archive instead of tar.gz:** download [Source code (zip)](https://github.com/smccloud/WallCalToDo/archive/refs/tags/v1.0.8.zip), then `unzip` it and move the contents of the inner `WallCalToDo-1.0.8/` folder into `~/WallCalToDo` before running `./pi-setup/install.sh`.

**Updating an archive install:** an extracted archive is not a git checkout, so `./pi-setup/install.sh --update` can't `git pull`. To move to a newer release, download and extract the new archive over `~/WallCalToDo` and re-run the installer.

## Option C — From an existing checkout

If you already have the repo checked out, fetch the tag and run the installer in place:

```bash
cd ~/WallCalToDo
git fetch --tags
git checkout v1.0.8
./pi-setup/install.sh                # landscape (default)
./pi-setup/install.sh --rotate 90    # portrait mount
```

## Notes

- Run `./pi-setup/install.sh --help` for all available options.
- See the [v1.0.8 README](https://github.com/smccloud/WallCalToDo/blob/v1.0.8/README.md) for the full setup guide, including flashing the SD card, connecting accounts, and troubleshooting.
