// ---- FIREBASE CONFIG ----
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAncU4-dwtemjWWTg8gIEA1WcAOeI_d87A",
  authDomain: "lamacos-kurzbefehle.firebaseapp.com",
  databaseURL: "https://lamacos-kurzbefehle-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "lamacos-kurzbefehle",
  storageBucket: "lamacos-kurzbefehle.firebasestorage.app",
  messagingSenderId: "418008463025",
  appId: "1:418008463025:web:db9be0883fae1470d0d490"
};

// special admin password (exact match)
const ADMIN_PASSWORD = "123.lamacosadminadminlamacos123";
// admin session duration in ms (30 minutes)
const ADMIN_DURATION_MS = 30 * 60 * 1000;

// Storage key
const STORAGE_KEY = 'lamacos.shortcuts.v1';

// === Helper Functions (must be defined before use) ===
function uid(prefix='id'){ return prefix + '_' + Math.random().toString(36).slice(2,10); }
function escapeHtml(s=''){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function normalizeState(s){
  if(!s) return {shortcuts:[], folders:[], meta:{lastUpdated:0,lastWriter:null}};
  if(!s.shortcuts) s.shortcuts = [];
  if(!s.folders) s.folders = [];
  if(!s.meta) s.meta = {lastUpdated:0, lastWriter:null};
  return s;
}

function loadLocal(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return {shortcuts:[], folders:[], meta:{lastUpdated:0,lastWriter:null}};
    return normalizeState(JSON.parse(raw));
  }catch(e){
    console.warn('loadLocal error', e);
    return {shortcuts:[], folders:[], meta:{lastUpdated:0,lastWriter:null}};
  }
}

