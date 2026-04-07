/* ═══════════════════════════════════════════════════
   LICENSE TRACKER — app.js
   Talks to Google Apps Script Web App as the backend.
   Falls back to localStorage demo mode if not configured.
═══════════════════════════════════════════════════ */

// ─── CONFIG ────────────────────────────────────────
const CONFIG_KEY  = 'licenseTrackerScriptUrl';
const SECRET_KEY  = 'licenseTrackerWriteSecret';
const DEMO_KEY    = 'licenseTrackerDemoData';

let scriptUrl   = localStorage.getItem(CONFIG_KEY)  || '';
let writeSecret = localStorage.getItem(SECRET_KEY)  || '';
let allLicenses = [];   // raw data from backend / demo
let filtered    = [];   // currently displayed rows
let currentView = 'all';
let editingId   = null; // row id being edited

// ─── INIT ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  populateStateDropdowns();
  loadData();
  createToastContainer();
});

function populateStateDropdowns() {
  const targets = [
    ...document.querySelectorAll('select[name="residentState"]'),
    document.querySelector('select[name="licenseState"]'),
  ];
  const filterSel = document.getElementById('stateFilter');

  US_STATES.forEach(s => {
    targets.forEach(sel => {
      if (!sel) return;
      const o = document.createElement('option');
      o.value = o.textContent = s;
      sel.appendChild(o);
    });
    const o = document.createElement('option');
    o.value = o.textContent = s;
    filterSel.appendChild(o);
  });
}

// ─── DATA LOADING ───────────────────────────────────
async function loadData() {
  setTableLoading(true);
  try {
    if (scriptUrl) {
      const res = await fetch(`${scriptUrl}?action=getLicenses`);
      if (!res.ok) throw new Error('Network error');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      allLicenses = json.data || [];
      showBanner('');
    } else {
      allLicenses = getDemoData();
      showDemoBanner();
    }
    populateProducerFilter();
    applyFilters();
    updateStats();
    checkAlerts();
  } catch (err) {
    console.error(err);
    showToast('Failed to load data: ' + err.message, 'error');
    allLicenses = getDemoData();
    showDemoBanner();
    populateProducerFilter();
    applyFilters();
    updateStats();
  } finally {
    setTableLoading(false);
  }
}

function showDemoBanner() {
  const banner = document.getElementById('alertBanner');
  banner.classList.remove('hidden');
  banner.innerHTML = `
    <div class="alert-inner warning-alert">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <div><strong>Demo Mode</strong> — No Google Apps Script URL configured. Showing sample data stored locally.
        <a href="#" onclick="openConfigModal();return false;" style="color:inherit;font-weight:600;margin-left:6px;">
          Click here to connect your Google Sheet →
        </a>
      </div>
    </div>`;
}

function showBanner(msg, type = 'error') {
  const banner = document.getElementById('alertBanner');
  if (!msg) { banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden');
  banner.innerHTML = `<div class="alert-inner ${type === 'warning' ? 'warning-alert' : ''}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
    <div>${msg}</div>
  </div>`;
}

// ─── STATS ──────────────────────────────────────────
function updateStats() {
  const today = new Date(); today.setHours(0,0,0,0);
  let urgent = 0, warning = 0, current = 0;

  allLicenses.forEach(r => {
    const exp = parseDate(r.expirationDate);
    if (!exp) return;
    const days = Math.ceil((exp - today) / 86400000);
    if (days < 0) { /* expired */ }
    else if (days <= 30) urgent++;
    else if (days <= 90) warning++;
    else current++;
  });

  document.getElementById('statTotal').textContent   = allLicenses.length;
  document.getElementById('statUrgent').textContent  = urgent;
  document.getElementById('statWarning').textContent = warning;
  document.getElementById('statCurrent').textContent = current;
}

function checkAlerts() {
  const today = new Date(); today.setHours(0,0,0,0);
  const urgent = allLicenses.filter(r => {
    const exp = parseDate(r.expirationDate);
    if (!exp) return false;
    const days = Math.ceil((exp - today) / 86400000);
    return days >= 0 && days <= 30;
  });

  if (urgent.length && scriptUrl) {
    showBanner(
      `⚠ <strong>${urgent.length} license${urgent.length > 1 ? 's' : ''}</strong> expiring within 30 days. ` +
      `Check the table below or run a manual email check.`,
      'error'
    );
  }
}

// ─── FILTERING & DISPLAY ─────────────────────────────
function setView(view) {
  currentView = view;
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.view === view);
  });
  const pf = document.getElementById('producerFilter').parentElement;
  pf.style.display = view === 'agency' ? 'none' : '';
  applyFilters();
}

