// ==========================================
// BACKEND PIPELINE & OFFLINE SYNC
// ==========================================
const GAS_URL =
  "https://script.google.com/macros/s/AKfycbyUsMas8XlX3UxLd7vwWRBVrfTxVbX2muZ7f244J53gS9x4JJfpfTfwaB5pScfj0FVY8g/exec";
// Must match the "API_TOKEN" Script Property set in code.gs (Apps Script
// editor > Project Settings > Script Properties). If you haven't set one
// there yet, leave this blank — the backend fails open until you do.
const API_TOKEN =
  "Iy2eMquhcwKFBjlef4eqB3GjEVWn23wIurTcoM6R9VUfPE6ynhmJ6ryEQBm1sRaf";
const QUEUE_KEY = "stitchtrack_sync_queue";

async function callApi(action, data = {}) {
  try {
    const response = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({ action: action, token: API_TOKEN, data: data }),
    });
    const result = await response.json();

    if (action.startsWith("get")) {
      localStorage.setItem(
        "stitchtrack_backup_" +
          action +
          (data.orderId ? "_" + data.orderId : ""),
        JSON.stringify(result),
      );
    }
    return result;
  } catch (err) {
    console.warn("Network Error / Offline. Queuing request:", err);

    if (action.startsWith("get")) {
      const backup = localStorage.getItem(
        "stitchtrack_backup_" +
          action +
          (data.orderId ? "_" + data.orderId : ""),
      );
      if (backup) return JSON.parse(backup);
      if (action === "getStats")
        return {
          activeClients: "--",
          pendingOrders: "--",
          fittingReview: "--",
        };
      return [];
    }

    if (action === "uploadImage") {
      alert(
        "Cannot upload photos while offline. Please try again when connected.",
      );
      return null;
    }

    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    queue.push({ action, data, timestamp: Date.now() });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));

    setSyncStatus(
      "offline",
      "Offline — changes saved locally, will sync when back online",
    );
    alert(
      "Connection lost. Your data was saved locally and will sync automatically when you regain signal.",
    );
    return { status: "queued" };
  }
}

// ==========================================
// SYNC STATUS INDICATOR
// ==========================================
function setSyncStatus(state, message) {
  const el = document.getElementById("sync-status");
  if (!el) return;
  el.style.display = "flex";

  const styles = {
    syncing: { icon: "fa-sync-alt fa-spin", bg: "rgba(28,28,30,0.85)" },
    offline: { icon: "fa-triangle-exclamation", bg: "rgba(255,59,48,0.9)" },
    synced: { icon: "fa-check-circle", bg: "rgba(52,199,89,0.9)" },
  };
  const s = styles[state] || styles.syncing;
  el.style.background = s.bg;
  el.innerHTML = `<i class="fas ${s.icon}"></i> ${message}`;

  if (state === "synced") {
    setTimeout(() => {
      el.style.display = "none";
    }, 2200);
  }
}

async function syncOfflineQueue() {
  const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  if (queue.length === 0) return;
  for (const item of queue) {
    await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({
        action: item.action,
        token: API_TOKEN,
        data: item.data,
      }),
    });
  }
  localStorage.removeItem(QUEUE_KEY);
}

// ==========================================
// APP BOOT: CACHE-FIRST LOAD, THEN BACKGROUND SYNC
// ==========================================
function loadCachedSnapshot() {
  try {
    const statsRaw = localStorage.getItem("stitchtrack_backup_getStats");
    if (statsRaw) {
      const stats = JSON.parse(statsRaw);
      document.getElementById("s-clients").innerText =
        stats.activeClients ?? "--";
      document.getElementById("s-pending").innerText =
        stats.pendingOrders ?? "--";
      document.getElementById("s-review").innerText =
        stats.fittingReview ?? "--";
    }
  } catch (err) {
    /* no cached stats yet — first-ever launch */
  }

  try {
    const custRaw = localStorage.getItem("stitchtrack_backup_getCustomers");
    if (custRaw) cache.customers = JSON.parse(custRaw) || [];
  } catch (err) {}

  try {
    const ordRaw = localStorage.getItem("stitchtrack_backup_getOrders");
    if (ordRaw) cache.orders = JSON.parse(ordRaw) || [];
  } catch (err) {}

  if (
    document.getElementById("view-customers").classList.contains("active-view")
  )
    renderCustomerList();
  if (document.getElementById("view-orders").classList.contains("active-view"))
    renderOrderList();
}

async function initAppData() {
  loadCachedSnapshot();
  const hasCache = !!localStorage.getItem("stitchtrack_backup_getStats");
  setSyncStatus("syncing", hasCache ? "Syncing with server…" : "Loading…");

  try {
    await syncOfflineQueue();

    const [statsRes, customersRes, ordersRes] = await Promise.all([
      fetch(GAS_URL, {
        method: "POST",
        body: JSON.stringify({
          action: "getStats",
          token: API_TOKEN,
          data: {},
        }),
      }).then((r) => r.json()),
      fetch(GAS_URL, {
        method: "POST",
        body: JSON.stringify({
          action: "getCustomers",
          token: API_TOKEN,
          data: { includeArchived: showArchivedCustomers },
        }),
      }).then((r) => r.json()),
      fetch(GAS_URL, {
        method: "POST",
        body: JSON.stringify({
          action: "getOrders",
          token: API_TOKEN,
          data: { includeArchived: showArchivedOrders },
        }),
      }).then((r) => r.json()),
    ]);

    localStorage.setItem(
      "stitchtrack_backup_getStats",
      JSON.stringify(statsRes),
    );
    localStorage.setItem(
      "stitchtrack_backup_getCustomers",
      JSON.stringify(customersRes),
    );
    localStorage.setItem(
      "stitchtrack_backup_getOrders",
      JSON.stringify(ordersRes),
    );

    if (statsRes) {
      document.getElementById("s-clients").innerText =
        statsRes.activeClients ?? "--";
      document.getElementById("s-pending").innerText =
        statsRes.pendingOrders ?? "--";
      document.getElementById("s-review").innerText =
        statsRes.fittingReview ?? "--";
    }
    cache.customers = customersRes || [];
    cache.orders = ordersRes || [];
    if (
      document
        .getElementById("view-customers")
        .classList.contains("active-view")
    )
      renderCustomerList();
    if (
      document.getElementById("view-orders").classList.contains("active-view")
    )
      renderOrderList();

    setSyncStatus("synced", "Synced");
  } catch (err) {
    console.warn("Initial sync failed — staying on cached data:", err);
    setSyncStatus("offline", "Offline — showing cached data");
  }
}

window.addEventListener("online", () => initAppData());
window.addEventListener("offline", () =>
  setSyncStatus("offline", "Offline — showing cached data"),
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .catch((err) => console.error("SW Failed:", err));
  });
}

// ==========================================
// UI NAVIGATION & DASHBOARD
// ==========================================
let cache = { customers: [], orders: [] };
let customerSearchTerm = "";
let showArchivedCustomers = false;
let showArchivedOrders = false;
let currentModalType = null;
let currentModalId = null;
let currentModalArchived = false;
const PAGE_SIZE = 20;
let customerPage = 1;
let orderPage = 1;

function updateDashboardCounters() {
  callApi("getStats", {})
    .then((stats) => {
      if (!stats || stats.status === "queued") return;
      document.getElementById("s-clients").innerText =
        stats.activeClients || "--";
      document.getElementById("s-pending").innerText =
        stats.pendingOrders || "--";
      document.getElementById("s-review").innerText =
        stats.fittingReview || "--";
    })
    .catch((err) => console.error("Telemetry failure:", err));
}

