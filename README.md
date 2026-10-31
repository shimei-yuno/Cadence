# Cadence

A plain-text recurring checklist app: tasks with subtasks that can repeat
(daily / weekly on specific days / monthly, each with its own reset time),
storing everything in human-readable `tasks.md` files so they can sync
between devices through whatever folder-sync tool you already use (iCloud
Drive, Dropbox, Syncthing, your Obsidian vault, etc).

Cadence can track more than one file at once — open a separate vault per
game (e.g. one `tasks.md` for Wuthering Waves, another for a second gacha
game) and switch between them with tabs. A sidebar also gives you an
at-a-glance view of what's scheduled Monday through Friday, based on each
task's repeat days.

## Installing

Download either the Portable Exe, the Installer, or the APK or from the Releases Page
Running the Portable Version immediately opens the app without any installation
Running the Installer Version shows you through the Installation Process
The default installer location is C:\Program Files\Cadence

## How to Use?

Inside the app, click the **+** button at the top and choose **Create new file...**
to create a new tasklist file in any folder you choose, preferrably one that is
synced to other devices. But it can be anywhere. Meanwhile, you may choose
**Open existing file...** to open an existing tasklist file if you have already
created one before.
Click the **+** button again to repeat this process however many times you need to.
The tasklist file can be read by any version or distribution of Cadence without
any compatibility issues. Thus, the files may be synced across any device with
Cadence installed to access the same tasklists.

## Updates