function applyFilters() {
  const producer   = document.getElementById('producerFilter').value.toLowerCase();
  const state      = document.getElementById('stateFilter').value;
  const status     = document.getElementById('statusFilter').value;
  const search     = document.getElementById('searchInput').value.toLowerCase();
  const today      = new Date(); today.setHours(0,0,0,0);

  filtered = allLicenses.filter(r => {
    // View tab
    if (currentView === 'agency'    && r.recordType !== 'Agency')    return false;
    if (currentView === 'producers' && r.recordType !== 'Producer')  return false;

    // Producer filter
    if (producer) {
      const name = ((r.firstName || '') + ' ' + (r.lastName || '')).toLowerCase();
      if (!name.includes(producer)) return false;
    }

    // State filter
    if (state && r.licenseState !== state) return false;

    // Status filter
    if (status) {
      const exp = parseDate(r.expirationDate);
      const days = exp ? Math.ceil((exp - today) / 86400000) : null;
      if (status === 'urgent'  && !(days !== null && days >= 0 && days <= 30)) return false;
      if (status === 'warning' && !(days !== null && days > 30 && days <= 90)) return false;
      if (status === 'current' && !(days !== null && days > 90)) return false;
      if (status === 'expired' && !(days !== null && days < 0)) return false;
      if (status === 'pending' && r.licenseStatus !== 'Pending Renewal') return false;
    }

    // Search
    if (search) {
      const blob = [
        r.firstName, r.lastName, r.npn,
        r.licenseState, r.licenseNumber, r.linesOfAuthority
      ].join(' ').toLowerCase();
      if (!blob.includes(search)) return false;
    }

    return true;
  });

  renderTable();
  updateTableMeta();
}

function updateTableMeta() {
  const titles = { all: 'All Licenses', agency: 'Agency Licenses', producers: 'Producer Licenses' };
  document.getElementById('tableTitle').textContent = titles[currentView] || 'Licenses';
  document.getElementById('tableMeta').textContent  = `${filtered.length} record${filtered.length !== 1 ? 's' : ''}`;
}

function populateProducerFilter() {
  const sel = document.getElementById('producerFilter');
  const current = sel.value;
  sel.innerHTML = '<option value="">All</option>';
  const names = new Set();
  allLicenses.forEach(r => {
    if (r.recordType === 'Producer') {
      const name = (r.firstName + ' ' + r.lastName).trim();
      if (name) names.add(name);
    }
  });
  [...names].sort().forEach(n => {
    const o = document.createElement('option');
    o.value = n.toLowerCase();
    o.textContent = n;
    if (current === n.toLowerCase()) o.selected = true;
    sel.appendChild(o);
  });
}