function showPage(p) {
  document
    .querySelectorAll(".page-view")
    .forEach((v) => v.classList.remove("active-view"));
  const target = document.getElementById("view-" + p);
  if (target) {
    target.classList.add("active-view");
    window.scrollTo(0, 0);
  }

  document
    .querySelectorAll(".nav-item")
    .forEach((nav) => nav.classList.remove("active"));
  const activeNav = document.getElementById("nav-" + p);
  if (activeNav) activeNav.classList.add("active");

  if (p === "dashboard") updateDashboardCounters();
  else if (p === "reports") initInvoiceConsoleEngine();
  else refreshData(p);
}

// ==========================================
// DASHBOARD CARD SHORTCUTS
// ==========================================
function goToClients() {
  showPage("customers");
}
function goToActiveJobs() {
  document.getElementById("order-status-filter").value = "ALL";
  showPage("orders");
}
function goToFittingAlerts() {
  document.getElementById("order-status-filter").value = "Fitting / Review";
  showPage("orders");
}
function goToInvoices() {
  showPage("reports");
}

// ==========================================
// DATA RENDERING (LISTS)
// ==========================================
function refreshData(p) {
  const idMap = {
    customers: "customer-master-list",
    orders: "order-master-list",
  };
  const listEl = document.getElementById(idMap[p]);
  if (!listEl) return;

  let apiCmd = p === "customers" ? "getCustomers" : "getOrders";
  const includeArchived =
    p === "customers" ? showArchivedCustomers : showArchivedOrders;
  listEl.innerHTML = `<p style="text-align:center; padding:20px; font-size: 16px; font-weight:800; color:var(--muted);"><i class="fas fa-spinner fa-spin"></i> Reading atelier registers...</p>`;

  callApi(apiCmd, { includeArchived }).then((data) => {
    let displayData = data || [];
    if (p === "customers") {
      cache.customers = displayData;
      customerPage = 1;
      renderCustomerList();
    } else {
      cache.orders = displayData;
      orderPage = 1;
      renderOrderList();
    }
  });
}

function filterCustomerSearch(term) {
  customerSearchTerm = (term || "").toLowerCase().trim();
  customerPage = 1;
  renderCustomerList();
}

function toggleArchivedCustomers(checked) {
  showArchivedCustomers = checked;
  refreshData("customers");
}

function toggleArchivedOrders(checked) {
  showArchivedOrders = checked;
  refreshData("orders");
}

function onOrderStatusFilterChange() {
  orderPage = 1;
  renderOrderList();
}

function loadMoreCustomers() {
  customerPage++;
  renderCustomerList();
}

function loadMoreOrders() {
  orderPage++;
  renderOrderList();
}

function loadMoreFooter(totalCount, shownCount, onClickFn) {
  if (shownCount >= totalCount) return "";
  const remaining = totalCount - shownCount;
  return `
    <button class="action-btn" style="background:#fff; color:var(--primary); border:1px solid var(--border); box-shadow:none; margin-top:4px;" onclick="${onClickFn}()">
      Load More (${remaining} remaining)
    </button>`;
}

function renderCustomerList() {
  const listEl = document.getElementById("customer-master-list");
  if (!listEl) return;
  let displayData = cache.customers || [];
  if (customerSearchTerm) {
    displayData = displayData.filter(
      (c) =>
        String(c.fullName || "")
          .toLowerCase()
          .includes(customerSearchTerm) ||
        String(c.phone || "")
          .toLowerCase()
          .includes(customerSearchTerm),
    );
  }
  if (displayData.length === 0) {
    listEl.innerHTML = `<p style="font-style:italic; color:var(--muted); text-align:center; padding:20px; font-size: 16px;">No matching clients.</p>`;
    return;
  }

  const visibleCount = Math.min(customerPage * PAGE_SIZE, displayData.length);
  const pageData = displayData.slice(0, visibleCount);

  listEl.innerHTML =
    pageData
      .map((c) => {
        const isArchived = String(c.archived).toLowerCase() === "yes";
        return `
    <div class="card" onclick="openRecordRow('customer', '${c.customerId}')" style="cursor:pointer; display:flex; align-items:center; gap:15px; ${isArchived ? "opacity:0.5;" : ""}">
      ${c.photoUrl ? `<img src="${getDirectImageUrl(c.photoUrl)}" class="gallery-img" style="width:60px; height:60px; border-radius:50%; border:2px solid var(--border);">` : `<div style="width:60px; height:60px; border-radius:50%; background:var(--card-light); border:2px solid var(--border); display:flex; align-items:center; justify-content:center; font-size:22px; color:var(--muted);"><i class="fas fa-user"></i></div>`}
      <div style="flex:1;">
        <strong style="color:var(--text);">${c.fullName}</strong>${isArchived ? ' <span style="font-size:11px !important; font-weight:800 !important; background:var(--border); color:var(--muted); padding:3px 8px; border-radius:6px; text-transform:uppercase;">Archived</span>' : ""}<br>
        <span style="font-weight:600; color:var(--muted); font-size:16px !important;"><i class="fas fa-phone" style="font-size:14px;"></i> ${formatPhoneDisplay(c.phone)}</span>
      </div>
    </div>`;
      })
      .join("") +
    loadMoreFooter(displayData.length, visibleCount, "loadMoreCustomers");
}

function renderOrderList() {
  const listEl = document.getElementById("order-master-list");
  if (!listEl) return;
  let displayData = cache.orders || [];
  const filter = document.getElementById("order-status-filter").value;
  if (filter !== "ALL")
    displayData = displayData.filter((o) => o.status === filter);

  if (displayData.length === 0) {
    listEl.innerHTML = `<p style="font-style:italic; color:var(--muted); text-align:center; padding:20px; font-size: 16px;">No clothing orders matching this status.</p>`;
    return;
  }

  const visibleCount = Math.min(orderPage * PAGE_SIZE, displayData.length);
  const pageData = displayData.slice(0, visibleCount);

  listEl.innerHTML =
    pageData
      .map((o) => {
        const clientObj = cache.customers.find(
          (c) => c.customerId === o.customerId,
        ) || { fullName: "Unlinked Profile" };
        const balance = Number(o.totalCost) - Number(o.amountPaid);
        const isArchived = String(o.archived).toLowerCase() === "yes";
        return `
      <div class="card" onclick="openRecordRow('order', '${o.orderId}')" style="cursor:pointer; position:relative; overflow:hidden; ${isArchived ? "opacity:0.5;" : ""}">
        <div style="position:absolute; left:0; top:0; bottom:0; width:6px; background:${balance > 0 ? "var(--danger)" : "var(--success)"};"></div>
        <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:6px; gap:5px;">
          <div style="flex:1;"><strong>${clientObj.fullName}</strong><br><small style="font-family:monospace; font-size:16px !important; color:var(--muted);">#${o.orderId}</small></div>
          <span style="font-size:12px !important; background:var(--primary-light); color:var(--primary); padding:6px 10px; border-radius:8px; text-transform:uppercase; text-align:center;">${isArchived ? "Archived" : o.status}</span>
        </div>
        <div style="color:var(--text); margin-bottom:10px; font-size: 18px !important;">${o.designDescription}</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; background:var(--card-light); padding:12px; border-radius:10px; font-size: 18px !important;">
          <div>Cost: ₦${Number(o.totalCost).toLocaleString()}</div>
          <div style="text-align:right; color:${balance > 0 ? "var(--danger)" : "var(--success)"};">Bal: ₦${balance.toLocaleString()}</div>
        </div>
      </div>`;
      })
      .join("") +
    loadMoreFooter(displayData.length, visibleCount, "loadMoreOrders");
}