// sha256 helper
async function sha256hex(str){
  const enc = new TextEncoder().encode(str||'');
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// === Global Variables ===
// Username Setup
let userId = localStorage.getItem("lamacosUserId");
let currentUsername = '';

// load state
let state = loadLocal();
if(!state.shortcuts) state.shortcuts = [];
if(!state.folders) state.folders = [];
if(!state.meta) state.meta = { lastUpdated:0, lastWriter:null };

// DOM elements
const cardGrid = document.getElementById('cardGrid');
const folderList = document.getElementById('folderList');
const folderCount = document.getElementById('folderCount');
const overlay = document.getElementById('overlay');
const dialogContent = document.getElementById('dialogContent');
const floatMenu = document.getElementById('floatMenu');
const folderMenu = document.getElementById('folderMenu');
const plusBtn = document.getElementById('plusBtn');
const syncStatusEl = document.getElementById('syncStatus');
const adminStatusEl = document.getElementById('adminStatus');

// firebase vars
let firebaseEnabled=false, firebaseApp=null, firebaseAuth=null, firebaseDb=null, currentUid=null;

// admin
let adminMode = false;
let adminExpiresAt = 0;

function setAdminMode(on){
  adminMode = !!on;
  if(adminMode){
    adminExpiresAt = Date.now() + ADMIN_DURATION_MS;
    adminStatusEl.innerHTML = '<span class="admin-pill">Admin-Modus aktiv</span>';
    console.log('Admin-Modus aktiviert bis', new Date(adminExpiresAt).toLocaleString());
  } else {
    adminExpiresAt = 0;
    adminStatusEl.innerHTML = '';
    console.log('Admin-Modus deaktiviert');
  }
}

function checkAdminExpiry(){
  if(adminMode && Date.now() > adminExpiresAt){
    setAdminMode(false);
  }
}
setInterval(checkAdminExpiry, 1000);

function saveLocal(){
  state.meta = state.meta || {};
  state.meta.lastUpdated = Date.now();
  state.meta.lastWriter = currentUid || 'local';
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setSyncStatus(txt){ if(syncStatusEl) syncStatusEl.textContent = txt; }

// ===== User Authentication Setup =====
function setupUserAuth() {
  // Automatisch Code generieren, falls nicht vorhanden
  if (!userId) {
    // Generiere einen 8-stelligen Code
    userId = Date.now().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 6);
    userId = userId.toUpperCase(); // Macht es leichter zu lesen
    localStorage.setItem("lamacosUserId", userId);
    console.log("Neuer Code generiert:", userId);
  } else {
    console.log("Bestehender Code:", userId);
  }

  currentUsername = userId; // Code ist gleichzeitig der Username

  // Firebase initialisieren und verbinden
  console.log("Starte Firebase Initialisierung...");
  initFirebaseAuthAndSync();
}

// ===== User Menu =====
function openUserMenu() {
  const html = `
    <div style="font-weight:700;margin-bottom:8px">Dein Benutzer-Code</div>
    <div class="small muted" style="margin-bottom:12px">Mit diesem Code kannst du deine Shortcuts auf anderen Geräten bearbeiten</div>
    <div style="background:rgba(255,255,255,0.05);padding:12px;border-radius:8px;margin-bottom:12px;text-align:center;font-size:24px;font-weight:700;letter-spacing:2px;">
      ${userId}
    </div>
    <div class="small muted" style="margin-bottom:12px">Tipp: Speichere diesen Code, um auf anderen Geräten zugreifen zu können.</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
      <button id="changeCodeBtn">Code ändern</button>
      <button id="closeUserMenuBtn">Schließen</button>
    </div>
  `;
  showDialog(html);

  document.getElementById('closeUserMenuBtn').addEventListener('click', hideDialog);
  document.getElementById('changeCodeBtn').addEventListener('click', ()=> {
    hideDialog();
    setTimeout(changeUserCode, 100);
  });
}

function changeUserCode() {
  const html = `
    <div style="font-weight:700;margin-bottom:8px">Code ändern</div>
    <div class="small muted" style="margin-bottom:12px">Gib einen Code von einem anderen Gerät ein, um dort erstellte Shortcuts zu bearbeiten.</div>
    <div class="form-row">
      <input type="text" id="newCodeInput" placeholder="Neuer Code" value="" style="text-transform:uppercase;letter-spacing:2px;text-align:center;font-weight:700;">
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
      <button id="cancelChangeCode">Abbrechen</button>
      <button id="saveNewCode">Speichern</button>
    </div>
  `;
  showDialog(html);

  const input = document.getElementById('newCodeInput');
  input.focus();

  document.getElementById('cancelChangeCode').addEventListener('click', hideDialog);
  document.getElementById('saveNewCode').addEventListener('click', ()=> {
    const newCode = input.value.trim().toUpperCase();
    if(!newCode) {
      alert('Bitte gib einen Code ein');
      return;
    }

    // Code ändern
    userId = newCode;
    currentUsername = newCode;
    localStorage.setItem("lamacosUserId", userId);

    // Neu laden um mit neuem Code zu synchronisieren
    location.reload();
  });
}

// ===== Firebase init & sync (using compat SDKs loaded in HTML) =====
function initFirebaseAuthAndSync(){
  console.log("initFirebaseAuthAndSync gestartet");
  console.log("firebase vorhanden?", typeof firebase !== 'undefined');

  if(typeof firebase === 'undefined'){
    console.error("Firebase SDK nicht geladen!");
    setSyncStatus('Firebase SDK nicht geladen');
    return;
  }

  // require that user inserted config
  if(!FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey){
    console.error("Firebase nicht konfiguriert!");
    setSyncStatus('Firebase nicht konfiguriert');
    return;
  }

  try{
    console.log("Initialisiere Firebase App...");
    // Firebase App ist bereits in setupUserAuth initialisiert
    if(!firebaseApp) {
      firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
      console.log("Firebase App initialisiert");
    } else {
      console.log("Firebase App bereits vorhanden");
    }

    firebaseAuth = firebase.auth();
    console.log("Firebase Auth initialisiert");

    if(!firebaseDb) {
      firebaseDb = firebase.database();
      console.log("Firebase Database initialisiert");
    }

    firebaseEnabled = true;
    console.log("Firebase enabled = true");
    setSyncStatus('Verbinde…');
    console.log("Starte signInAnonymously...");

    firebaseAuth.signInAnonymously()
      .then(userCred=>{
        console.log("✅ signInAnonymously erfolgreich!");
        currentUid = userCred.user.uid;
        console.log("currentUid:", currentUid);
        setSyncStatus('Verbunden (UID:'+currentUid.slice(-6)+')');
        console.log("Status gesetzt: Verbunden");
        const rootRef = firebaseDb.ref('lamacos_shared_state');
        console.log("rootRef erstellt");

        rootRef.on('value', (snap)=>{
          const cloud = snap.val();
          if(!cloud) return;
          const cloudMeta = cloud.meta || { lastUpdated:0 };
          const localMeta = state.meta || { lastUpdated:0 };
          if(cloudMeta.lastUpdated > localMeta.lastUpdated){
            state = normalizeState(cloud);
            saveLocal();
            render();
            setSyncStatus('Synchronisiert (Cloud übernommen)');
          } else if(cloudMeta.lastUpdated < localMeta.lastUpdated){
            pushStateToCloud(state);
          } else {
            setSyncStatus('Synchronisiert');
          }
        });

        rootRef.once('value').then(snapshot=>{
          const cloudOnce = snapshot.val();
          if(cloudOnce){
            const cloudMeta = cloudOnce.meta || { lastUpdated:0 };
            if(cloudMeta.lastUpdated > (state.meta?.lastUpdated || 0)){
              state = normalizeState(cloudOnce); saveLocal(); render(); setSyncStatus('Initial sync (Cloud übernommen)');
            } else if(cloudMeta.lastUpdated < (state.meta?.lastUpdated || 0)){
              pushStateToCloud(state).then(()=>setSyncStatus('Initial sync (Local gepusht)'));
            } else setSyncStatus('Sync ready');
          } else {
            // Firebase ist leer – lösche lokale Daten
            console.log("Firebase ist leer – lösche lokale Daten...");
            localStorage.clear();
            state = {shortcuts:[], folders:[], meta:{lastUpdated:0,lastWriter:null}};
            render();
            setSyncStatus('Sync ready (neu gestartet)');
          }
        });
      })
      .catch(err=>{
        console.error('❌ Firebase auth error:', err);
        console.error('Error details:', err.message, err.code);
        setSyncStatus('Firebase Auth Fehler: ' + (err.message || 'Unbekannt'));
      });

  }catch(e){
    console.error('❌ Firebase init failed:', e);
    console.error('Error details:', e.message, e.stack);
    firebaseEnabled=false;
    setSyncStatus('Firebase Init fehlgeschlagen: ' + (e.message || 'Unbekannt'));
  }
}

function pushStateToCloud(s){
  if(!firebaseEnabled) return Promise.resolve();
  const toPush = JSON.parse(JSON.stringify(s));
  toPush.meta = toPush.meta || {};
  toPush.meta.lastUpdated = Date.now();
  toPush.meta.lastWriter = currentUid || 'local';
  return firebaseDb.ref('lamacos_shared_state').set(toPush)
    .then(()=>{ state.meta = toPush.meta; saveLocal(); setSyncStatus('Zuletzt synchronisiert: '+ new Date(state.meta.lastUpdated).toLocaleString()); })
    .catch(err=>{ console.warn('Push Fehler', err); setSyncStatus('Fehler beim Push'); });
}

// ===== UI helpers =====
function showDialog(html){
  dialogContent.innerHTML = html;
  overlay.classList.add('show');
}

function hideDialog(){
  overlay.classList.remove('show');
  floatMenu.style.display = 'none';
  folderMenu.style.display = 'none';
}

// close menus when clicking outside
document.addEventListener('click', (e)=>{
  if(!floatMenu.contains(e.target) && e.target !== plusBtn && !e.target.closest('.options')){
    floatMenu.style.display = 'none';
  }
  if(!folderMenu.contains(e.target)){
    folderMenu.style.display = 'none';
  }
});

// ===== Render UI =====
function render(){
  // ensure state is valid
  state = normalizeState(state);

  // render shortcuts
  cardGrid.innerHTML = '';
  state.shortcuts.forEach(sc=>{
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = sc.id;

    // Prüfe, ob dieser Shortcut dem aktuellen User gehört
    const isOwner = sc.ownerId === userId || adminMode;

    el.innerHTML = `
      <div class="icon">${sc.icon || '🔗'}</div>
      <div class="meta" style="flex:1">
        <div class="name">${escapeHtml(sc.name)}</div>
        <div class="desc">${escapeHtml(sc.description || sc.link || '')}</div>
      </div>
      <div class="card-right" style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
        ${isOwner ? '<div class="options" title="Optionen" style="cursor:pointer;padding:6px 8px;border-radius:8px">⋮</div>' : ''}
        ${sc.folderId ? `<div class="small muted" style="font-size:12px;opacity:0.9">📁 ${escapeHtml(getFolderName(sc.folderId)||'')}</div>` : ''}
      </div>
    `;

    // click opens link unless options clicked
    el.addEventListener('click', (e)=>{
      if(e.target.closest('.options')) return;
      if(sc.link) window.open(sc.link, '_blank');
    });

    // options nur wenn Owner
    if(isOwner) {
      const optionsBtn = el.querySelector('.options');
      if(optionsBtn) {
        optionsBtn.addEventListener('click', (e)=>{ e.stopPropagation(); openShortcutMenuAtElement(el, sc); });
      }
      addLongPress(el, ()=> openShortcutMenuAtElement(el, sc));
    }

    cardGrid.appendChild(el);
  });

  // render folders
  folderList.innerHTML = '';
  state.folders.forEach(f=>{
    const fe = document.createElement('div');
    fe.className='card';
    fe.dataset.id = f.id;
    fe.style.marginBottom = '10px';

    // Prüfe, ob dieser Ordner dem aktuellen User gehört
    const isOwner = f.ownerId === userId || adminMode;

    fe.innerHTML = `
      <div class="icon">📁</div>
      <div class="meta" style="flex:1">
        <div class="name">${escapeHtml(f.name)} ${f.locked ? '🔒' : ''}</div>
        <div class="desc small">${(f.items?.length||0)} Kurzbefehle</div>
      </div>
      <div class="card-right" style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
        ${isOwner ? '<div class="options" title="Ordner Optionen" style="cursor:pointer;padding:6px 8px;border-radius:8px">⋮</div>' : ''}
      </div>
    `;

    fe.addEventListener('click', ()=> openFolder(f.id) );

    if(isOwner) {
      const opt = fe.querySelector('.options');
      if(opt) {
        opt.addEventListener('click', (e)=>{ e.stopPropagation(); openFolderMenuAtElement(fe, f); });
      }
      addLongPress(fe, ()=> openFolderMenuAtElement(fe, f));
    }

    folderList.appendChild(fe);
  });

  folderCount.textContent = state.folders.length;
}

// longpress (mouse + touch)
function addLongPress(el, callback){
  let timer = null;
  el.addEventListener('mousedown', ()=> timer = setTimeout(callback, 500));
  el.addEventListener('mouseup', ()=> { if(timer) clearTimeout(timer); });
  el.addEventListener('mouseleave', ()=> { if(timer) clearTimeout(timer); });
  el.addEventListener('touchstart', ()=> timer = setTimeout(callback, 600));
  el.addEventListener('touchend', ()=> { if(timer) clearTimeout(timer); });
}

// ===== Menus =====
function openShortcutMenuAtElement(el, sc){
  floatMenu.innerHTML = '';
  addMenuOption(floatMenu, 'Bearbeiten', ()=>{ floatMenu.style.display='none'; openShortcutDialog(sc); });
  addMenuOption(floatMenu, sc.folderId ? 'Aus Ordner entfernen' : 'Zu Ordner verschieben', ()=>{
    floatMenu.style.display='none';
    if(sc.folderId) {
      moveShortcutToFolder(sc.id, null);
    } else {
      showFolderPickerForShortcut(sc);
    }
  });
  addMenuOption(floatMenu, 'Löschen', ()=>{ floatMenu.style.display='none'; deleteShortcut(sc.id); }, true, false);
  addMenuOption(floatMenu, 'Abbrechen', ()=>{ floatMenu.style.display='none'; }, false, true);

  floatMenu.style.display = 'block';
  const rect = el.getBoundingClientRect();
  requestAnimationFrame(()=> {
    const w = floatMenu.offsetWidth;
    floatMenu.style.top = (rect.bottom + 8) + 'px';
    floatMenu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8)) + 'px';
  });
}

