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
const ADMIN_DURATION_MS = 30 * 60 * 1000; // 30 Minuten
const STORAGE_KEY = 'lamacos.shortcuts.v1';

// === Helper Functions ===
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
  }catch(e){ console.warn('loadLocal error', e); return {shortcuts:[], folders:[], meta:{lastUpdated:0,lastWriter:null}}; }
}
async function sha256hex(str){
  const enc = new TextEncoder().encode(str||'');
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// === Globals ===
let userId = localStorage.getItem("lamacosUserId");
let currentUsername = '';
let state = loadLocal();
if(!state.shortcuts) state.shortcuts = [];
if(!state.folders) state.folders = [];
if(!state.meta) state.meta = { lastUpdated:0, lastWriter:null };

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

let firebaseEnabled=false, firebaseApp=null, firebaseAuth=null, firebaseDb=null, currentUid=null;
let adminMode = false, adminExpiresAt = 0;

// ===== Admin Mode =====
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
function checkAdminExpiry(){ if(adminMode && Date.now() > adminExpiresAt) setAdminMode(false); }
setInterval(checkAdminExpiry, 1000);

function saveLocal(){ state.meta = state.meta || {}; state.meta.lastUpdated = Date.now(); state.meta.lastWriter = currentUid || 'local'; localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function setSyncStatus(txt){ if(syncStatusEl) syncStatusEl.textContent = txt; }

// ===== User Authentication =====
function setupUserAuth() {
  if(!userId){
    userId = Date.now().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 6);
    userId = userId.toUpperCase();
    localStorage.setItem("lamacosUserId", userId);
    console.log("Neuer Code generiert:", userId);
  } else console.log("Bestehender Code:", userId);
  currentUsername = userId;
  initFirebaseAuthAndSync();
}

// ===== User Menu =====
function openUserMenu(){
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
  document.getElementById('changeCodeBtn').addEventListener('click', ()=> { hideDialog(); setTimeout(changeUserCode, 100); });
}
function changeUserCode(){
  const html = `
    <div style="font-weight:700;margin-bottom:8px">Code ändern</div>
    <div class="small muted" style="margin-bottom:12px">Gib einen Code von einem anderen Gerät ein, um dort erstellte Shortcuts zu bearbeiten.</div>
    <div class="form-row"><input type="text" id="newCodeInput" placeholder="Neuer Code" style="text-transform:uppercase;letter-spacing:2px;text-align:center;font-weight:700;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
      <button id="cancelChangeCode">Abbrechen</button>
      <button id="saveNewCode">Speichern</button>
    </div>
  `;
  showDialog(html);
  const input = document.getElementById('newCodeInput'); input.focus();
  document.getElementById('cancelChangeCode').addEventListener('click', hideDialog);
  document.getElementById('saveNewCode').addEventListener('click', ()=> {
    const newCode = input.value.trim().toUpperCase();
    if(!newCode){ alert('Bitte gib einen Code ein'); return; }
    userId = newCode; currentUsername = newCode; localStorage.setItem("lamacosUserId", userId);
    location.reload();
  });
}

// ===== Firebase init & sync =====
function initFirebaseAuthAndSync(){
  if(typeof firebase==='undefined'){ setSyncStatus('Firebase SDK nicht geladen'); return; }
  if(!FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey){ setSyncStatus('Firebase nicht konfiguriert'); return; }
  try{
    if(!firebaseApp) firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
    firebaseAuth = firebase.auth();
    if(!firebaseDb) firebaseDb = firebase.database();
    firebaseEnabled=true;
    setSyncStatus('Verbinde…');
    firebaseAuth.signInAnonymously()
      .then(userCred=>{
        currentUid = userCred.user.uid;
        setSyncStatus('Verbunden (UID:'+currentUid.slice(-6)+')');
        const rootRef = firebaseDb.ref('lamacos_shared_state');
        rootRef.on('value', snap=>{
          const cloud = snap.val();
          if(!cloud) return;
          const cloudMeta = cloud.meta || { lastUpdated:0 };
          const localMeta = state.meta || { lastUpdated:0 };
          if(cloudMeta.lastUpdated > localMeta.lastUpdated){ state = normalizeState(cloud); saveLocal(); render(); setSyncStatus('Synchronisiert (Cloud übernommen)'); }
          else if(cloudMeta.lastUpdated < localMeta.lastUpdated) pushStateToCloud(state);
          else setSyncStatus('Synchronisiert');
        });
        rootRef.once('value').then(snapshot=>{
          const cloudOnce = snapshot.val();
          if(cloudOnce){
            const cloudMeta = cloudOnce.meta || { lastUpdated:0 };
            if(cloudMeta.lastUpdated > (state.meta?.lastUpdated || 0)){ state = normalizeState(cloudOnce); saveLocal(); render(); setSyncStatus('Initial sync (Cloud übernommen)'); }
            else if(cloudMeta.lastUpdated < (state.meta?.lastUpdated || 0)) pushStateToCloud(state).then(()=>setSyncStatus('Initial sync (Local gepusht)'));
            else setSyncStatus('Sync ready');
          } else { localStorage.clear(); state={shortcuts:[], folders:[], meta:{lastUpdated:0,lastWriter:null}}; render(); setSyncStatus('Sync ready (neu gestartet)'); }
        });
      }).catch(err=>{ console.error('Firebase auth error:',err); setSyncStatus('Firebase Auth Fehler'); });
  }catch(e){ firebaseEnabled=false; setSyncStatus('Firebase Init fehlgeschlagen'); }
}
function pushStateToCloud(s){
  if(!firebaseEnabled) return Promise.resolve();
  const toPush = JSON.parse(JSON.stringify(s));
  toPush.meta = toPush.meta || {}; toPush.meta.lastUpdated = Date.now(); toPush.meta.lastWriter = currentUid || 'local';
  return firebaseDb.ref('lamacos_shared_state').set(toPush)
    .then(()=>{ state.meta=toPush.meta; saveLocal(); setSyncStatus('Zuletzt synchronisiert: '+new Date(state.meta.lastUpdated).toLocaleString()); })
    .catch(err=>{ setSyncStatus('Fehler beim Push'); });
}

// ===== Render UI =====
function render(){
  state = normalizeState(state);
  cardGrid.innerHTML = '';
  state.shortcuts.forEach(sc=>{
    const isOwner = sc.ownerId === userId || adminMode;
    const el = document.createElement('div');
    el.className='card'; el.dataset.id=sc.id;
    el.innerHTML = `
      <div class="icon">${sc.icon||'🔗'}</div>
      <div class="meta" style="flex:1">
        <div class="name">${escapeHtml(sc.name)}</div>
        <div class="desc">${escapeHtml(sc.description || sc.link || '')}</div>
      </div>
      <div class="card-right" style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
        ${isOwner ? '<div class="options" title="Optionen" style="cursor:pointer;padding:6px 8px;border-radius:8px">⋮</div>' : ''}
        ${sc.folderId ? `<div class="small muted" style="font-size:12px;opacity:0.9">📁 ${escapeHtml(getFolderName(sc.folderId)||'')}</div>` : ''}
      </div>
    `;
    el.addEventListener('click', e=>{ if(e.target.closest('.options')) return; if(sc.link) window.open(sc.link,'_blank'); });
    if(isOwner){
      const optionsBtn = el.querySelector('.options');
      if(optionsBtn) optionsBtn.addEventListener('click', e=>{ e.stopPropagation(); openShortcutMenuAtElement(el, sc); });
      addLongPress(el, ()=> openShortcutMenuAtElement(el, sc));
    }
    cardGrid.appendChild(el);
  });

  folderList.innerHTML = '';
  state.folders.forEach(f=>{
    const fe = document.createElement('div'); fe.className='card'; fe.dataset.id=f.id; fe.style.marginBottom='10px';
    const isOwner = f.ownerId === userId || adminMode;
    fe.innerHTML = `
      <div class="icon">📁</div>
      <div class="meta" style="flex:1">
        <div class="name">${escapeHtml(f.name)} ${f.locked?'🔒':''}</div>
        <div class="desc small">${(f.items?.length||0)} Kurzbefehle</div>
      </div>
      <div class="card-right" style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
        ${isOwner ? '<div class="options" title="Ordner Optionen" style="cursor:pointer;padding:6px 8px;border-radius:8px">⋮</div>' : ''}
      </div>
    `;
    fe.addEventListener('click', ()=> openFolder(f.id));
    if(isOwner){
      const opt = fe.querySelector('.options');
      if(opt) opt.addEventListener('click', e=>{ e.stopPropagation(); openFolderMenuAtElement(fe,f); });
      addLongPress(fe, ()=> openFolderMenuAtElement(fe,f));
    }
    folderList.appendChild(fe);
  });
  folderCount.textContent = state.folders.length;
}

// ===== Shortcut Dialog (create/edit) =====
function openShortcutDialog(sc=null){
  const isNew = !sc;
  const isAdminEdit = adminMode && sc && sc.ownerId !== userId;
  if(sc && !isNew && !isAdminEdit && sc.ownerId !== userId){ alert('Du darfst diesen Shortcut nicht bearbeiten.'); return; }

  const id = isNew ? uid() : sc.id;
  const folderOptions = state.folders.map(f=>`<option value="${f.id}" ${sc?.folderId===f.id?'selected':''}>${escapeHtml(f.name)}</option>`).join('');
  const html = `
    <div style="font-weight:700;margin-bottom:8px">${isNew?'Neuer Kurzbefehl':'Bearbeite Kurzbefehl'}</div>
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

    if(isNew){ state.shortcuts.push({id,name,icon,link,description:desc,folderId,ownerId:userId}); }
    else {
      const s = state.shortcuts.find(x=>x.id===id);
      if(s){ s.name=name; s.icon=icon; s.link=link; s.description=desc; s.folderId=folderId; }
    }

    state.folders.forEach(f=>{ f.items=(f.items||[]).filter(i=>i!==id); });
    if(folderId){ const target=state.folders.find(f=>f.id===folderId); if(target) target.items=target.items||[], target.items.push(id); }

    saveLocal(); if(firebaseEnabled) pushStateToCloud(state); render(); hideDialog();
  });
}

// ===== Folder Dialog =====
function openFolderDialog(f=null){
  const isNew = !f;
  const isAdminEdit = adminMode && f && f.ownerId !== userId;
  if(f && !isNew && !isAdminEdit && f.ownerId !== userId){ alert('Du darfst diesen Ordner nicht bearbeiten.'); return; }
  const html = `
    <div style="font-weight:700;margin-bottom:8px">${isNew?'Neuer Ordner':'Bearbeite Ordner'}</div>
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
    if(isNew){ state.folders.push({ id: uid(), name, items: [], locked:false, pwHash:null, ownerId: userId }); }
    else { f.name = name; }
    saveLocal(); if(firebaseEnabled) pushStateToCloud(state); render(); hideDialog();
  });
}

// ===== Die restlichen Dialog-Funktionen =====
function showDialog(html){ dialogContent.innerHTML=html; overlay.style.display='block'; }
function hideDialog(){ overlay.style.display='none'; dialogContent.innerHTML=''; }

// ===== LongPress Helfer =====
function addLongPress(el, callback, duration=600){
  let timer=null;
  el.addEventListener('mousedown', ()=>{ timer=setTimeout(callback,duration); });
  el.addEventListener('mouseup', ()=>{ if(timer) clearTimeout(timer); });
  el.addEventListener('mouseleave', ()=>{ if(timer) clearTimeout(timer); });
}

// ===== Initialisierung =====
setupUserAuth();
render();