function openRecordRow(type, id) {
  let match = null;
  if (type === "customer")
    match = cache.customers.find((c) => String(c.customerId) === String(id));
  if (type === "order")
    match = cache.orders.find((o) => String(o.orderId) === String(id));
  if (match) {
    openModal(type, match);
    if (type === "customer") {
      setTimeout(() => {
        renderDynamicGarmentSketch(
          parseMeasurementInches(match.blouseShoulder),
          parseMeasurementInches(match.blouseBust),
          parseMeasurementInches(match.blouseUndercut),
          parseMeasurementInches(match.blouseWaist),
          parseMeasurementInches(match.skirtHip),
          parseMeasurementInches(match.blouseLength),
          parseMeasurementInches(match.gownFullLength),
        );
      }, 200);
    }
  }
}

// ==========================================
// FRACTIONAL-INCH MEASUREMENT INPUTS
// ==========================================
// ==========================================
// INTERNATIONAL PHONE NUMBERS
// Numbers are stored as full international format, e.g. "+2348031234567".
// Nigeria/UK use an 11-digit local format with a leading 0 that gets
// dropped when combined with the country code; the US uses a 10-digit
// local format with no leading 0.
// ==========================================
const PHONE_COUNTRIES = {
  NG: {
    code: "+234",
    flag: "🇳🇬",
    name: "Nigeria",
    digits: 11,
    stripLeadingZero: true,
    placeholder: "08031234567",
  },
  UK: {
    code: "+44",
    flag: "🇬🇧",
    name: "United Kingdom",
    digits: 11,
    stripLeadingZero: true,
    placeholder: "07911123456",
  },
  US: {
    code: "+1",
    flag: "🇺🇸",
    name: "United States",
    digits: 10,
    stripLeadingZero: false,
    placeholder: "2025551234",
  },
};

// Splits a stored "+234..." style number back into { country, local } for
// editing. Also handles legacy numbers saved before this feature existed
// (plain 11-digit Nigerian local numbers with no country code).
function parsePhoneForEdit(phone) {
  const p = String(phone || "").replace(/\s+/g, "");
  if (p.startsWith("+234")) return { country: "NG", local: "0" + p.slice(4) };
  if (p.startsWith("+44")) return { country: "UK", local: "0" + p.slice(3) };
  if (p.startsWith("+1")) return { country: "US", local: p.slice(2) };
  if (/^\d{11}$/.test(p)) return { country: "NG", local: p }; // legacy pre-country-code data
  return { country: "NG", local: p.replace(/\D/g, "") };
}

function formatPhoneDisplay(phone) {
  const p = String(phone || "");
  if (p.startsWith("+234")) return "+234 " + p.slice(4);
  if (p.startsWith("+44")) return "+44 " + p.slice(3);
  if (p.startsWith("+1")) return "+1 " + p.slice(2);
  return p;
}

function updatePhoneFieldForCountry() {
  const countrySel = document.getElementById("c_phone_country");
  const input = document.getElementById("c_phone");
  if (!countrySel || !input) return;
  const cfg = PHONE_COUNTRIES[countrySel.value];
  input.maxLength = cfg.digits;
  input.placeholder = cfg.placeholder;
  input.value = input.value.replace(/\D/g, "").slice(0, cfg.digits);
}

function sanitizePhoneInput() {
  const countrySel = document.getElementById("c_phone_country");
  const input = document.getElementById("c_phone");
  if (!countrySel || !input) return;
  const cfg = PHONE_COUNTRIES[countrySel.value];
  input.value = input.value.replace(/\D/g, "").slice(0, cfg.digits);
}

const FRACTION_OPTIONS = ["0", "1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8"];

// Splits a stored measurement string like "34 1/2" into { whole, frac }
function splitMeasurement(v) {
  if (!v && v !== 0) return { whole: "", frac: "0" };
  const str = String(v).trim();
  const m = str.match(/^(\d+)(?:\s+(\d\/\d))?/);
  if (!m) return { whole: "", frac: "0" };
  return { whole: m[1], frac: m[2] || "0" };
}

// Builds a whole-inch + fraction input pair for a given measurement field
function measurementField(id, label, value) {
  const { whole, frac } = splitMeasurement(value);
  const options = FRACTION_OPTIONS.map(
    (f) =>
      `<option value="${f}" ${f === frac ? "selected" : ""}>${f === "0" ? "0" : f}</option>`,
  ).join("");
  return `
    <div>
      <label>${label}</label>
      <div class="measure-pair">
        <input id="${id}_w" type="number" min="0" inputmode="numeric" placeholder="in" value="${whole}">
        <select id="${id}_f">${options}</select>
      </div>
    </div>`;
}

// Reads a measurement field pair back into a single stored string, e.g. "34 1/2" or "34"
function getMeasurementValue(id) {
  const wEl = document.getElementById(id + "_w");
  const fEl = document.getElementById(id + "_f");
  if (!wEl || !fEl) return "";
  const w = wEl.value.trim();
  const f = fEl.value;
  if (!w && f === "0") return "";
  const whole = w || "0";
  return f === "0" ? whole : `${whole} ${f}`;
}

// Converts a stored measurement string (whole or fractional) into a decimal number of inches
function parseMeasurementInches(v) {
  if (!v && v !== 0) return 0;
  const str = String(v).trim();
  if (!str) return 0;
  const parts = str.split(" ");
  let total = parseFloat(parts[0]) || 0;
  if (parts[1] && parts[1].includes("/")) {
    const [n, d] = parts[1].split("/").map(Number);
    if (d) total += n / d;
  }
  return total;
}