function openFolderMenuAtElement(el, f){
  folderMenu.innerHTML = '';
  addMenuOption(folderMenu, 'Bearbeiten', ()=>{ folderMenu.style.display='none'; openFolderDialog(f); });
  if(!f.locked) addMenuOption(folderMenu, 'Sperren', ()=>{ folderMenu.style.display='none'; lockFolder(f); });
  else addMenuOption(folderMenu, 'Entsperren', ()=>{ folderMenu.style.display='none'; unlockFolder(f); });
  addMenuOption(folderMenu, 'Löschen', ()=>{ folderMenu.style.display='none'; deleteFolder(f.id); }, true, false);
  addMenuOption(folderMenu, 'Abbrechen', ()=>{ folderMenu.style.display='none'; }, false, true);

  folderMenu.style.display = 'block';
  const rect = el.getBoundingClientRect();
  requestAnimationFrame(()=> {
    const w = folderMenu.offsetWidth;
    folderMenu.style.top = (rect.bottom + 8) + 'px';
    folderMenu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8)) + 'px';
  });
}

function addMenuOption(menuEl, text, fn, danger=false, cancel=false){
  const btn = document.createElement('button');
  btn.textContent = text;
  if(cancel) btn.className = 'cancel';
  if(danger) btn.style.color = 'var(--danger)';
  btn.addEventListener('click', fn);
  menuEl.appendChild(btn);

  // make first option visually prominent
  if(menuEl.children.length === 1){
    btn.style.fontWeight = '700';
    btn.style.background = 'rgba(255,255,255,0.03)';
  }
}

