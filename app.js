// ==========================================
// BACKEND PIPELINE & OFFLINE SYNC
// ==========================================
const GAS_URL = "https://script.google.com/macros/s/AKfycbyUsMas8XlX3UxLd7vwWRBVrfTxVbX2muZ7f244J53gS9x4JJfpfTfwaB5pScfj0FVY8g/exec"; 
const QUEUE_KEY = "stitchtrack_sync_queue";
                  
async function callApi(action, data = {}) {
  try {
    const response = await fetch(GAS_URL, { method: "POST", body: JSON.stringify({ action: action, data: data }) });
    const result = await response.json();
    
    if (action.startsWith('get')) {
      localStorage.setItem('stitchtrack_backup_' + action, JSON.stringify(result));
    }
    return result;
  } catch (err) { 
    console.warn("Network Error / Offline. Queuing request:", err);
    
    if (action.startsWith('get')) {
      const backup = localStorage.getItem('stitchtrack_backup_' + action);
      return backup ? JSON.parse(backup) : (action === 'getStats' ? {activeClients: '--', pendingOrders: '--', fittingReview: '--'} : []); 
    }

    if (action === 'uploadImage') {
      alert("Cannot upload photos while offline. Please try again when connected.");
      return null; 
    }

    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    queue.push({ action, data, timestamp: Date.now() });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    
    document.getElementById('sync-status').style.display = 'block';
    alert("Connection lost. Your data was saved locally and will sync automatically when you regain signal.");
    return { status: "queued" };
  }
}

window.addEventListener('online', async () => {
  document.getElementById('sync-status').style.display = 'none';
  const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  if (queue.length === 0) return;
  
  alert("Connection restored! Syncing offline records...");
  for (const item of queue) {
    await fetch(GAS_URL, { method: "POST", body: JSON.stringify({ action: item.action, data: item.data }) });
  }
  localStorage.removeItem(QUEUE_KEY);
  
  updateDashboardCounters();
  if (document.getElementById('view-customers').classList.contains('active-view')) refreshData('customers');
  if (document.getElementById('view-orders').classList.contains('active-view')) refreshData('orders');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.error('SW Failed:', err));
  });
}

// ==========================================
// UI NAVIGATION & DASHBOARD
// ==========================================
let cache = { customers: [], orders: [] };

function updateDashboardCounters() {
  callApi('getStats', {}).then(stats => {
    if (!stats || stats.status === "queued") return;
    document.getElementById('s-clients').innerText = stats.activeClients || '--';
    document.getElementById('s-pending').innerText = stats.pendingOrders || '--';
    document.getElementById('s-review').innerText = stats.fittingReview || '--';
  }).catch(err => console.error("Telemetry failure:", err));
}

function showPage(p) {
  // Swap views
  document.querySelectorAll('.page-view').forEach(v => v.classList.remove('active-view'));
  const target = document.getElementById('view-' + p);
  if (target) { target.classList.add('active-view'); window.scrollTo(0,0); }
  
  // Update Bottom Nav Active State
  document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
  const activeNav = document.getElementById('nav-' + p);
  if (activeNav) activeNav.classList.add('active');

  // Trigger logic
  if (p === 'dashboard') updateDashboardCounters(); 
  else if (p === 'reports') initInvoiceConsoleEngine();
  else refreshData(p);
}

// ==========================================
// DATA RENDERING (LISTS)
// ==========================================
function refreshData(p) {
  const idMap = { 'customers': 'customer-master-list', 'orders': 'order-master-list' };
  const listEl = document.getElementById(idMap[p]); if (!listEl) return;
  
  let apiCmd = p === 'customers' ? 'getCustomers' : 'getOrders';
  listEl.innerHTML = `<p style="text-align:center; padding:20px; font-size: 16px; font-weight:800; color:var(--muted);"><i class="fas fa-spinner fa-spin"></i> Reading atelier registers...</p>`;
  
  callApi(apiCmd, {}).then(data => {
    let displayData = data || [];
    if (p === 'customers') {
      cache.customers = displayData;
      listEl.innerHTML = displayData.map(c => `
        <div class="card" onclick="openRecordRow('customer', '${c.customerId}')" style="cursor:pointer; display:flex; align-items:center; gap:15px;">
          ${c.email ? `<img src="${getDirectImageUrl(c.email)}" class="gallery-img" style="width:60px; height:60px; border-radius:50%; border:2px solid var(--border);">` : `<div style="width:60px; height:60px; border-radius:50%; background:var(--card-light); border:2px solid var(--border); display:flex; align-items:center; justify-content:center; font-size:22px; color:var(--muted);"><i class="fas fa-user"></i></div>`}
          <div style="flex:1;">
            <strong style="color:var(--text);">${c.fullName}</strong><br>
            <span style="font-weight:600; color:var(--muted); font-size:16px !important;"><i class="fas fa-phone" style="font-size:14px;"></i> ${c.phone}</span>
          </div>
        </div>`).join('');
    } else {
      cache.orders = displayData;
      const filter = document.getElementById('order-status-filter').value;
      if (filter !== "ALL") displayData = displayData.filter(o => o.status === filter);
      
      if(displayData.length === 0) { listEl.innerHTML = `<p style="font-style:italic; color:var(--muted); text-align:center; padding:20px; font-size: 16px;">No clothing orders matching this status.</p>`; return;}
      
      listEl.innerHTML = displayData.map(o => {
        const clientObj = cache.customers.find(c => c.customerId === o.customerId) || { fullName: "Unlinked Profile" };
        const balance = Number(o.totalCost) - Number(o.amountPaid);
        return `
          <div class="card" onclick="openRecordRow('order', '${o.orderId}')" style="cursor:pointer; position:relative; overflow:hidden;">
            <div style="position:absolute; left:0; top:0; bottom:0; width:6px; background:${balance > 0 ? 'var(--danger)' : 'var(--success)'};"></div>
            <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:6px; gap:5px;">
              <div style="flex:1;"><strong>${clientObj.fullName}</strong><br><small style="font-family:monospace; font-size:16px !important; color:var(--muted);">#${o.orderId}</small></div>
              <span style="font-size:12px !important; background:var(--primary-light); color:var(--primary); padding:6px 10px; border-radius:8px; text-transform:uppercase; text-align:center;">${o.status}</span>
            </div>
            <div style="color:var(--text); margin-bottom:10px; font-size: 18px !important;">${o.designDescription}</div>
            <div style="display:grid; grid-template-columns:1fr 1fr; background:var(--card-light); padding:12px; border-radius:10px; font-size: 18px !important;">
              <div>Cost: ₦${Number(o.totalCost).toLocaleString()}</div>
              <div style="text-align:right; color:${balance > 0 ? 'var(--danger)':'var(--success)'};">Bal: ₦${balance.toLocaleString()}</div>
            </div>
          </div>`;
      }).join('');
    }
  });
}