// ==========================================
// FORMS & DATA ENTRY
// ==========================================
function openModal(type, editData = null) {
  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  const archiveBtn = document.getElementById("modalArchive");
  const isEdit = !!editData;
  overlay.style.display = "flex";
  body.innerHTML = "";
  submit.disabled = false;
  submit.style.display = "";

  currentModalType = type;
  currentModalId = isEdit
    ? type === "customer"
      ? editData.customerId
      : editData.orderId
    : null;
  currentModalArchived = isEdit
    ? String(editData.archived).toLowerCase() === "yes"
    : false;
  if (archiveBtn) {
    if (isEdit) {
      archiveBtn.style.display = "block";
      archiveBtn.style.background = currentModalArchived
        ? "var(--success)"
        : "var(--danger)";
      archiveBtn.innerHTML = currentModalArchived
        ? '<i class="fas fa-box-open"></i> Restore Record'
        : '<i class="fas fa-box-archive"></i> Archive Record';
    } else {
      archiveBtn.style.display = "none";
    }
  }

  if (type === "customer") {
    // For an existing client we already know the ID. For a brand-new one,
    // the real sequential number is assigned atomically by the server at
    // save time — this tag exists only so photos uploaded before Save is
    // pressed get unique filenames; it's never sent to the backend.
    const photoUploadTag = isEdit
      ? editData.customerId
      : "new_" +
        Date.now().toString(36) +
        Math.random().toString(36).substr(2, 4);
    title.innerText = isEdit ? "Update Client" : "Register Client";
    let clientProfilePhoto = isEdit ? editData.photoUrl || "" : "";
    const parsedPhone = isEdit
      ? parsePhoneForEdit(editData.phone)
      : { country: "NG", local: "" };
    const phoneCfg = PHONE_COUNTRIES[parsedPhone.country];

    body.innerHTML = `
      <div style="position: relative; width: 90px; height: 90px; margin: 0 auto 12px auto;">
        <img id="p_avatar_view" src="${clientProfilePhoto ? getDirectImageUrl(clientProfilePhoto) : "data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 width=%2280%22 height=%2280%22><circle cx=%2212%22 cy=%2212%22 r=%2212%22 fill=%22%23e9ecef%22/></svg>"}" class="profile-avatar">
      </div>
      <div style="display:flex; gap:8px; justify-content:center; margin-bottom:10px;">
        <label style="background:var(--primary); color:#fff; padding:10px 16px; border-radius:12px; font-size:13px !important; font-weight:800; cursor:pointer; margin:0; display:flex; align-items:center; gap:6px;"><i class="fas fa-camera"></i> Take Photo<input type="file" id="cam_avatar_camera" accept="image/*" capture="environment" style="display:none"></label>
        <label style="background:#E5E5EA; color:#1C1C1E; padding:10px 16px; border-radius:12px; font-size:13px !important; font-weight:800; cursor:pointer; margin:0; display:flex; align-items:center; gap:6px;"><i class="fas fa-image"></i> Gallery<input type="file" id="cam_avatar_gallery" accept="image/*" style="display:none"></label>
      </div>
      <div id="p_avatar_indicator" style="text-align:center; font-size:14px; font-weight:700; color:var(--success); margin-bottom:10px;"></div>

      <label>Full Name <span style="color:var(--danger)">*</span></label><input id="c_name" value="${isEdit ? editData.fullName : ""}">
      <label>Mobile Number <span style="color:var(--danger)">*</span></label>
      <div class="measure-pair">
        <select id="c_phone_country" onchange="updatePhoneFieldForCountry()" style="flex:1.1; font-size:19.5px !important;">
          <option value="NG" ${parsedPhone.country === "NG" ? "selected" : ""}>🇳🇬 +234</option>
          <option value="UK" ${parsedPhone.country === "UK" ? "selected" : ""}>🇬🇧 +44</option>
          <option value="US" ${parsedPhone.country === "US" ? "selected" : ""}>🇺🇸 +1</option>
        </select>
        <input id="c_phone" type="tel" inputmode="numeric" style="flex:2; font-size:19.5px !important;" maxlength="${phoneCfg.digits}" placeholder="${phoneCfg.placeholder}" value="${parsedPhone.local}" oninput="sanitizePhoneInput()">
      </div>
      
      <div style="margin-top:20px; margin-bottom:10px; font-weight:800; font-size:16px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">I. Blouse <small style="text-transform:none; font-weight:600; letter-spacing:0; color:var(--muted);">(inches, whole + fraction)</small></div>
      <div class="measurement-grid">
        ${measurementField("m_bl_bust", "Bust", isEdit ? editData.blouseBust : "")}
        ${measurementField("m_bl_waist", "Waist", isEdit ? editData.blouseWaist : "")}
        ${measurementField("m_bl_hip", "Hip", isEdit ? editData.blouseHip : "")}
        ${measurementField("m_bl_shoulder", "Shoulder", isEdit ? editData.blouseShoulder : "")}
        ${measurementField("m_bl_undercut", "Undercut", isEdit ? editData.blouseUndercut : "")}
        ${measurementField("m_bl_np", "Nipple Point", isEdit ? editData.blouseNipplePoint : "")}
        ${measurementField("m_bl_nn", "Nipple-Nipple", isEdit ? editData.blouseNippleToNipple : "")}
        ${measurementField("m_bl_half", "Half Length", isEdit ? editData.blouseHalfLength : "")}
        ${measurementField("m_bl_len", "Blouse Length", isEdit ? editData.blouseLength : "")}
      </div>

      <div style="margin-top:20px; margin-bottom:10px; font-weight:800; font-size:16px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">II. Skirt</div>
      <div class="measurement-grid">
        ${measurementField("m_sk_waist", "Waist", isEdit ? editData.skirtWaist : "")}
        ${measurementField("m_sk_hip", "Hip", isEdit ? editData.skirtHip : "")}
        ${measurementField("m_sk_full", "Full Length", isEdit ? editData.skirtFullLength : "")}
        ${measurementField("m_sk_short", "Short Length", isEdit ? editData.skirtShortLength : "")}
        ${measurementField("m_sk_half", "Half Length", isEdit ? editData.skirtHalfLength : "")}
      </div>

      <div style="margin-top:20px; margin-bottom:10px; font-weight:800; font-size:16px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">III. Sleeve</div>
      <div class="measurement-grid">
        ${measurementField("m_sl_short", "Short", isEdit ? editData.sleeveShort : "")}
        ${measurementField("m_sl_34", "3/4", isEdit ? editData.sleeveThreeQuarter : "")}
        ${measurementField("m_sl_full", "Full Length", isEdit ? editData.sleeveFullLength : "")}
      </div>

      <div style="margin-top:20px; margin-bottom:10px; font-weight:800; font-size:16px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">IV. Gown</div>
      <div class="measurement-grid">
        ${measurementField("m_gw_full", "Full Length", isEdit ? editData.gownFullLength : "")}
        ${measurementField("m_gw_short", "Short", isEdit ? editData.gownShort : "")}
        ${measurementField("m_gw_34", "3/4", isEdit ? editData.gownThreeQuarter : "")}
        ${measurementField("m_gw_half", "Half Length", isEdit ? editData.gownHalfLength : "")}
      </div>

      <div style="margin-top:20px; margin-bottom:10px; font-weight:800; font-size:16px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">V. Sleeve Circumference</div>
      <div class="measurement-grid">
        ${measurementField("m_sc_short", "Short", isEdit ? editData.sleeveCircShort : "")}
        ${measurementField("m_sc_34", "3/4", isEdit ? editData.sleeveCircThreeQuarter : "")}
        ${measurementField("m_sc_wrist", "Wrist", isEdit ? editData.sleeveCircWrist : "")}
      </div>

      <label>Special Body Notes</label><textarea id="c_notes" rows="2">${isEdit ? editData.notes || "" : ""}</textarea>
      
      <div class="card" id="canvas-sketch-frame" style="margin-top: 15px; text-align: center; display:none; background:var(--card-light); border:none; box-shadow:none;">
        <span style="font-size:14px !important; font-weight:800; color:var(--primary); display:block; margin-bottom:10px; text-transform:uppercase; letter-spacing:1px;">Proportion Blueprint</span>
        <canvas id="studioSketchCanvas" width="300" height="480" style="background:#fff; border-radius:12px; max-width:100%; border:1px solid var(--border);"></canvas>
      </div>
    `;

    const handleAvatarFile = (file) => {
      if (!file) return;
      const r = new FileReader();
      r.onload = async (evt) => {
        const comp = await compressImageToTargetLimit(evt.target.result);
        document.getElementById("p_avatar_indicator").innerText =
          "UPLOADING...";
        callApi("uploadImage", {
          base64: comp,
          name: "avatar_" + photoUploadTag + ".jpg",
        }).then((res) => {
          if (res && res.url) {
            clientProfilePhoto = res.url;
            document.getElementById("p_avatar_view").src = getDirectImageUrl(
              res.url,
            );
            document.getElementById("p_avatar_indicator").innerText =
              "✅ UPLOADED";
          }
        });
      };
      r.readAsDataURL(file);
    };
    document.getElementById("cam_avatar_camera").onchange = (e) =>
      handleAvatarFile(e.target.files[0]);
    document.getElementById("cam_avatar_gallery").onchange = (e) =>
      handleAvatarFile(e.target.files[0]);

    if (isEdit) {
      setTimeout(
        () =>
          renderDynamicGarmentSketch(
            parseMeasurementInches(editData.blouseShoulder),
            parseMeasurementInches(editData.blouseBust),
            parseMeasurementInches(editData.blouseUndercut),
            parseMeasurementInches(editData.blouseWaist),
            parseMeasurementInches(editData.skirtHip),
            parseMeasurementInches(editData.blouseLength),
            parseMeasurementInches(editData.gownFullLength),
          ),
        150,
      );
    }

    submit.onclick = () => {
      const fullName = document.getElementById("c_name").value.trim();
      const countryKey = document.getElementById("c_phone_country").value;
      const cfg = PHONE_COUNTRIES[countryKey];
      const localDigits = document.getElementById("c_phone").value.trim();
      if (!fullName || !localDigits) {
        alert("Full Name and Mobile Number are required.");
        return;
      }
      if (!new RegExp(`^\\d{${cfg.digits}}$`).test(localDigits)) {
        alert(
          `${cfg.name} numbers must be exactly ${cfg.digits} digits (e.g. ${cfg.placeholder}).`,
        );
        return;
      }
      if (cfg.stripLeadingZero && localDigits[0] !== "0") {
        alert(
          `${cfg.name} numbers should start with 0 (e.g. ${cfg.placeholder}).`,
        );
        return;
      }
      const nationalNumber = cfg.stripLeadingZero
        ? localDigits.slice(1)
        : localDigits;
      const phone = cfg.code + nationalNumber; // e.g. +2348031234567

      submit.disabled = true;
      const payload = {
        fullName: fullName,
        phone: phone,
        photoUrl: clientProfilePhoto,

        blouseBust: getMeasurementValue("m_bl_bust"),
        blouseWaist: getMeasurementValue("m_bl_waist"),
        blouseHip: getMeasurementValue("m_bl_hip"),
        blouseShoulder: getMeasurementValue("m_bl_shoulder"),
        blouseUndercut: getMeasurementValue("m_bl_undercut"),
        blouseNipplePoint: getMeasurementValue("m_bl_np"),
        blouseNippleToNipple: getMeasurementValue("m_bl_nn"),
        blouseHalfLength: getMeasurementValue("m_bl_half"),
        blouseLength: getMeasurementValue("m_bl_len"),

        skirtWaist: getMeasurementValue("m_sk_waist"),
        skirtHip: getMeasurementValue("m_sk_hip"),
        skirtFullLength: getMeasurementValue("m_sk_full"),
        skirtShortLength: getMeasurementValue("m_sk_short"),
        skirtHalfLength: getMeasurementValue("m_sk_half"),

        sleeveShort: getMeasurementValue("m_sl_short"),
        sleeveThreeQuarter: getMeasurementValue("m_sl_34"),
        sleeveFullLength: getMeasurementValue("m_sl_full"),

        gownFullLength: getMeasurementValue("m_gw_full"),
        gownShort: getMeasurementValue("m_gw_short"),
        gownThreeQuarter: getMeasurementValue("m_gw_34"),
        gownHalfLength: getMeasurementValue("m_gw_half"),

        sleeveCircShort: getMeasurementValue("m_sc_short"),
        sleeveCircThreeQuarter: getMeasurementValue("m_sc_34"),
        sleeveCircWrist: getMeasurementValue("m_sc_wrist"),

        notes: document.getElementById("c_notes").value,
      };
      if (isEdit) payload.customerId = editData.customerId;

      callApi(isEdit ? "updateCustomer" : "saveCustomer", payload).then(
        (res) => {
          if (res && res.status === "queued") {
            closeModal();
            refreshData("customers");
            return;
          }
          if (!res || res.success === false) {
            alert(
              "Could not save client: " +
                (res && res.error ? res.error : "Unknown error"),
            );
            submit.disabled = false;
            return;
          }
          if (!isEdit && res.customerId) {
            showToast(
              `<i class="fas fa-check-circle" style="color:var(--success)"></i> Client #${res.customerId} registered`,
            );
          }
          closeModal();
          refreshData("customers");
        },
      );
    };
  } else if (type === "order") {
    const uniqueId = isEdit
      ? editData.orderId
      : "ORD-" + Date.now().toString(36).toUpperCase();
    title.innerText = isEdit
      ? `Modify Order #${uniqueId}`
      : `Create Order #${uniqueId}`;

    let designPhotosArray =
      isEdit && editData.designPhotos
        ? editData.designPhotos.split(",").filter(Boolean)
        : [];
    let finishedPhotosArray =
      isEdit && editData.finishedPhotos
        ? editData.finishedPhotos.split(",").filter(Boolean)
        : [];

    body.innerHTML = `
      <label>Select Client <span style="color:var(--danger)">*</span></label><select id="o_cust" ${isEdit ? "disabled" : ""}></select>
      <label>Design Description <span style="color:var(--danger)">*</span></label><input id="o_desc" value="${isEdit ? editData.designDescription : ""}">
      <label>Fabric Details</label><input id="o_fabric" value="${isEdit ? editData.fabricNotes || "" : ""}">
      
      <label>Total Price (₦) <span style="color:var(--danger)">*</span></label><input id="o_cost" type="number" value="${isEdit ? editData.totalCost : ""}">
      
      ${!isEdit ? `<label>Initial Deposit (₦)</label><input id="o_paid" type="number" value="0">` : ""}
      
      <label>Target Delivery Date</label><input id="o_due" type="date" value="${isEdit ? fromSheetDate(editData.dateDue) : ""}">
      
      <label>Production Status</label>
      <select id="o_status">
        <option value="Measurements Taken">Measurements Taken</option>
        <option value="Cutting Phase">Cutting Phase</option>
        <option value="Sewing Construction">Sewing Construction</option>
        <option value="Fitting / Review">Fitting / Review</option>
        <option value="Completed Ready">Completed Ready</option>
        <option value="Delivered">Delivered & Handed Over</option>
      </select>
      
      <label>Styling Remarks</label><textarea id="o_notes" rows="2">${isEdit ? editData.notes || "" : ""}</textarea>
      
      <div class="photo-strip">
        <div class="photo-box">
          <span style="font-size:12px !important; font-weight:800; color:var(--primary); text-transform:uppercase; display:block; margin-bottom:8px;">Style Photos</span>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <label style="background:var(--primary); color:#fff; padding:8px; border-radius:10px; display:flex; align-items:center; justify-content:center; gap:6px; font-size:13px !important; font-weight:800; cursor:pointer; margin:0;"><i class="fas fa-camera"></i> Camera<input type="file" id="cam_design_camera" accept="image/*" capture="environment" style="display:none"></label>
            <label style="background:#FFF; border:1px solid var(--border); padding:8px; border-radius:10px; display:flex; align-items:center; justify-content:center; gap:6px; font-size:13px !important; cursor:pointer; margin:0;"><i class="fas fa-image"></i> Gallery<input type="file" id="cam_design_gallery" accept="image/*" multiple style="display:none"></label>
          </div>
          <div id="p_design_indicator" class="gallery-preview"></div>
        </div>
        <div class="photo-box">
          <span style="font-size:12px !important; font-weight:800; color:var(--success); text-transform:uppercase; display:block; margin-bottom:8px;">Finished QC</span>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <label style="background:var(--success); color:#fff; padding:8px; border-radius:10px; display:flex; align-items:center; justify-content:center; gap:6px; font-size:13px !important; font-weight:800; cursor:pointer; margin:0;"><i class="fas fa-camera"></i> Camera<input type="file" id="cam_finished_camera" accept="image/*" capture="environment" style="display:none"></label>
            <label style="background:#FFF; border:1px solid var(--border); padding:8px; border-radius:10px; display:flex; align-items:center; justify-content:center; gap:6px; font-size:13px !important; cursor:pointer; margin:0;"><i class="fas fa-image"></i> Gallery<input type="file" id="cam_finished_gallery" accept="image/*" multiple style="display:none"></label>
          </div>
          <div id="p_finished_indicator" class="gallery-preview"></div>
        </div>
      </div>

      ${
        isEdit
          ? `
      <div class="card" id="payments-section" style="margin-top:15px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <strong style="text-transform:uppercase; font-size:14px; letter-spacing:0.5px;"><i class="fas fa-receipt"></i> Staged Payments</strong>
          <span id="pay-balance-badge" style="font-weight:800; font-size:14px;">--</span>
        </div>
        <div id="payments-list"><p style="font-size:13px; color:var(--muted);">Loading...</p></div>
        <div style="display:flex; gap:8px; margin-top:12px;">
          <input id="pay_amount" type="number" placeholder="Amount (₦)" style="flex:1.4;">
          <select id="pay_method" style="flex:1;">
            <option>Cash</option><option>Transfer</option><option>POS</option><option>Other</option>
          </select>
          <button type="button" class="action-btn" style="width:auto; padding:0 16px; font-size:14px !important;" onclick="recordStagedPayment('${uniqueId}')"><i class="fas fa-plus"></i></button>
        </div>
      </div>`
          : ""
      }
    `;

    const cSel = document.getElementById("o_cust");
    const fillSelector = () => {
      (cache.customers || []).forEach((c) => {
        const o = document.createElement("option");
        o.value = c.customerId;
        o.innerText = c.fullName;
        if (isEdit && c.customerId === editData.customerId) o.selected = true;
        cSel.appendChild(o);
      });
    };
    if (cache.customers.length === 0) {
      callApi("getCustomers", {}).then((res) => {
        cache.customers = res || [];
        fillSelector();
      });
    } else {
      fillSelector();
    }

    if (isEdit) {
      document.getElementById("o_status").value = editData.status;
      renderImageThumbnailsInline("p_design_indicator", designPhotosArray);
      renderImageThumbnailsInline("p_finished_indicator", finishedPhotosArray);
      renderPaymentsSection(uniqueId, editData.totalCost);
    }

    document.getElementById("cam_design_camera").onchange = (e) =>
      handleBatchImageUpload(
        e.target.files,
        uniqueId,
        "design",
        (url) => {
          designPhotosArray.push(url);
          renderImageThumbnailsInline("p_design_indicator", designPhotosArray);
        },
        "p_design_indicator",
      );
    document.getElementById("cam_design_gallery").onchange = (e) =>
      handleBatchImageUpload(
        e.target.files,
        uniqueId,
        "design",
        (url) => {
          designPhotosArray.push(url);
          renderImageThumbnailsInline("p_design_indicator", designPhotosArray);
        },
        "p_design_indicator",
      );
    document.getElementById("cam_finished_camera").onchange = (e) =>
      handleBatchImageUpload(
        e.target.files,
        uniqueId,
        "finished",
        (url) => {
          finishedPhotosArray.push(url);
          renderImageThumbnailsInline(
            "p_finished_indicator",
            finishedPhotosArray,
          );
        },
        "p_finished_indicator",
      );
    document.getElementById("cam_finished_gallery").onchange = (e) =>
      handleBatchImageUpload(
        e.target.files,
        uniqueId,
        "finished",
        (url) => {
          finishedPhotosArray.push(url);
          renderImageThumbnailsInline(
            "p_finished_indicator",
            finishedPhotosArray,
          );
        },
        "p_finished_indicator",
      );

    submit.onclick = () => {
      const cost = parseFloat(document.getElementById("o_cost").value);
      const desc = document.getElementById("o_desc").value.trim();
      const custId = isEdit ? editData.customerId : cSel.value;
      if (!custId) {
        alert("Please select a client.");
        return;
      }
      if (!desc) {
        alert("Please enter a design description.");
        return;
      }
      if (isNaN(cost) || cost < 0) {
        alert("Please enter a valid Total Price.");
        return;
      }
      const deposit = !isEdit
        ? parseFloat(document.getElementById("o_paid").value) || 0
        : Number(editData.amountPaid) || 0;

      submit.disabled = true;
      const payload = {
        orderId: uniqueId,
        customerId: custId,
        designDescription: desc,
        fabricNotes: document.getElementById("o_fabric").value,
        totalCost: cost,
        amountPaid: deposit,
        dateDue: toSheetDate(document.getElementById("o_due").value),
        status: document.getElementById("o_status").value,
        notes: document.getElementById("o_notes").value,
        designPhotos: designPhotosArray.join(","),
        finishedPhotos: finishedPhotosArray.join(","),
      };
      callApi(isEdit ? "updateOrder" : "saveOrder", payload).then(
        async (res) => {
          if (
            res &&
            res.status !== "queued" &&
            (!res || res.success === false)
          ) {
            alert(
              "Could not save order: " +
                (res && res.error ? res.error : "Unknown error"),
            );
            submit.disabled = false;
            return;
          }
          if (!isEdit && deposit > 0) {
            await callApi("addPayment", {
              orderId: uniqueId,
              amount: deposit,
              method: "Deposit",
              date: new Date().toLocaleDateString("en-GB"),
            });
          }
          closeModal();
          refreshData("orders");
        },
      );
    };
  }
}