Cadence checks GitHub for newer releases of itself
(<https://github.com/shimei-yuno/Cadence/releases>). It looks shortly after
launch, and you can check by hand with **Check for updates** at the bottom of
the main page.

When a newer release exists you get a banner with a **Download installer**
button. That opens the installer's direct download link in your browser.


---


## Installing the App

### 1. Prerequisites

You'll need [Node.js](https://nodejs.org) installed (any recent LTS version).

### 2. Building the App (Windows / Mac / Linux)

Open a terminal (CMD, Powershell, VS Code, etc.) inside of the unzipped source code folder.
Run these commands to install electron's libraries and test the app.
```bash
npm install
npm start          # launch it directly, to try it first
```
To build the .exe files, run this command
```bash
npm run build:win      # -> dist/Cadence Setup <version>.exe   (installer)
npm run build:mac      # -> dist/Cadence-<version>.dmg   (run this ON a Mac)
npm run build:linux    # -> dist/Cadence-<version>.AppImage
```
> Building a `.dmg` requires running `electron-builder` on an actual Mac
> (Apple doesn't allow cross-building signed Mac installers from Windows/Linux).
> Windows and Linux builds can be made from any OS.

On Windows this produces two files in `dist/`:

- **`Cadence Setup <version>.exe`** — a normal installer. Run it once; it
  installs Cadence properly (Start Menu shortcut, uninstaller, etc.) and
  from then on you launch it like any other app.
- **`Cadence <version>.exe`** — a portable version. No installation at all;
  just put it wherever you like and double-click it directly to open.

### 3. Port it to Android

You'll need [Android Studio](https://developer.android.com/studio) installed
(free) — that's the only way to get a real APK, since it needs the Android
SDK and an emulator/device to run on.

```bash
cd cadence-app
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/filesystem
npx cap init Cadence com.yun0.cadence --web-dir=web
npx cap add android
npx cap sync android
npx cap open android      # opens the project in Android Studio
```

In Android Studio: `Run ▶` on an emulator or a plugged-in phone, or
`Build ▶ Generate Signed Bundle / APK` to produce an installable `.apk` you
can share to your phone directly.

#### Wiring up native file access on Android

Android's scoped storage means the app can't silently read/write an
arbitrary folder path the way the desktop version does — it needs to go
through the **Storage Access Framework** (a system file/folder picker,
similar to what you already click through on desktop). The `@capacitor/filesystem`
plugin you installed above handles this. Add this bridge file so the same
`window.cadenceBridge` interface the app already looks for is available on
Android too — add it as `web/capacitor-bridge.js` and include it as a
`<script>` tag in `index.html` right before the main `<script>` block.

Note the desktop app now tracks *multiple* vault files (the tab switcher),
so the bridge's shape grew a bit from a single-file version: it needs
`boot`/`openFile`/`newFile`/`switchVault`/`closeVault`/`renameVault` in
addition to `writeFile`/`readFile`. The stub below keeps things simple by
tracking that list in Capacitor Preferences (so it persists across app
restarts) rather than reimplementing Electron's full config file:

```js
// web/capacitor-bridge.js — only runs inside the Capacitor/Android shell
if (window.Capacitor) {
  const { Filesystem } = window.CapacitorFilesystem;
  const { Preferences } = window.CapacitorPreferences; // npm i @capacitor/preferences

  async function readVaultList() {
    const { value } = await Preferences.get({ key: 'cadence_vaults' });
    return value ? JSON.parse(value) : { vaults: [], activeVaultId: null };
  }
  async function writeVaultList(list) {
    await Preferences.set({ key: 'cadence_vaults', value: JSON.stringify(list) });
  }
  function genId() { return Math.random().toString(36).slice(2, 10); }

  window.cadenceBridge = {
    async boot() {
      const list = await readVaultList();
      const active = list.vaults.find(v => v.id === list.activeVaultId);
      let content = null, error = null;
      if (active) {
        try {
          const r = await Filesystem.readFile({ path: active.path, encoding: 'utf8' });
          content = r.data;
        } catch (e) { error = 'missing'; }
      }
      return { vaults: list.vaults, activeVaultId: list.activeVaultId, content, error };
    },
    async openFile() {
      // Capacitor's Filesystem plugin doesn't have a file picker built in;
      // the cleanest option is a community plugin such as
      // `@capawesome/capacitor-file-picker` — install it and call it here:
      const picked = await window.FilePicker.pickFiles({ types: ['text/markdown', 'text/plain'] });
      const path = picked.files[0].path;
      const result = await Filesystem.readFile({ path, encoding: 'utf8' });
      const list = await readVaultList();
      let v = list.vaults.find(v => v.path === path);
      if (!v) { v = { id: genId(), path, name: picked.files[0].name }; list.vaults.push(v); }
      list.activeVaultId = v.id;
      await writeVaultList(list);
      return { id: v.id, path, name: v.name, content: result.data };
    },
    async newFile() {
      const dir = await window.FilePicker.pickDirectory();
      const path = dir + '/tasks.md';
      await Filesystem.writeFile({ path, data: '# Cadence tasks\n\n', encoding: 'utf8' });
      const list = await readVaultList();
      const v = { id: genId(), path, name: 'tasks.md' };
      list.vaults.push(v);
      list.activeVaultId = v.id;
      await writeVaultList(list);
      return { id: v.id, path, name: v.name };
    },
    async switchVault(id) {
      const list = await readVaultList();
      const v = list.vaults.find(v => v.id === id);
      if (!v) return null;
      list.activeVaultId = id;
      await writeVaultList(list);
      try {
        const r = await Filesystem.readFile({ path: v.path, encoding: 'utf8' });
        return { id: v.id, path: v.path, name: v.name, content: r.data };
      } catch (e) {
        return { id: v.id, path: v.path, name: v.name, error: 'missing' };
      }
    },
    async closeVault(id) {
      const list = await readVaultList();
      list.vaults = list.vaults.filter(v => v.id !== id);
      if (list.activeVaultId === id) list.activeVaultId = list.vaults[0]?.id || null;
      await writeVaultList(list);
      return { vaults: list.vaults, activeVaultId: list.activeVaultId };
    },
    async renameVault(id, name) {
      const list = await readVaultList();
      const v = list.vaults.find(v => v.id === id);
      if (v) v.name = name;
      await writeVaultList(list);
      return true;
    },
    async writeFile(path, content) {
      await Filesystem.writeFile({ path, data: content, encoding: 'utf8' });
      return true;
    },
    async readFile(path) {
      const result = await Filesystem.readFile({ path, encoding: 'utf8' });
      return result.data;
    }
  };
}
```

This is a starting point, not drop-in-and-done — Android's file-picking
APIs are the fiddly part, and the exact plugin API can shift between
Capacitor versions, so treat the snippet above as a map of what needs to
happen rather than final code. Everything else (the UI, the repeat logic,
the weekday sidebar, the markdown format) is already shared and won't need
touching.

If wiring up the native folder picker feels like more than you want to take
on, the pragmatic middle ground: use the **same PWA install** on Android
(open `web/index.html` hosted somewhere, or even loaded from disk, and use
"Add to Home Screen" in Chrome) with Import/Export — noticeably less setup,
at the cost of manual export/import instead of silent auto-save.