function openRecordRow(type, id) {
  let match = null;
  if (type === 'customer') match = cache.customers.find(c => String(c.customerId) === String(id));
  if (type === 'order') match = cache.orders.find(o => String(o.orderId) === String(id));
  if (match) {
    openModal(type, match);
    if(type === 'customer') {
      setTimeout(() => {
        renderDynamicGarmentSketch(
          parseMeasurementInches(match.shoulder), parseMeasurementInches(match.chestBust), 
          parseMeasurementInches(match.underbust), parseMeasurementInches(match.waist), 
          parseMeasurementInches(match.hips), parseMeasurementInches(match.shirtLength), 
          parseMeasurementInches(match.trouserLength)
        );
      }, 200);
    }
  }
}

// ==========================================
// FORMS & DATA ENTRY
// ==========================================
function openModal(type, editData = null) {
  const body = document.getElementById('modalBody'); const submit = document.getElementById('modalSubmit');
  const title = document.getElementById('modalTitle'); const overlay = document.getElementById('modalOverlay');
  const isEdit = !!editData; overlay.style.display = 'flex'; body.innerHTML = ''; submit.disabled = false;

  if (type === 'customer') {
    const uniqueId = isEdit ? editData.customerId : "TLR-" + Math.random().toString(36).substr(2, 5).toUpperCase();
    title.innerText = isEdit ? "Update Client" : "Register Client";
    let clientProfilePhoto = isEdit ? editData.email : ""; 

    body.innerHTML = `
      <div style="position: relative; width: 90px; height: 90px; margin: 0 auto 20px auto;">
        <img id="p_avatar_view" src="${clientProfilePhoto ? getDirectImageUrl(clientProfilePhoto) : 'data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 width=%2280%22 height=%2280%22><circle cx=%2212%22 cy=%2212%22 r=%2212%22 fill=%22%23e9ecef%22/></svg>'}" class="profile-avatar">
        <label style="position: absolute; bottom: 0; right: 0; background: var(--primary); color: #fff; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; cursor: pointer; margin:0;"><i class="fas fa-camera"></i><input type="file" id="cam_avatar" accept="image/*" style="display:none"></label>
      </div>
      <div id="p_avatar_indicator" style="text-align:center; font-size:14px; font-weight:700; color:var(--success); margin-bottom:10px;"></div>

      <label>Full Name</label><input id="c_name" value="${isEdit?editData.fullName:''}">
      <label>Mobile Number</label><input id="c_phone" type="tel" value="${isEdit?editData.phone:''}">
      
      <div style="margin-top:20px; margin-bottom:10px; font-weight:800; font-size:16px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">I. Upper Body</div>
      <div class="measurement-grid">
        <div><label>Bust</label><input id="m_ch" type="text" value="${isEdit?editData.chestBust||'':''}"></div>
        <div><label>Under-Bust</label><input id="m_underbust" type="text" value="${isEdit?editData.underbust || '':''}"></div>
        <div><label>Across Chest</label><input id="m_ach" type="text" value="${isEdit?editData.acrossChest||'':''}"></div>
        <div><label>Across Back</label><input id="m_abk" type="text" value="${isEdit?editData.acrossBack||'':''}"></div>
        <div><label>Shoulder</label><input id="m_sh" type="text" value="${isEdit?editData.shoulder||'':''}"></div>
        <div><label>Neck</label><input id="m_neck" type="text" value="${isEdit?editData.neck||'':''}"></div>
        <div><label>Bicep</label><input id="m_bic" type="text" value="${isEdit?editData.bicep||'':''}"></div>
      </div>

      <div style="margin-top:20px; margin-bottom:10px; font-weight:800; font-size:16px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">II. Lower Body</div>
      <div class="measurement-grid">
        <div><label>Waist</label><input id="m_wst" type="text" value="${isEdit?editData.waist||'':''}"></div>
        <div><label>Low Waist</label><input id="m_lwst" type="text" value="${isEdit?editData.lowWaist||'':''}"></div>
        <div><label>Hips</label><input id="m_hip"