// ==========================================
// STAGED PAYMENTS
// ==========================================
async function renderPaymentsSection(orderId, totalCost) {
  const listEl = document.getElementById("payments-list");
  const badge = document.getElementById("pay-balance-badge");
  if (!listEl) return;

  const payments = (await callApi("getPayments", { orderId })) || [];
  const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const balance = Number(totalCost) - paid;

  listEl.innerHTML =
    payments.length === 0
      ? '<p style="font-size:13px; color:var(--muted);">No payments recorded yet.</p>'
      : payments
          .map(
            (p) => `
        <div class="pay-row">
          <span>${p.date || ""} · ${p.method || "Cash"}${p.notes ? " · " + p.notes : ""}</span>
          <span style="font-weight:800;">₦${Number(p.amount).toLocaleString()}</span>
        </div>`,
          )
          .join("");

  if (badge) {
    badge.innerText = `Paid ₦${paid.toLocaleString()} · Bal ₦${balance.toLocaleString()}`;
    badge.style.color = balance > 0 ? "var(--danger)" : "var(--success)";
  }
  return { payments, paid, balance };
}

async function recordStagedPayment(orderId) {
  const amtEl = document.getElementById("pay_amount");
  const amt = parseFloat(amtEl.value);
  if (!amt || amt <= 0) {
    alert("Enter a valid payment amount.");
    return;
  }
  const method = document.getElementById("pay_method").value;

  const res = await callApi("addPayment", {
    orderId,
    amount: amt,
    method,
    date: new Date().toLocaleDateString("en-GB"),
  });
  if (res && res.status !== "queued" && res.success === false) {
    alert("Could not record payment: " + (res.error || "Unknown error"));
    return;
  }
  amtEl.value = "";

  const order = cache.orders.find((o) => o.orderId === orderId);
  await renderPaymentsSection(orderId, order ? order.totalCost : 0);
  refreshData("orders");
  updateDashboardCounters();
}