// ===== Shortcut Dialog (create/edit) =====
function openShortcutDialog(sc = null){
  const isNew = !sc;
  const id = isNew ? uid() : sc.id;
  const folderOptions = state.folders.map(f=>`<option value="${f.id}" ${sc?.folderId===f.id ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('');
  const html = `
    <div style="font-weight:700;margin-bottom:8px">${isNew ? 'Neuer Kurzbefehl' : 'Bearbeite Kurzbefehl'}</div>
    <div class="form-row"><input type="text" id="scName" placeholder="Name" value="${sc?escapeHtml(sc.name):''}"></div>
    <div class="form-row"><input type="text" id="scIcon" placeholder="Icon (Emoji)" value="${sc?escapeHtml(sc.icon):''}"></div>
    <div class="form-row"><input type="url" id="scLink" placeholder="Link" value="${sc?escapeHtml(sc.link):''}"></div>
    <div class="form-row"><textarea id="scDesc" placeholder="Beschreibung">${sc?escapeHtml(sc.description):''}</textarea></div>
    <div class="form-row">
      <select id="scFolder">
        <option value="">Kein Ordner</option>
        ${folderOptions}
      </select>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
      <button id="scCancel">Abbrechen</button>
      <button id="scSave">Speichern</button>
    </div>
  `;
  showDialog(html);

  document.getElementById('scCancel').addEventListener('click', hideDialog);
  document.getElementById('scSave').addEventListener('click', ()=>{
    const name = document.getElementById('scName').value.trim();
    const icon = document.getElementById('scIcon').value.trim();
    const link = document.getElementById('scLink').value.trim();
    const desc = document.getElementById('scDesc').value.trim();
    const folderId = document.getElementById('scFolder').value || null;
    if(!name) return alert('Name ist Pflicht');

    if(isNew){
      state.shortcuts.push({ id, name, icon, link, description: desc, folderId, ownerId: userId });
    } else {
      const s = state.shortcuts.find(x=>x.id===id);
      if(s){ s.name=name; s.icon=icon; s.link=link; s.description=desc; s.folderId = folderId; }
    }

    // normalize folder items
    state.folders.forEach(f=>{ f.items = (f.items||[]).filter(i=>i!==id); });
    if(folderId){
      const target = state.folders.find(f=>f.id===folderId);
      if(target) target.items = target.items || [], target.items.push(id);
    }

    saveLocal();
    if(firebaseEnabled) pushStateToCloud(state);
    render(); hideDialog();
  });
}

// ===== Folder Dialog (create/edit) =====
function openFolderDialog(f = null){
  const isNew = !f;
  const html = `
    <div style="font-weight:700;margin-bottom:8px">${isNew ? 'Neuer Ordner' : 'Bearbeite Ordner'}</div>
    <div class="form-row"><input type="text" id="fName" placeholder="Ordnername" value="${f?escapeHtml(f.name):''}"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
      <button id="fCancel">Abbrechen</button>
      <button id="fSave">Speichern</button>
    </div>
  `;
  showDialog(html);
  document.getElementById('fCancel').addEventListener('click', hideDialog);
  document.getElementById('fSave').addEventListener('click', ()=>{
    const name = document.getElementById('fName').value.trim();
    if(!name) return alert('Name ist Pflicht');
    if(isNew){
      state.folders.push({ id: uid(), name, items: [], locked:false, pwHash:null, ownerId: userId });
    } else {
      f.name = name;
    }
    saveLocal();
    if(firebaseEnabled) pushStateToCloud(state);
    render(); hideDialog();
  });
}

// ===== Folder open + contents + password handling =====
async function openFolder(id){
  const f = state.folders.find(x=>x.id===id);
  if(!f) return;
  // admin bypass
  if(f.locked && adminMode){
    showFolderContents(f);
    return;
  }
  if(f.locked){
    const ok = await promptFolderPassword(f);
    if(!ok) return;
    showFolderContents(f);
  } else {
    showFolderContents(f);
  }
}

function showFolderContents(f){
  const html = `
    <div style="font-weight:700;margin-bottom:8px">Ordner: ${escapeHtml(f.name)} ${adminMode ? ' — Admin' : ''}</div>
    <div class="small muted">Enthält ${f.items?.length || 0} Kurzbefehle</div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">
      ${ (f.items || []).map(id=>{
          const sc = state.shortcuts.find(s=>s.id===id);
          if(!sc) return '';
          return `<div class="card folder-card" data-id="${sc.id}">
                    <div class="icon">${sc.icon||'🔗'}</div>
                    <div class="meta"><div class="name">${escapeHtml(sc.name)}</div></div>
                  </div>`;
        }).join('') }
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px">
      <button id="closeFolderBtn">Schließen</button>
    </div>
  `;
  showDialog(html);

  (f.items || []).forEach(id=>{
    const el = dialogContent.querySelector(`.folder-card[data-id="${id}"]`);
    const sc = state.shortcuts.find(s=>s.id===id);
    if(el && sc){
      el.addEventListener('click', ()=> { if(sc.link) window.open(sc.link, '_blank'); });
      // Nur wenn der aktuelle User der Owner ist, longpress aktivieren
      if(sc.ownerId === userId || adminMode) {
        addLongPress(el, ()=> openShortcutMenuAtElement(el, sc));
      }
    }
  });

  document.getElementById('closeFolderBtn').addEventListener('click', hideDialog);
}

function promptFolderPassword(f){
  return new Promise(resolve=>{
    const html = `
      <div style="font-weight:700;margin-bottom:8px">Gib Passwort für Ordner ${escapeHtml(f.name)} ein:</div>
      <input id="folderPwInput" type="password" placeholder="Passwort" style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.04);background:rgba(255,255,255,0.02);color:var(--accent);margin-bottom:12px" />
      <div style="display:flex;justify-content:flex-end;gap:6px">
        <button id="folderPwCancel">Abbrechen</button>
        <button id="folderPwOk">OK</button>
      </div>
    `;
    showDialog(html);
    document.getElementById('folderPwCancel').addEventListener('click', ()=> { hideDialog(); resolve(false); }, { once:true });
    document.getElementById('folderPwOk').addEventListener('click', async ()=>{
      const pw = document.getElementById('folderPwInput').value || '';
      // special admin activation shortcut
      if(pw === ADMIN_PASSWORD){
        setAdminMode(true);
        hideDialog();
        alert('Admin-Modus aktiviert für 30 Minuten ✅');
        resolve(true);
        return;
      }
      const hash = await sha256hex(pw);
      if(hash === f.pwHash){ hideDialog(); resolve(true); }
      else { hideDialog(); alert('Falsches Passwort'); resolve(false); }
    }, { once:true });
  });
}

// ===== Folder lock/unlock/delete =====
function lockFolder(f){
  const pw = prompt('Neues Passwort für Ordner:');
  if(!pw) return;
  sha256hex(pw).then(hash=>{
    f.pwHash = hash;
    f.locked = true;
    saveLocal();
    if(firebaseEnabled) pushStateToCloud(state);
    render();
  });
}

function unlockFolder(f){
  // admin can unlock without password
  if(adminMode){
    f.locked = false; f.pwHash = null;
    saveLocal(); if(firebaseEnabled) pushStateToCloud(state); render();
    alert('Ordner per Admin entsperrt');
    return;
  }
  const pw = prompt('Passwort zum Entsperren:');
  if(!pw) return;
  sha256hex(pw).then(hash=>{
    if(hash === f.pwHash){ f.locked = false; saveLocal(); if(firebaseEnabled) pushStateToCloud(state); render(); }
    else alert('Falsches Passwort');
  });
}

function deleteFolder(folderId){
  state.folders = state.folders.filter(x=>x.id!==folderId);
  state.shortcuts.forEach(s=>{ if(s.folderId === folderId) s.folderId = null; });
  saveLocal();
  if(firebaseEnabled) pushStateToCloud(state);
  render();
}

// ===== move shortcut to folder =====
function moveShortcutToFolder(scId, folderId){
  state.folders.forEach(f=>{ f.items = (f.items||[]).filter(i=>i!==scId); });
  const sc = state.shortcuts.find(s=>s.id===scId);
  if(sc) sc.folderId = folderId || null;
  if(folderId){
    const folder = state.folders.find(f=>f.id===folderId);
    if(folder) folder.items = folder.items || [], folder.items.push(scId);
  }
  saveLocal();
  if(firebaseEnabled) pushStateToCloud(state);
  render();
}

// ===== folder picker dialog for moving sc =====
function showFolderPickerForShortcut(sc){
  const options = state.folders.map(f=>`<button class="pickFolderBtn" data-id="${f.id}" style="margin-bottom:6px;padding:8px;border-radius:6px;width:100%;text-align:left">${escapeHtml(f.name)}</button>`).join('');
  const html = `<div style="font-weight:700;margin-bottom:8px">Verschiebe "${escapeHtml(sc.name)}" nach:</div>
    <div style="display:flex;flex-direction:column;gap:6px">${options}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:10px"><button id="pickCancel">Abbrechen</button></div>`;
  showDialog(html);
  dialogContent.querySelectorAll('.pickFolderBtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const fid = btn.dataset.id;
      moveShortcutToFolder(sc.id, fid);
      hideDialog();
    });
  });
  document.getElementById('pickCancel').addEventListener('click', hideDialog);
}