// ─── RENDER TABLE ───────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('licenseTableBody');
  tbody.innerHTML = '';

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr class="no-data-row"><td colspan="9">No licenses match the current filters.</td></tr>`;
    return;
  }

  const today = new Date(); today.setHours(0,0,0,0);

  // Sort: soonest expiry first
  const sorted = [...filtered].sort((a, b) => {
    const da = parseDate(a.expirationDate), db = parseDate(b.expirationDate);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da - db;
  });

  sorted.forEach(r => {
    const exp  = parseDate(r.expirationDate);
    const days = exp ? Math.ceil((exp - today) / 86400000) : null;
    const urgClass = getUrgClass(days);
    const name = r.recordType === 'Agency'
      ? (r.lastName || 'Agency')
      : ((r.firstName || '') + ' ' + (r.lastName || '')).trim() || 'Unknown';
    const npn = r.npn;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="name-cell">
          <div class="name-main">${esc(name)}</div>
          ${npn ? `<div class="name-sub">NPN: ${esc(npn)}</div>` : ''}
        </div>
      </td>
      <td><span class="type-pill ${r.recordType === 'Agency' ? 'type-agency' : 'type-producer'}">${esc(r.recordType || 'Producer')}</span></td>
      <td>${esc(r.licenseState || '—')}</td>
      <td>${esc(r.licenseNumber || '—')}</td>
      <td>${esc(r.linesOfAuthority || '—')}</td>
      <td class="expiry-cell">
        ${exp ? formatDate(exp) : '—'}
        ${days !== null ? `<span class="expiry-days ${urgClass}">${daysLabel(days)}</span>` : ''}
      </td>
      <td>${licenseStatusBadge(r.licenseStatus, days)}</td>
      <td>${renewalStatusBadge(r.renewalStatus)}</td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm btn-secondary btn-icon" title="View details" onclick="openDetail('${esc(r.id)}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="btn btn-sm btn-secondary btn-icon" title="Edit" onclick="openEditModal('${esc(r.id)}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn btn-sm btn-danger btn-icon" title="Delete" onclick="deleteLicense('${esc(r.id)}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });
}

// ─── BADGES / HELPERS ───────────────────────────────
function getUrgClass(days) {
  if (days === null) return '';
  if (days < 0) return 'expired';
  if (days <= 30) return 'urgent';
  if (days <= 90) return 'warning';
  return 'good';
}

function daysLabel(days) {
  if (days < 0)  return `Expired ${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''} ago`;
  if (days === 0) return 'Expires today!';
  return `${days} day${days !== 1 ? 's' : ''} left`;
}

function licenseStatusBadge(status, days) {
  if (!status && days !== null) {
    if (days < 0) status = 'Expired';
    else if (days <= 30) status = 'Active';
    else status = 'Active';
  }
  const map = {
    'Active':           'badge-good',
    'Pending Renewal':  'badge-blue',
    'Inactive':         'badge-neutral',
    'Expired':          'badge-urgent',
  };
  const cls = map[status] || 'badge-neutral';
  return `<span class="badge ${cls}"><span class="dot dot-${cls.replace('badge-','')}"></span>${esc(status || '—')}</span>`;
}

function renewalStatusBadge(status) {
  if (!status) return '<span class="badge badge-neutral">—</span>';
  const map = {
    'Current':            'badge-good',
    'Pending CE':         'badge-warning',
    'Renewal Submitted':  'badge-blue',
    'Expired':            'badge-urgent',
  };
  return `<span class="badge ${map[status] || 'badge-neutral'}">${esc(status)}</span>`;
}

function setTableLoading(on) {
  if (on) {
    document.getElementById('licenseTableBody').innerHTML = `
      <tr class="loading-row">
        <td colspan="9"><div class="loading-spinner"></div><span>Loading…</span></td>
      </tr>`;
  }
}

// ─── DETAIL MODAL ────────────────────────────────────
function openDetail(id) {
  const r = allLicenses.find(x => x.id === id);
  if (!r) return;

  const today = new Date(); today.setHours(0,0,0,0);
  const exp   = parseDate(r.expirationDate);
  const days  = exp ? Math.ceil((exp - today) / 86400000) : null;
  const name  = r.recordType === 'Agency'
    ? (r.lastName || 'Agency')
    : ((r.firstName || '') + ' ' + (r.lastName || '')).trim();

  const ceReq  = parseFloat(r.ceRequired)   || 0;
  const ceComp = parseFloat(r.ceCompleted)  || 0;
  const cePct  = ceReq > 0 ? Math.min(100, Math.round(ceComp / ceReq * 100)) : 0;

  document.getElementById('detailTitle').textContent = name + ' — ' + (r.licenseState || 'License');

  document.getElementById('detailContent').innerHTML = `
    <div class="detail-grid">
      <div class="detail-section">
        <h3>${r.recordType === 'Agency' ? 'Agency Info' : 'Producer Info'}</h3>
        ${detailRow('Name', name)}
        ${detailRow('NPN', r.npn || '—')}
        ${r.recordType === 'Producer' ? detailRow('Resident State', r.residentState || '—') : ''}
        ${detailRow('Email', r.email || '—')}
        ${detailRow('Renewal Status', renewalStatusBadge(r.renewalStatus))}
      </div>
      <div class="detail-section">
        <h3>License Details</h3>
        ${detailRow('State', r.licenseState || '—')}
        ${detailRow('License #', r.licenseNumber || '—')}
        ${detailRow('Type', r.licenseType || '—')}
        ${detailRow('Lines', r.linesOfAuthority || '—')}
        ${detailRow('Expiration', exp ? formatDate(exp) : '—')}
        ${days !== null ? detailRow('Days Remaining', `<span class="expiry-days ${getUrgClass(days)}" style="display:inline">${daysLabel(days)}</span>`) : ''}
        ${detailRow('Status', licenseStatusBadge(r.licenseStatus, days))}
        ${detailRow('Last Renewed', r.dateLastRenewed || '—')}
      </div>
      ${r.recordType === 'Producer' ? `
      <div class="detail-section">
        <h3>CE Credits</h3>
        ${detailRow('Required', ceReq || '—')}
        ${detailRow('Completed', ceComp)}
        ${detailRow('Deadline', r.ceDeadline || '—')}
        ${ceReq > 0 ? `
        <div style="margin-top:10px;">
          <div style="font-size:.75rem;color:var(--gray-500);margin-bottom:4px;">${cePct}% complete</div>
          <div class="ce-bar-wrap"><div class="ce-bar" style="width:${cePct}%"></div></div>
        </div>` : ''}
      </div>
      <div class="detail-section">
        <h3>NIPR / Admin</h3>
        ${detailRow('Last NIPR Login', r.lastNiprLogin || '—')}
        ${r.notes ? detailRow('Notes', r.notes) : ''}
      </div>` : `
      <div class="detail-section" style="grid-column:1/-1;">
        <h3>Notes</h3>
        <p style="font-size:.875rem;color:var(--gray-700)">${esc(r.notes || 'No notes.')}</p>
      </div>`}
    </div>`;

  document.getElementById('detailEditBtn').onclick   = () => { closeDetailModal(); openEditModal(id); };
  document.getElementById('detailDeleteBtn').onclick = () => { closeDetailModal(); deleteLicense(id); };
  document.getElementById('detailModal').classList.remove('hidden');
}

function detailRow(label, value) {
  return `<div class="detail-row">
    <span class="detail-label">${label}</span>
    <span class="detail-value">${value}</span>
  </div>`;
}

function closeDetailModal()           { document.getElementById('detailModal').classList.add('hidden'); }
function closeDetailOnBackdrop(e)     { if (e.target === document.getElementById('detailModal')) closeDetailModal(); }

// ─── ADD / EDIT MODAL ────────────────────────────────
function openAddModal() {
  editingId = null;
  document.getElementById('modalTitle').textContent = 'Add License';
  document.getElementById('submitBtn').textContent  = 'Save License';
  document.getElementById('licenseForm').reset();
  toggleProducerFields();
  document.getElementById('modal').classList.remove('hidden');
}

function openEditModal(id) {
  const r = allLicenses.find(x => x.id === id);
  if (!r) return;
  editingId = id;
  document.getElementById('modalTitle').textContent = 'Edit License';
  document.getElementById('submitBtn').textContent  = 'Update License';

  const form = document.getElementById('licenseForm');
  form.reset();

  setField(form, 'recordType', r.recordType || 'Producer');
  toggleProducerFields();

  // Producer fields
  setField(form, 'firstName', r.firstName);
  setField(form, 'lastName',  r.lastName);
  setField(form, 'npn',       r.npn);
  setField(form, 'email',     r.email);
  setField(form, 'residentState', r.residentState);
  setField(form, 'ceRequired',  r.ceRequired);
  setField(form, 'ceCompleted', r.ceCompleted);
  setField(form, 'ceDeadline',  r.ceDeadline);
  setField(form, 'lastNiprLogin', r.lastNiprLogin);
  setField(form, 'renewalStatus', r.renewalStatus);
  // Agency fields — populated from the same unified columns
  setField(form, 'agencyName',  r.lastName);
  setField(form, 'agencyNpn',   r.npn);
  setField(form, 'agencyEmail', r.email);
  // License fields
  setField(form, 'licenseState',     r.licenseState);
  setField(form, 'licenseNumber',    r.licenseNumber);
  setField(form, 'licenseType',      r.licenseType || 'Resident');
  setField(form, 'linesOfAuthority', r.linesOfAuthority);
  setField(form, 'expirationDate',   r.expirationDate);
  setField(form, 'licenseStatus',    r.licenseStatus || 'Active');
  setField(form, 'dateLastRenewed',  r.dateLastRenewed);
  setField(form, 'notes',            r.notes);

  document.getElementById('modal').classList.remove('hidden');
}

function setField(form, name, value) {
  const el = form.elements[name];
  if (!el || value === undefined || value === null) return;
  if (el.nodeName) { el.value = value; return; } // single element
  for (const item of el) item.value = value;      // RadioNodeList — set all
}

// When two inputs share a name (e.g. residentState appears in both the
// producer and agency sections), form.elements returns a RadioNodeList.
// We pick the one that's actually visible.
function getFieldValue(form, name) {
  const el = form.elements[name];
  if (!el) return '';
  if (el.value !== undefined && el.nodeName) return el.value || ''; // single element
  // RadioNodeList — find the one whose closest section is visible
  for (const item of el) {
    const section = item.closest('#producerFields, #agencyFields');
    if (!section || !section.classList.contains('hidden')) return item.value || '';
  }
  return '';
}

function toggleProducerFields() {
  const type = document.getElementById('recordType').value;
  document.getElementById('producerFields').classList.toggle('hidden', type !== 'Producer');
  document.getElementById('agencyFields').classList.toggle('hidden',   type !== 'Agency');
}

function closeModal()           { document.getElementById('modal').classList.add('hidden'); }
function closeModalOnBackdrop(e) { if (e.target === document.getElementById('modal')) closeModal(); }

// ─── FORM SUBMIT ─────────────────────────────────────
async function handleFormSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const type = form.elements['recordType'].value;

  // For Agency records the "agencyName" input maps to lastName so all records
  // share the same columns in the sheet.
  const record = {
    id:          editingId || generateId(),
    recordType:  type,
    firstName:   type === 'Agency' ? '' : (form.elements['firstName']?.value || ''),
    lastName:    type === 'Agency'
                   ? (form.elements['agencyName']?.value || '')
                   : (form.elements['lastName']?.value   || ''),
    npn:         type === 'Agency'
                   ? (form.elements['agencyNpn']?.value   || '')
                   : (form.elements['npn']?.value         || ''),
    email:       type === 'Agency'
                   ? (form.elements['agencyEmail']?.value || '')
                   : (form.elements['email']?.value       || ''),
    residentState:  getFieldValue(form, 'residentState'),
    ceRequired:  type === 'Agency' ? '' : (form.elements['ceRequired']?.value  || ''),
    ceCompleted: type === 'Agency' ? '' : (form.elements['ceCompleted']?.value || ''),
    ceDeadline:  type === 'Agency' ? '' : (form.elements['ceDeadline']?.value  || ''),
    lastNiprLogin: type === 'Agency' ? '' : (form.elements['lastNiprLogin']?.value || ''),
    renewalStatus: form.elements['renewalStatus']?.value || 'Current',
    // License fields (shared)
    licenseState:     form.elements['licenseState'].value,
    licenseNumber:    form.elements['licenseNumber'].value,
    licenseType:      form.elements['licenseType'].value,
    linesOfAuthority: form.elements['linesOfAuthority'].value,
    expirationDate:   form.elements['expirationDate'].value,
    licenseStatus:    form.elements['licenseStatus'].value,
    dateLastRenewed:  form.elements['dateLastRenewed'].value,
    notes:            form.elements['notes'].value,
  };

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    if (scriptUrl) {
      const action = editingId ? 'updateLicense' : 'addLicense';
      const res = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action, secret: writeSecret, record }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
    } else {
      // Demo mode — save to localStorage
      if (editingId) {
        const idx = allLicenses.findIndex(x => x.id === editingId);
        if (idx !== -1) allLicenses[idx] = record;
      } else {
        allLicenses.push(record);
      }
      saveDemoData();
    }

    closeModal();
    showToast(editingId ? 'License updated!' : 'License added!', 'success');
    await loadData();
  } catch (err) {
    showToast('Error saving: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = editingId ? 'Update License' : 'Save License';
  }
}

// ─── DELETE ──────────────────────────────────────────
async function deleteLicense(id) {
  const r = allLicenses.find(x => x.id === id);
  if (!r) return;
  const name = r.recordType === 'Agency'
    ? (r.lastName || 'this agency license')
    : ((r.firstName || '') + ' ' + (r.lastName || '') + ' — ' + (r.licenseState || '')).trim();

  if (!confirm(`Delete license record for "${name}"?\n\nThis cannot be undone.`)) return;

  try {
    if (scriptUrl) {
      const res = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'deleteLicense', secret: writeSecret, id }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
    } else {
      allLicenses = allLicenses.filter(x => x.id !== id);
      saveDemoData();
    }
    showToast('License deleted.', 'success');
    await loadData();
  } catch (err) {
    showToast('Error deleting: ' + err.message, 'error');
  }
}

// ─── CONFIG MODAL ────────────────────────────────────
function openConfigModal() {
  document.getElementById('scriptUrlInput').value  = scriptUrl;
  document.getElementById('writeSecretInput').value = writeSecret;
  document.getElementById('configModal').classList.remove('hidden');
}
function closeConfigModal()            { document.getElementById('configModal').classList.add('hidden'); }
function closeConfigOnBackdrop(e)      { if (e.target === document.getElementById('configModal')) closeConfigModal(); }

function saveConfig() {
  const url    = document.getElementById('scriptUrlInput').value.trim();
  const secret = document.getElementById('writeSecretInput').value.trim();
  scriptUrl    = url;
  writeSecret  = secret;
  if (url)    localStorage.setItem(CONFIG_KEY, url);
  else        localStorage.removeItem(CONFIG_KEY);
  if (secret) localStorage.setItem(SECRET_KEY, secret);
  else        localStorage.removeItem(SECRET_KEY);
  closeConfigModal();
  loadData();
}

// ─── DEMO DATA ───────────────────────────────────────
function getDemoData() {
  const saved = localStorage.getItem(DEMO_KEY);
  if (saved) return JSON.parse(saved);
  return getDefaultDemoData();
}
function saveDemoData() { localStorage.setItem(DEMO_KEY, JSON.stringify(allLicenses)); }

function getDefaultDemoData() {
  const today = new Date();
  const daysFrom = d => {
    const dt = new Date(today);
    dt.setDate(dt.getDate() + d);
    return dt.toISOString().split('T')[0];
  };
  return [
    { id: 'demo-1', recordType: 'Producer', firstName: 'Jane', lastName: 'Smith', npn: '1234567890',
      email: 'jane@norwestagency.com', residentState: 'Florida', ceRequired: '24', ceCompleted: '18',
      ceDeadline: daysFrom(45), lastNiprLogin: daysFrom(-30), renewalStatus: 'Pending CE',
      licenseState: 'Florida', licenseNumber: 'FL-A-123456', licenseType: 'Resident',
      linesOfAuthority: 'P&C, Life', expirationDate: daysFrom(75), licenseStatus: 'Active',
      dateLastRenewed: daysFrom(-365), notes: 'Resident state license.' },
    { id: 'demo-2', recordType: 'Producer', firstName: 'Jane', lastName: 'Smith', npn: '1234567890',
      email: 'jane@norwestagency.com', residentState: 'Florida', ceRequired: '', ceCompleted: '',
      ceDeadline: '', lastNiprLogin: '', renewalStatus: 'Current',
      licenseState: 'Georgia', licenseNumber: 'GA-987654', licenseType: 'Non-Resident',
      linesOfAuthority: 'P&C', expirationDate: daysFrom(200), licenseStatus: 'Active',
      dateLastRenewed: '', notes: '' },
    { id: 'demo-3', recordType: 'Producer', firstName: 'Mike', lastName: 'Johnson', npn: '0987654321',
      email: 'mike@norwestagency.com', residentState: 'Florida', ceRequired: '24', ceCompleted: '6',
      ceDeadline: daysFrom(20), lastNiprLogin: '', renewalStatus: 'Pending CE',
      licenseState: 'Florida', licenseNumber: 'FL-B-654321', licenseType: 'Resident',
      linesOfAuthority: 'Life, Health', expirationDate: daysFrom(22), licenseStatus: 'Active',
      dateLastRenewed: daysFrom(-365), notes: 'Needs to complete CE urgently.' },
    { id: 'demo-4', recordType: 'Producer', firstName: 'Sarah', lastName: 'Lee', npn: '1122334455',
      email: 'sarah@norwestagency.com', residentState: 'Florida', ceRequired: '20', ceCompleted: '20',
      ceDeadline: daysFrom(-10), lastNiprLogin: daysFrom(-5), renewalStatus: 'Renewal Submitted',
      licenseState: 'Florida', licenseNumber: 'FL-C-111222', licenseType: 'Resident',
      linesOfAuthority: 'P&C, Life, Health', expirationDate: daysFrom(15), licenseStatus: 'Pending Renewal',
      dateLastRenewed: daysFrom(-365), notes: 'Renewal submitted, awaiting confirmation.' },
    { id: 'demo-5', recordType: 'Producer', firstName: 'Tom', lastName: 'Rivera', npn: '5566778899',
      email: 'tom@norwestagency.com', residentState: 'Florida', ceRequired: '24', ceCompleted: '24',
      ceDeadline: daysFrom(-20), lastNiprLogin: daysFrom(-2), renewalStatus: 'Current',
      licenseState: 'Florida', licenseNumber: 'FL-D-333444', licenseType: 'Resident',
      linesOfAuthority: 'P&C', expirationDate: daysFrom(180), licenseStatus: 'Active',
      dateLastRenewed: daysFrom(-180), notes: '' },
    { id: 'demo-6', recordType: 'Agency', firstName: '', lastName: 'Norwest Agency LLC',
      npn: 'AG-9900', email: 'admin@norwestagency.com', residentState: '', ceRequired: '',
      ceCompleted: '', ceDeadline: '', lastNiprLogin: '', renewalStatus: 'Current',
      licenseState: 'Florida', licenseNumber: 'FL-AGY-001', licenseType: 'Resident',
      linesOfAuthority: 'P&C, Life, Health', expirationDate: daysFrom(300), licenseStatus: 'Active',
      dateLastRenewed: daysFrom(-65), notes: 'Main agency license.' },
    { id: 'demo-7', recordType: 'Agency', firstName: '', lastName: 'Norwest Agency LLC',
      npn: 'AG-9900', email: 'admin@norwestagency.com', residentState: '', ceRequired: '',
      ceCompleted: '', ceDeadline: '', lastNiprLogin: '', renewalStatus: 'Current',
      licenseState: 'Georgia', licenseNumber: 'GA-AGY-002', licenseType: 'Non-Resident',
      linesOfAuthority: 'P&C', expirationDate: daysFrom(60), licenseStatus: 'Active',
      dateLastRenewed: daysFrom(-300), notes: '' },
  ];
}

// ─── UTILITIES ───────────────────────────────────────
function parseDate(str) {
  if (!str) return null;
  // Handle YYYY-MM-DD
  const d = new Date(str + 'T00:00:00');
  return isNaN(d) ? null : d;
}

function formatDate(d) {
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateId() {
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

// ─── TOAST ───────────────────────────────────────────
function createToastContainer() {
  const el = document.createElement('div');
  el.className = 'toast-container';
  el.id = 'toastContainer';
  document.body.appendChild(el);
}

function showToast(msg, type = '') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2500);
  setTimeout(() => t.remove(), 2900);
}