// ==========================================
// UTILS & HELPERS
// ==========================================
function showToast(message, duration = 2500) {
  const existing = document.getElementById("app-toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.id = "app-toast";
  toast.style.cssText =
    "position:fixed; bottom:100px; left:50%; transform:translateX(-50%); background:#212529; color:#fff; padding:12px 22px; border-radius:50px; font-weight:800; font-size:14px; z-index:99999; box-shadow:0 8px 20px rgba(0,0,0,0.25); display:flex; align-items:center; gap:8px; white-space:nowrap;";
  toast.innerHTML = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    if (document.getElementById("app-toast")) toast.remove();
  }, duration);
}

function closeModal() {
  document.getElementById("modalOverlay").style.display = "none";
  updateDashboardCounters();
}

function toggleArchiveCurrentRecord() {
  if (!currentModalType || !currentModalId) return;
  const willArchive = !currentModalArchived;
  const confirmMsg = willArchive
    ? "Archive this record? It's hidden from the main list but not deleted, and can be restored anytime."
    : "Restore this record to the active list?";
  if (!confirm(confirmMsg)) return;

  const action =
    currentModalType === "customer" ? "archiveCustomer" : "archiveOrder";
  const payload =
    currentModalType === "customer"
      ? { customerId: currentModalId, archived: willArchive }
      : { orderId: currentModalId, archived: willArchive };

  callApi(action, payload).then((res) => {
    if (res && res.status !== "queued" && res.success === false) {
      alert(
        "Could not update archive status: " + (res.error || "Unknown error"),
      );
      return;
    }
    closeModal();
    refreshData(currentModalType === "customer" ? "customers" : "orders");
  });
}