// ===== delete shortcut =====
function deleteShortcut(scId){
  state.shortcuts = state.shortcuts.filter(s=>s.id !== scId);
  state.folders.forEach(f=> f.items = (f.items||[]).filter(i=>i!==scId));
  saveLocal();
  if(firebaseEnabled) pushStateToCloud(state);
  render();
}

// helper
function getFolderName(folderId){
  const f = state.folders.find(x=>x.id===folderId);
  return f ? f.name : '';
}

// setup plus button and global bindings
function setupBindings(){
  // User Icon Click
  const userIcon = document.getElementById('userIcon');
  if(userIcon) {
    userIcon.addEventListener('click', openUserMenu);
  }

  plusBtn.addEventListener('click', ()=>{
    floatMenu.innerHTML = '';
    addMenuOption(floatMenu, 'Neuer Kurzbefehl', ()=>{ floatMenu.style.display='none'; openShortcutDialog(); });
    addMenuOption(floatMenu, 'Neuer Ordner', ()=>{ floatMenu.style.display='none'; openFolderDialog(); });
    addMenuOption(floatMenu, 'Abbrechen', ()=>{ floatMenu.style.display='none'; }, false, true);
    floatMenu.style.display = 'block';
    const rect = plusBtn.getBoundingClientRect();
    requestAnimationFrame(()=> {
      const w = floatMenu.offsetWidth;
      floatMenu.style.top = (rect.bottom + 8) + 'px';
      floatMenu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8)) + 'px';
    });
  });

  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape'){ hideDialog(); floatMenu.style.display='none'; folderMenu.style.display='none'; }});
}

