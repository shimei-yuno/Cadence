// Update checker (main process).
//
// Asks GitHub which published release of Cadence is newest. If it is newer
// than the running build, the renderer is handed a direct link to the
// installer so it can open it in the browser. The app itself never downloads
// or installs anything.
const { app, ipcMain, shell } = require('electron');
const https = require('https');

const REPO = 'shimei-yuno/Cadence';
const URL_PREFIX = 'https://github.com/' + REPO.toLowerCase() + '/';
const TIMEOUT_MS = 8000;

// "v1.12.0", "1.12" and "V1.12.0" all parse; anything else returns null.
function parseVersion(tag){
  const m = String(tag == null ? '' : tag).trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if(!m) return null;
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
}

// > 0 when `a` is newer than `b`. Compared as numbers, so 1.10.0 beats 1.9.0.
function compareVersions(a, b){
  const x = parseVersion(a), y = parseVersion(b);
  if(!x || !y) return 0;
  for(let i = 0; i < 3; i++){
    if(x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

// Highest version among published releases. GitHub's own "latest" is the most
// recently *created* release, which would point at an old version if an
// archived release were ever uploaded late — so compare version numbers.
function pickLatestRelease(releases){
  let best = null;
  for(const r of Array.isArray(releases) ? releases : []){
    if(!r || r.draft || r.prerelease || !parseVersion(r.tag_name)) continue;
    if(!best || compareVersions(r.tag_name, best.tag_name) > 0) best = r;
  }
  return best;
}

// The right download for this machine: the installer on Windows (or the
// portable exe when running the portable build), .dmg on Mac, AppImage on Linux.
function pickAsset(assets, platform, portable){
  const list = (Array.isArray(assets) ? assets : []).filter(a => a && a.name && a.browser_download_url);
  if(platform === 'win32'){
    const exes = list.filter(a => /\.exe$/i.test(a.name));
    return (portable ? exes.find(a => !/setup/i.test(a.name)) : exes.find(a => /setup/i.test(a.name))) || null;
  }
  if(platform === 'darwin') return list.find(a => /\.dmg$/i.test(a.name)) || null;
  return list.find(a => /\.appimage$/i.test(a.name)) || null;
}

function isAllowedUrl(url){
  return typeof url === 'string' && url.toLowerCase().startsWith(URL_PREFIX);
}

function getJson(url, redirectsLeft = 2){
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Cadence-update-check', 'Accept': 'application/vnd.github+json' },
      timeout: TIMEOUT_MS
    }, (res) => {
      const status = res.statusCode;
      if([301, 302, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0){
        res.resume();
        resolve(getJson(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if(body.length > 2000000) req.destroy(new Error('response too large'));
      });
      res.on('end', () => resolve({ status, body }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function checkForUpdates(){
  const current = app.getVersion();
  try{
    const res = await getJson('https://api.github.com/repos/' + REPO + '/releases?per_page=30');
    if(res.status === 404) return { ok: true, current, none: true };
    if(res.status === 403 || res.status === 429) return { ok: false, current, error: 'rate-limited' };
    if(res.status !== 200) return { ok: false, current, error: 'http-' + res.status };
    const release = pickLatestRelease(JSON.parse(res.body));
    if(!release) return { ok: true, current, none: true };
    const asset = pickAsset(release.assets, process.platform, !!process.env.PORTABLE_EXECUTABLE_DIR);
    return {
      ok: true,
      current,
      latest: String(release.tag_name),
      newer: compareVersions(release.tag_name, current) > 0,
      releaseUrl: release.html_url || null,
      downloadUrl: asset ? asset.browser_download_url : null
    };
  }catch(e){
    return { ok: false, current, error: 'network' };
  }
}

function register(){
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('check-for-updates', () => checkForUpdates());
  // Only ever opens links that point into this project's GitHub repo.
  ipcMain.handle('open-update-url', async (evt, url) => {
    if(!isAllowedUrl(url)) return false;
    try{ await shell.openExternal(url); return true; }catch(e){ return false; }
  });
}

module.exports = { register, checkForUpdates, parseVersion, compareVersions, pickLatestRelease, pickAsset, isAllowedUrl };