function toSheetDate(dStr) {
  if (!dStr) return "";
  return new Date(dStr).toLocaleDateString("en-GB");
}
function fromSheetDate(dStr) {
  if (!dStr || !dStr.includes("/")) return "";
  const [d, m, y] = dStr.split("/");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function getDirectImageUrl(url) {
  if (!url) return url;
  if (url.includes("action=image")) return url; // already our token-gated proxy link
  if (!url.includes("drive.google.com")) return url;
  const id =
    url.split("/d/")[1]?.split("/")[0] || url.split("id=")[1]?.split("&")[0];
  return `https://drive.google.com/thumbnail?id=${id}&sz=w800`;
}

function renderImageThumbnailsInline(id, arr) {
  const b = document.getElementById(id);
  if (!b) return;
  b.innerHTML =
    arr.length === 0
      ? '<span style="font-size:12px; color:#999;">No Photos</span>'
      : arr
          .map((u) => `<img src="${getDirectImageUrl(u)}" class="gallery-img">`)
          .join("");
}

function handleBatchImageUpload(
  filesList,
  trackingId,
  prefix,
  cb,
  indicatorId,
) {
  if (!filesList || filesList.length === 0) return;
  const files = Array.from(filesList);
  const total = files.length;
  let completed = 0;

  let progressEl = null;
  const indicatorEl = indicatorId ? document.getElementById(indicatorId) : null;
  if (indicatorEl && indicatorEl.parentElement) {
    progressEl = document.createElement("div");
    progressEl.style.cssText =
      "width:100%; font-size:12px !important; font-weight:800 !important; color:var(--primary); text-align:center; padding:6px 0;";
    progressEl.innerText = `Uploading 0/${total}...`;
    indicatorEl.parentElement.insertBefore(progressEl, indicatorEl);
  }
  const markProgress = () => {
    completed++;
    if (progressEl) {
      if (completed < total) {
        progressEl.innerText = `Uploading ${completed}/${total}...`;
      } else {
        progressEl.innerHTML = `<i class="fas fa-check-circle" style="color:var(--success)"></i> ${total} photo${total > 1 ? "s" : ""} uploaded`;
        setTimeout(() => progressEl.remove(), 1800);
      }
    }
  };

  files.forEach((file, i) => {
    const r = new FileReader();
    r.onload = async (e) => {
      const comp = await compressImageToTargetLimit(e.target.result);
      callApi("uploadImage", {
        base64: comp,
        name: `${prefix}_${trackingId}_${i}_${Date.now()}.jpg`,
      })
        .then((res) => {
          if (res?.url) cb(res.url);
          markProgress();
        })
        .catch(markProgress);
    };
    r.readAsDataURL(file);
  });
}

function compressImageToTargetLimit(b64) {
  return new Promise((res) => {
    const img = new Image();
    img.src = b64;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width;
      let h = img.height;
      if (w > h) {
        if (w > 800) {
          h *= 800 / w;
          w = 800;
        }
      } else {
        if (h > 800) {
          w *= 800 / h;
          h = 800;
        }
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      res(canvas.toDataURL("image/jpeg", 0.6));
    };
  });
}

function renderDynamicGarmentSketch(sh, bst, ubst, wst, hp, sl, tl) {
  const canvas = document.getElementById("studioSketchCanvas");
  if (!canvas) return;
  const frame = document.getElementById("canvas-sketch-frame");
  if (frame) frame.style.display = "block";
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2;
  const fX = 4.0;
  const [hSh, hBst, hWst, hHp] = [
    ((sh || 15) * fX) / 2,
    ((bst || 34) * fX) / 2.4,
    ((wst || 26) * fX) / 2.4,
    ((hp || 38) * fX) / 2.4,
  ];
  const y = { n: 40, s: 52, b: 92, w: 147, h: 192, hem: 252 };
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 15, y.n);
  ctx.lineTo(cx - hSh, y.s);
  ctx.lineTo(cx - hBst, y.b);
  ctx.lineTo(cx - hWst, y.w);
  ctx.lineTo(cx - hHp, y.h);
  ctx.lineTo(cx, y.hem);
  ctx.moveTo(cx + 15, y.n);
  ctx.lineTo(cx + hSh, y.s);
  ctx.lineTo(cx + hBst, y.b);
  ctx.lineTo(cx + hWst, y.w);
  ctx.lineTo(cx + hHp, y.h);
  ctx.lineTo(cx, y.hem);
  ctx.stroke();
}

// ==========================================
// INVOICE & SHARING ENGINE
// ==========================================
window.onload = () => initAppData();

function initInvoiceConsoleEngine() {
  callApi("getCustomers", {}).then((c) => {
    cache.customers = c || [];
    callApi("getOrders", {}).then((o) => {
      cache.orders = o || [];
      const oSel = document.getElementById("rep-order-sel");
      if (oSel) {
        oSel.innerHTML =
          '<option value="">-- Choose Client Order --</option>' +
          cache.orders
            .map((i) => {
              const client = cache.customers.find(
                (cx) => cx.customerId === i.customerId,
              ) || { fullName: "Unknown" };
              return `<option value="${i.orderId}">#${i.orderId} - ${client.fullName}</option>`;
            })
            .join("");
      }
      const previewCard = document.getElementById(
        "report-onscreen-preview-card",
      );
      if (previewCard) previewCard.style.display = "none";
    });
  });
}