setupBindings();
render();

// Start with user authentication setup
setupUserAuth();

// export some helpers (so dynamically created HTML can call them if needed)
window.openShortcutDialog = openShortcutDialog;
window.openFolderDialog = openFolderDialog;
window.openFolder = openFolder;
window.hideDialog = hideDialog;
window.openFolderMenuAtElement = openFolderMenuAtElement;
window.openShortcutMenuAtElement = openShortcutMenuAtElement;
/* ---------- GLOBAL ---------- */
if (typeof allItems === "undefined") var allItems = [];

let container = document.getElementById("item-container");
if (!container) {
    container = document.createElement("div");
    container.id = "item-container";
    document.body.appendChild(container);
}

/* ---------- SEARCH BAR ---------- */
let searchBar = document.getElementById("search-bar");
if (!searchBar) {
    searchBar = document.createElement("input");
    searchBar.id = "search-bar";
    searchBar.placeholder = "Suche nach Name oder Tags...";
    document.body.prepend(searchBar);
}

searchBar.addEventListener("input", () => {
    const query = searchBar.value.toLowerCase();
    const filtered = allItems.filter(item =>
        item.name.toLowerCase().includes(query) ||
        (item.tags && item.tags.some(tag => tag.toLowerCase().includes(query)))
    );
    filtered.sort((a, b) => a.name.localeCompare(b.name));
    renderItems(filtered);
});

/* ---------- RENDER FUNCTION ---------- */
function renderItems(list) {
    container.innerHTML = "";
    list.sort((a, b) => a.name.localeCompare(b.name));
    list.forEach(item => {
        const div = document.createElement("div");
        div.style.marginBottom = "5px";
        div.textContent = item.name;

        if (item.tags && item.tags.length > 0) {
            const tagContainer = document.createElement("span");
            item.tags.forEach(tag => {
                const chip = document.createElement("span");
                chip.className = "tag-chip";
                chip.textContent = tag;
                tagContainer.appendChild(chip);
            });
            div.appendChild(document.createElement("br"));
            div.appendChild(tagContainer);
        }

        container.appendChild(div);
    });
}

/* ---------- CREATE / EDIT FORM ---------- */
function createOrEditItem(existingItem = null) {
    const form = document.createElement("form");
    form.style.margin = "10px 0";

    // Name
    const nameInput = document.createElement("input");
    nameInput.placeholder = "Name";
    nameInput.value = existingItem ? existingItem.name : "";
    nameInput.style.width = "100%";
    nameInput.style.padding = "6px 10px";
    nameInput.style.marginBottom = "5px";
    form.appendChild(nameInput);

    // Tags
    const tagInput = document.createElement("input");
    tagInput.placeholder = "Tags (max. 5, durch Kommas getrennt)";
    tagInput.className = "tag-input";
    tagInput.value = existingItem && existingItem.tags ? existingItem.tags.join(", ") : "";
    form.appendChild(tagInput);

    // Submit
    const submitBtn = document.createElement("button");
    submitBtn.textContent = "Speichern";
    submitBtn.style.marginTop = "5px";
    form.appendChild(submitBtn);

    form.addEventListener("submit", e => {
        e.preventDefault();
        let tags = tagInput.value.split(",").map(t => t.trim()).filter(t => t);
        if (tags.length > 5) {
            alert("Maximal 5 Tags erlaubt!");
            return;
        }

        const newItem = {
            name: nameInput.value,
            type: existingItem ? existingItem.type : "shortcut",
            tags: tags
        };

        if (existingItem) Object.assign(existingItem, newItem);
        else allItems.push(newItem);

        if (typeof saveToFirebase === "function") saveToFirebase();
        renderItems(allItems);
        form.remove();
    });

    document.body.appendChild(form);
}

/* ---------- CREATE BUTTON ---------- */
let createBtn = document.getElementById("create-item-btn");
if (!createBtn) {
    createBtn = document.createElement("button");
    createBtn.id = "create-item-btn";
    createBtn.textContent = "Neuer Kurzbefehl / Ordner";
    createBtn.style.display = "block";
    createBtn.style.marginTop = "10px";
    createBtn.addEventListener("click", () => createOrEditItem());
    document.body.appendChild(createBtn);
}

/* ---------- INITIAL RENDER ---------- */
renderItems(allItems);