async function compileStudioInvoice() {
  const orderId = document.getElementById("rep-order-sel").value;
  if (!orderId) return;
  const orderItem = cache.orders.find((o) => o.orderId === orderId);
  const clientItem = cache.customers.find(
    (c) => c.customerId === orderItem.customerId,
  );
  const balance = Number(orderItem.totalCost) - Number(orderItem.amountPaid);

  const designThumbs = orderItem.designPhotos
    ? orderItem.designPhotos
        .split(",")
        .filter(Boolean)
        .map((u) => `<img src="${getDirectImageUrl(u)}" class="report-thumb">`)
        .join("")
    : "";

  const payments = (await callApi("getPayments", { orderId })) || [];
  const paymentsRows =
    payments.length === 0
      ? `<tr><td colspan="3" style="text-align:center; color:#666;">No payments recorded</td></tr>`
      : payments
          .map(
            (p) =>
              `<tr><td>${p.date || ""}</td><td>${p.method || "Cash"}</td><td>₦${Number(p.amount).toLocaleString()}</td></tr>`,
          )
          .join("");

  let html = `
    <div style="display:flex; justify-content:space-between; border-bottom:3px solid #000; padding-bottom:10px; margin-bottom:15px;">
      <div><h2 style="color:var(--primary); font-size:20px; margin:0;">STITCHTRACK BESPOKE</h2><p style="font-size:12px; color:#666; margin:0;">Apparel Specification & Balance</p></div>
      <div style="text-align:right; font-size:14px; font-weight:800;">DATE:<br>${new Date().toLocaleDateString("en-GB")}</div>
    </div>
    <div style="background:#f8f9fa; border:1px solid #000; padding:12px; border-radius:10px; font-size:14px; font-weight:700; margin-bottom:15px; display:flex; gap:15px;">
      <div style="flex:1;">CLIENT: ${clientItem.fullName}<br>MOBILE: ${clientItem.phone}</div>
      <div style="text-align:right;">ORDER: #${orderItem.orderId}<br><span style="color:var(--danger)">DUE: ${orderItem.dateDue}</span></div>
    </div>
    <h4 style="font-size:14px; border-bottom:1px solid #000; margin-bottom:5px;">I. DESIGN BRIEF & LEDGER</h4>
    <p style="font-size:14px; margin-bottom:2px;"><strong>Garment:</strong> ${orderItem.designDescription}</p>
    <p style="font-size:14px; margin-bottom:10px;"><strong>Fabric:</strong> ${orderItem.fabricNotes || "Standard"}</p>
    <table class="print-table">
      <thead><tr><th>Total Cost</th><th>Paid Amount</th><th>Balance</th></tr></thead>
      <tbody><tr style="font-size:16px; font-weight:800;"><td>₦${Number(orderItem.totalCost).toLocaleString()}</td><td>₦${Number(orderItem.amountPaid).toLocaleString()}</td><td style="color:${balance > 0 ? "var(--danger)" : "var(--success)"};">₦${balance.toLocaleString()}</td></tr></tbody>
    </table>
    <h4 style="font-size:14px; border-bottom:1px solid #000; margin-top:15px; margin-bottom:5px;">II. STAGED PAYMENT HISTORY</h4>
    <table class="print-table">
      <thead><tr><th>Date</th><th>Method</th><th>Amount</th></tr></thead>
      <tbody>${paymentsRows}</tbody>
    </table>
    ${designThumbs ? `<div style="text-align:center; font-size:12px; font-weight:800; margin-top:10px;">STYLE BLUEPRINTS<br>${designThumbs}</div>` : ""}
  `;
  const previewDiv = document.getElementById("report-preview-viewport");
  if (previewDiv) previewDiv.innerHTML = html;
  const printContainer = document.getElementById("report-print-container");
  if (printContainer) printContainer.innerHTML = html;
  const previewCard = document.getElementById("report-onscreen-preview-card");
  if (previewCard) previewCard.style.display = "block";
}

function sendWhatsAppSummary() {
  const orderId = document.getElementById("rep-order-sel").value;
  if (!orderId) return;
  const order = cache.orders.find((o) => o.orderId === orderId);
  const client = cache.customers.find((c) => c.customerId === order.customerId);
  const balance = Number(order.totalCost) - Number(order.amountPaid);

  const text = `*STITCHTRACK STUDIO*\nHello ${client.fullName},\nSummary for order *#${order.orderId}*:\n\n👗 *Design:* ${order.designDescription}\n📅 *Due Date:* ${order.dateDue || "TBD"}\n\n💰 *Total:* ₦${Number(order.totalCost).toLocaleString()}\n💵 *Paid:* ₦${Number(order.amountPaid).toLocaleString()}\n⚖️ *Balance:* ₦${balance.toLocaleString()}`;

  // New records store a full international number ("+2348031234567") —
  // just strip the punctuation. Older records saved before this feature
  // may still be a bare 11-digit Nigerian local number; keep that fallback.
  let phone = String(client.phone || "").replace(/\D/g, "");
  if (!String(client.phone || "").startsWith("+") && phone.startsWith("0")) {
    phone = "234" + phone.substring(1);
  }
  window.open(
    `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,
    "_blank",
  );
}

async function shareInvoicePDF() {
  const orderId = document.getElementById("rep-order-sel").value;
  if (!orderId) return;
  const order = cache.orders.find((o) => o.orderId === orderId);
  const client = cache.customers.find((c) => c.customerId === order.customerId);
  const filename = `Invoice_${orderId}_${client.fullName.replace(/\s+/g, "_")}.pdf`;

  const toast = document.createElement("div");
  toast.id = "pdf-toast";
  toast.style.cssText =
    "position:fixed; bottom:30px; left:50%; transform:translateX(-50%); background:#212529; color:#ffffff; padding:16px 32px; border-radius:50px; font-weight:800; font-size:16px; z-index:99999; display:flex; align-items:center; gap:12px;";
  toast.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating PDF...';
  document.body.appendChild(toast);

  try {
    const renderBox = document.getElementById("report-preview-viewport");
    const opt = {
      margin: 10,
      filename: filename,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    };
    const pdfBytes = await html2pdf()
      .set(opt)
      .from(renderBox)
      .output("arraybuffer");

    const file = new File([pdfBytes], filename, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      toast.innerHTML =
        '<i class="fas fa-check-circle" style="color:var(--success)"></i> Opening Share Sheet...';
      await navigator.share({
        title: `Studio Invoice #${orderId}`,
        files: [file],
      });
    } else {
      toast.innerHTML = '<i class="fas fa-download"></i> Downloading...';
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
    }
  } catch (err) {
    alert("PDF Error: " + err.message);
  } finally {
    setTimeout(() => {
      if (document.getElementById("pdf-toast"))
        document.getElementById("pdf-toast").remove();
    }, 1000);
  }
}

// ==========================================
// CUSTOM PWA INSTALLATION LOGIC
// ==========================================
let deferredPrompt;
const installBtn = document.getElementById("installAppBtn");

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) {
    installBtn.style.display = "flex";
  }
});

if (installBtn) {
  installBtn.addEventListener("click", async () => {
    installBtn.style.display = "none";
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    deferredPrompt = null;
  });
}

window.addEventListener("appinstalled", () => {
  if (installBtn) installBtn.style.display = "none";
  console.log("StitchTrack Pro was successfully installed!");
});

// ==========================================
// iOS MANUAL INSTALL BANNER
// (beforeinstallprompt never fires in iOS Safari, so we prompt manually)
// ==========================================
function isIosDevice() {
  return (
    /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream
  );
}
function isRunningStandalone() {
  return "standalone" in window.navigator && window.navigator.standalone;
}
function dismissIosBanner() {
  const b = document.getElementById("iosInstallBanner");
  if (b) b.style.display = "none";
  localStorage.setItem("stitchtrack_ios_banner_dismissed", "1");
}
(function initIosInstallBanner() {
  if (
    isIosDevice() &&
    !isRunningStandalone() &&
    !localStorage.getItem("stitchtrack_ios_banner_dismissed")
  ) {
    const b = document.getElementById("iosInstallBanner");
    if (b) b.style.display = "flex";
  }
})();
