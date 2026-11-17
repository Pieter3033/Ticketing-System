const api = {
  currentUser: "api_current_user.sql",
  tickets: "api_tickets.sql",
  escalations: "api_escalations.sql",
  zohoEscalation: "api_zoho_escalation.sql",
  uniqueEscalation: "api_unique_escalation.sql",
  mapOptions: "api_escalation_map_options.sql",
  mapUpdate: "api_escalation_map_update.sql",
  openQuickLogsCount: "api_open_quick_logs_count.sql"
};

const sidebarStorageKey = "pulsit-sidebar-collapsed";
const sidebarGroupStorageKey = "pulsit-sidebar-groups";
const compactSidebarQuery = window.matchMedia("(max-width: 980px)");

const state = {
  currentUser: null,
  rows: [],
  pageRows: [],
  sortKey: "company",
  sortDir: "asc",
  page: 1,
  pageSize: 20,
  mapOptions: [],
  mapOptionsLoaded: false,
  activeMapRow: null,
  selectedMapAccount: null
};

const elements = {
  appShell: document.querySelector(".app-shell"),
  sidebarCollapseButton: document.querySelector("#sidebarCollapseButton"),
  themeToggle: document.querySelector("#themeToggle"),
  notice: document.querySelector("#notice"),
  search: document.querySelector("#escalationSearch"),
  company: document.querySelector("#companyFilter"),
  fleet: document.querySelector("#fleetFilter"),
  companyOptions: document.querySelector("#companyOptions"),
  fleetOptions: document.querySelector("#fleetOptions"),
  clearFilters: document.querySelector("#clearEscalationFilters"),
  rows: document.querySelector("#escalationRows"),
  count: document.querySelector("#escalationCount"),
  pagination: document.querySelector("#escalationPagination"),
  visibleCount: document.querySelector("#visibleEscalationCount"),
  uniqueCount: document.querySelector("#uniqueEscalationCount"),
  dialog: document.querySelector("#escalationDialog"),
  dialogClose: document.querySelector("#escalationDialogClose"),
  detail: document.querySelector("#escalationDetail"),
  mapDialog: document.querySelector("#mapEscalationDialog"),
  mapDialogClose: document.querySelector("#mapEscalationDialogClose"),
  mapMeta: document.querySelector("#mapEscalationMeta"),
  mapSearch: document.querySelector("#mapEscalationSearch"),
  mapOptions: document.querySelector("#mapEscalationOptions"),
  mapSelected: document.querySelector("#mapEscalationSelected"),
  mapReview: document.querySelector("#mapEscalationReview"),
  mapSave: document.querySelector("#mapEscalationSave"),
  mapCancel: document.querySelector("#mapEscalationCancel")
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function showNotice(message, type = "error") {
  elements.notice.textContent = message;
  elements.notice.className = `notice ${type}`;
  elements.notice.hidden = false;
}

function openDialog(dialog) {
  if (!dialog || dialog.open) return;
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
    return;
  }
  dialog.setAttribute("open", "");
}

function closeDialog(dialog) {
  if (!dialog || !dialog.open) return;
  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }
  dialog.removeAttribute("open");
}

function valueIsBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

async function requestJson(url, options = {}) {
  const responseInit = { headers: { Accept: "application/json" }, ...options };
  if (options.headers) {
    responseInit.headers = { Accept: "application/json", ...options.headers };
  }
  const response = await fetch(url, responseInit);
  const text = await response.text();
  if (!text.trim().startsWith("{") && !text.trim().startsWith("[")) {
    throw new Error("SQLPage returned a non-JSON response.");
  }
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || `Request failed with HTTP ${response.status}`);
  }
  return data;
}

function parseRows(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function uniqueAccountOptions(rows) {
  const accountMap = new Map();
  for (const row of rows) {
    const id = String(row?.id ?? "").trim();
    const label = String(row?.label ?? "").trim();
    if (!id || !label || accountMap.has(id)) continue;
    accountMap.set(id, label);
  }
  return Array.from(accountMap.entries())
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function phoneLink(value) {
  const text = String(value ?? "").trim();
  if (!/^[+()\d\s-]{7,}$/.test(text)) return escapeHtml(text || "-");
  return `<a href="tel:${escapeHtml(text.replace(/[^\d+]/g, ""))}">${escapeHtml(text)}</a>`;
}

function linkifyText(value) {
  const escaped = escapeHtml(value || "");
  return escaped.replace(/https?:\/\/[^\s<>"']+/g, (url) => {
    const trailing = url.match(/[),.;!?]+$/)?.[0] || "";
    const href = trailing ? url.slice(0, -trailing.length) : url;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>${trailing}`;
  });
}

function contactRows(record, prefix) {
  return Array.from({ length: 5 }, (_, index) => {
    const slot = index + 1;
    const name = record?.[`${prefix}_name_${slot}`];
    const number = record?.[`${prefix}_no_${slot}`];
    const altNumber = record?.[`${prefix}_alt_no_${slot}`];
    const notes = record?.[`${prefix}_notes_${slot}`];
    return { slot, name, number, altNumber, notes };
  }).filter((contact) => [contact.name, contact.number, contact.altNumber, contact.notes].some((value) => !valueIsBlank(value)));
}

function contactSectionHtml(title, subtitle, contacts) {
  const icon = title.includes("Night") ? "moon" : title.includes("Weekend") ? "calendar" : "users";
  const content = contacts.length ? `
    <div class="escalation-contact-grid">
      ${contacts.map((contact) => `
        <article class="escalation-contact-card">
          <div class="escalation-contact-rank">${escapeHtml(initials(contact.name || `Contact ${contact.slot}`))}</div>
          <div class="escalation-contact-content">
            <h4>${escapeHtml(contact.name || `Contact ${contact.slot}`)}</h4>
            ${!valueIsBlank(contact.number) ? `<strong class="escalation-contact-type">Primary</strong>` : ""}
            <div class="escalation-contact-lines">
              ${!valueIsBlank(contact.number) ? `<p>${iconSvg("phone")} ${phoneLink(contact.number)}</p>` : ""}
              ${!valueIsBlank(contact.altNumber) ? `<p>${iconSvg("phone")} ${phoneLink(contact.altNumber)}</p>` : ""}
              ${!valueIsBlank(contact.notes) ? `<p>${iconSvg("message")} <span>${linkifyText(contact.notes)}</span></p>` : ""}
            </div>
          </div>
        </article>
      `).join("")}
    </div>
  ` : emptySectionHtml("No contacts captured for this escalation window.");

  return detailSectionHtml({
    title,
    subtitle,
    icon,
    count: contacts.length,
    content
  });
}

function noteItems(record) {
  const labels = [
    ["po_notes", "PO"],
    ["jamming_notes", "Jamming"],
    ["panic_notes", "Panic"],
    ["remote_panic_notes", "Remote Panic"],
    ["tamper_notes", "Tamper"],
    ["dph_notes", "DPH"],
    ["cap_notes", "CAP"],
    ["tilt_notes", "Tilt"],
    ["harness_t_notes", "Harness Tamper"],
    ["gate_jam_notes", "Gate Jam"],
    ["trailer_dis_notes", "Trailer Disconnect"],
    ["battery_dis_notes", "Battery Disconnect"],
    ["limp_geofence_notes", "Limp Geofence"],
    ["fatigue_notes", "Fatigue"],
    ["travel_stop_notes", "Travel Stop"],
    ["removed_notes", "Removed"],
    ["limp_activate_notes", "Limp Activate"],
    ["max_time_exceed_notes", "Max Time Exceeded"],
    ["moving_out_of_geofence_notes", "Moving Out Of Geofence"],
    ["please_call_me_notes", "Please Call Me"],
    ["gen_note", "General Note"]
  ];
  return labels
    .map(([key, label]) => ({ key, label, value: record?.[key] }))
    .filter((item) => !valueIsBlank(item.value));
}

function initials(value) {
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "EL";
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() || "").join("");
}

function iconSvg(name) {
  const icons = {
    buildings: '<path d="M4 21v-15c0 -1 1 -2 2 -2h5c1 0 2 1 2 2v15"></path><path d="M16 8h2c1 0 2 1 2 2v11"></path><path d="M3 21h18"></path><path d="M10 12v.01"></path><path d="M10 16v.01"></path><path d="M10 8v.01"></path><path d="M7 12v.01"></path><path d="M7 16v.01"></path><path d="M7 8v.01"></path><path d="M17 12v.01"></path><path d="M17 16v.01"></path>',
    document: '<path d="M8 3h5l4 4v14H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"></path><path d="M13 3v5h5"></path><path d="M9 13h6"></path><path d="M9 17h4"></path>',
    warning: '<path d="m12 4 9 16H3L12 4Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
    users: '<path d="M16 19c0-2.2-1.8-4-4-4H7c-2.2 0-4 1.8-4 4"></path><circle cx="9.5" cy="8" r="3"></circle><path d="M21 19c0-1.9-1.3-3.4-3.1-3.9"></path><path d="M16.5 5.2a3 3 0 0 1 0 5.6"></path>',
    moon: '<path d="M20 14.2A7.5 7.5 0 0 1 9.8 4a8 8 0 1 0 10.2 10.2Z"></path>',
    calendar: '<path d="M8 2v4"></path><path d="M16 2v4"></path><rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M4 10h16"></path>',
    infodash: '<rect x="5" y="5" width="5" height="9" rx=".7"></rect><rect x="13" y="5" width="6" height="6" rx=".7"></rect><rect x="5" y="17" width="5" height="3" rx=".7"></rect><rect x="13" y="14" width="6" height="6" rx=".7"></rect>',
    truck: '<path d="M3 7h11v8H3z"></path><path d="M14 10h4l3 3v2h-7z"></path><circle cx="7" cy="18" r="2"></circle><circle cx="17" cy="18" r="2"></circle>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path>',
    person: '<circle cx="12" cy="7" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6.4 6.4l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2Z"></path>',
    message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"></path>',
    chevron: '<path d="m6 9 6 6 6-6"></path>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.document}</svg>`;
}

function sidebarFact(icon, label, value) {
  return `
    <div class="escalation-side-fact">
      ${iconSvg(icon)}
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "N/A")}</strong>
    </div>
  `;
}

function detailSectionHtml({ title, subtitle, icon, count = null, open = true, content = "" }) {
  return `
    <section class="escalation-detail-section">
      <div class="escalation-section-header">
        <span class="escalation-section-icon">${iconSvg(icon)}</span>
        <span class="escalation-section-title">
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(subtitle)}</small>
        </span>
        ${count !== null ? `<span class="escalation-section-count">${count}</span>` : ""}
      </div>
      <div class="escalation-section-body">${content}</div>
    </section>
  `;
}

function emptySectionHtml(message) {
  return `
    <div class="escalation-section-empty">
      <span>${iconSvg("users")}</span>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function escalationDetailHtml(row, details, options = {}) {
  const records = Array.isArray(details) ? details : [];
  const record = records[0] || null;
  const source = options.source === "unique" ? "unique" : "zoho";
  const badgeLabel = source === "unique" ? "Unique Escalation" : "Zoho Mapping";
  const badgeClass = source === "unique" ? "status-open" : "status-gray";
  const dayContacts = record ? contactRows(record, "d_c") : [];
  const nightContacts = record ? contactRows(record, "n_c") : [];
  const weekendContacts = record ? contactRows(record, "we_c") : [];
  const notes = record ? noteItems(record) : [];
  const authContent = record && (!valueIsBlank(record.auth_notes) || !valueIsBlank(record.group_notes)) ? `
    <div class="escalation-note-grid">
      ${!valueIsBlank(record.auth_notes) ? `<article><h4>Auth Notes</h4><p>${linkifyText(record.auth_notes)}</p></article>` : ""}
      ${!valueIsBlank(record.group_notes) ? `<article><h4>Group Notes</h4><p>${linkifyText(record.group_notes)}</p></article>` : ""}
    </div>
  ` : `<p class="escalation-auth-empty">No authorization notes captured.</p>`;
  const eventContent = notes.length ? `
    <div class="escalation-note-grid">
      ${notes.map((note) => `<article><h4>${escapeHtml(note.label)}</h4><p>${linkifyText(note.value)}</p></article>`).join("")}
    </div>
  ` : emptySectionHtml("No event-specific notes captured.");
  const openZohoLink = source === "zoho" && row.zohoId
    ? `<a class="filter-button compact escalation-open-zoho" href="https://crm.zoho.com/crm/org641484768/tab/Accounts/${encodeURIComponent(row.zohoId)}" target="_blank" rel="noopener noreferrer"><img class="escalation-open-zoho-logo" src="https://www.logoshape.com/wp-content/uploads/2026/03/zoho-crm-vector-logo_logoshape.com_.png" alt="" aria-hidden="true"><span>Open Zoho</span></a>`
    : "";
  const openInfodashLink = row.customerId
    ? `<a class="filter-button compact escalation-open-infodash" href="https://infodashwebpuls.mstrack.com/overview?customer=${encodeURIComponent(row.customerId)}" target="_blank" rel="noopener noreferrer"><span class="escalation-open-infodash-logo">${iconSvg("infodash")}</span><span>Open Infodash</span></a>`
    : "";
  const externalLinks = openZohoLink || openInfodashLink
    ? `<div class="escalation-external-actions">${openZohoLink}${openInfodashLink}</div>`
    : "";

  return `
    <div class="escalation-view">
      <aside class="escalation-view-sidebar">
        <div class="escalation-profile-mark">${iconSvg("buildings")}</div>
        <h1>${escapeHtml(row.company || "Escalation")}</h1>
        <div class="escalation-view-badges">
          <span class="badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
        </div>
        <div class="escalation-view-facts">
          ${sidebarFact("truck", "Fleet", row.fleet)}
          ${source === "zoho" ? sidebarFact("document", "Zoho Account", row.zohoAccount) : ""}
          ${sidebarFact("lock", "Verification Password", record?.verification_password)}
          ${sidebarFact("person", "Authorised Person", record?.auth_person)}
        </div>
        ${externalLinks}
      </aside>
      <main class="escalation-view-main">
        <header class="escalation-view-header">
          <h2>Escalation List</h2>
        </header>
        ${record ? `
          ${detailSectionHtml({
            title: "Authorization Notes",
            subtitle: "Important context before contacting the escalation list.",
            icon: "document",
            content: authContent
          })}
          ${detailSectionHtml({
            title: "Event Notes",
            subtitle: "Notes for specific alert types.",
            icon: "warning",
            count: notes.length,
            content: eventContent
          })}
          ${contactSectionHtml("Day Contacts", "Primary contacts during normal working hours.", dayContacts)}
          ${contactSectionHtml("Night Contacts", "After-hours escalation contacts.", nightContacts)}
          ${contactSectionHtml("Weekend Contacts", "Weekend and public holiday contacts.", weekendContacts)}
        ` : `
          <section class="escalation-empty-detail">
            <h3>No escalation list found</h3>
            <p>${source === "unique" ? "The unique escalation record did not return matching details." : "The account mapping exists, but the Zoho escalation list did not return matching records."}</p>
          </section>
        `}
      </main>
    </div>
  `;
}

function showEscalationDialog(content) {
  elements.detail.innerHTML = content;
  openDialog(elements.dialog);
}

function syncSidebarAccess() {
  const userType = String(state.currentUser?.user_type ?? "").trim();
  for (const element of document.querySelectorAll("[data-hide-for-user-type], [data-show-for-user-type]")) {
    const hiddenUserTypes = String(element.dataset.hideForUserType || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const shownUserTypes = String(element.dataset.showForUserType || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    element.hidden = !userType || hiddenUserTypes.includes(userType) || (shownUserTypes.length > 0 && !shownUserTypes.includes(userType));
  }
  const isHelpdeskUser = [true, 1, "1", "true"].includes(state.currentUser?.helpdesk);
  for (const element of document.querySelectorAll("[data-show-for-helpdesk]")) {
    element.hidden = !isHelpdeskUser;
  }
  const dispatchLink = document.querySelector("[data-show-for-dispatch-access]");
  if (dispatchLink) dispatchLink.hidden = !canViewDispatchLink();
}

function canViewDispatchLink() {
  const userType = String(state.currentUser?.user_type ?? "").trim();
  const isHelpdeskUser = [true, 1, "1", "true"].includes(state.currentUser?.helpdesk);
  return userType === "7" || userType === "8" || userType === "14" || (userType === "1" && isHelpdeskUser);
}

function renderTicketCounts(stats = {}) {
  const activeCount = Number(stats.openCount || 0) + Number(stats.inProgressCount || 0) + Number(stats.waitingCount || 0);
  const counts = {
    active: activeCount,
    helpdesk: Number(stats.helpdeskCount || 0),
    callcentre: Number(stats.callCentreCount || 0),
    pulscam: Number(stats.pulscamCount || 0),
    tad: Number(stats.tadCount || 0),
    closed: Number(stats.closedCount || 0)
  };
  for (const [key, value] of Object.entries(counts)) {
    const target = document.querySelector(`[data-nav-count="${key}"]`);
    if (target) target.textContent = value;
  }
}

function syncThemeToggle() {
  const theme = localStorage.getItem("srf-jobcard-theme") === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  if (elements.themeToggle) {
    elements.themeToggle.checked = theme === "dark";
    elements.themeToggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} mode`);
  }
}

function setTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem("srf-jobcard-theme", nextTheme);
  syncThemeToggle();
}

function setSidebarCollapsed(collapsed) {
  elements.appShell?.classList.toggle("sidebar-collapsed", collapsed);
  localStorage.setItem(sidebarStorageKey, collapsed ? "1" : "0");
  if (elements.sidebarCollapseButton) {
    elements.sidebarCollapseButton.setAttribute("aria-expanded", String(!collapsed));
    const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
    elements.sidebarCollapseButton.setAttribute("aria-label", label);
    elements.sidebarCollapseButton.setAttribute("title", label);
  }
}

function getSidebarGroupState() {
  try {
    return JSON.parse(localStorage.getItem(sidebarGroupStorageKey) || "{}");
  } catch {
    return {};
  }
}

function setSidebarGroupOpen(section, open, persist = true) {
  section.classList.toggle("is-open", open);
  const toggle = section.querySelector("[data-sidebar-toggle]");
  if (toggle) toggle.setAttribute("aria-expanded", String(open));
  if (!persist) return;
  const group = section.dataset.sidebarGroup;
  const saved = getSidebarGroupState();
  saved[group] = open;
  localStorage.setItem(sidebarGroupStorageKey, JSON.stringify(saved));
}

function syncSidebarGroups() {
  const saved = getSidebarGroupState();
  for (const section of document.querySelectorAll("[data-sidebar-group]")) {
    const group = section.dataset.sidebarGroup;
    const hasActiveChild = Boolean(section.querySelector(".active, .is-active"));
    setSidebarGroupOpen(section, saved[group] ?? (group === "escalations" || group === "dispatch" || hasActiveChild), false);
  }
}

async function loadCurrentUser() {
  try {
    state.currentUser = await requestJson(api.currentUser);
  } catch (error) {
    state.currentUser = null;
    showNotice("Could not verify your session. Please refresh and try again.", "error");
    return false;
  }
  if (window.InternalTicketSessionGuard?.isMissingSession(state.currentUser)) {
    window.InternalTicketSessionGuard.showMissingSession();
    return false;
  }
  syncSidebarAccess();
  return true;
}

async function loadTicketCounts() {
  try {
    const data = await requestJson(api.tickets);
    renderTicketCounts(data?.stats || {});
  } catch {
    renderTicketCounts({});
  }
}

async function loadOpenQuickLogCount() {
  const target = document.querySelector('[data-nav-count="quicklog"]');
  try {
    const data = await requestJson(api.openQuickLogsCount);
    const count = Number(data?.totalOpenCount ?? data?.openQuickLogsCount ?? 0);
    let newDraftCount = 0;
    if (data?.authorized === true) {
      try {
        window.QuickLogDrafts.migrate(sessionStorage, localStorage, data.operator);
        newDraftCount = window.QuickLogDrafts.collect(localStorage, data.operator).filter(draft => !draft.caseId).length;
      } catch (_) { /* Keep the server count if browser storage is unavailable. */ }
    }
    if (target) target.textContent = Number.isFinite(count) ? String(count + newDraftCount) : String(newDraftCount);
  } catch {
    if (target) target.textContent = "0";
  }
}

function fillOptions(target, rows) {
  target.innerHTML = rows
    .filter((row) => row?.value)
    .map((row) => `<option value="${escapeHtml(row.value)}">${escapeHtml(row.label || row.value)}</option>`)
    .join("");
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function filteredRows() {
  const search = normalize(elements.search.value);
  const company = normalize(elements.company.value);
  const fleet = normalize(elements.fleet.value);
  const filtered = state.rows.filter((row) => {
    const rowCompany = normalize(row.company);
    const rowFleet = normalize(row.fleet);
    const rowZoho = normalize(row.zohoAccount);
    return (!company || rowCompany.includes(company))
      && (!fleet || rowFleet.includes(fleet))
      && (!search || rowCompany.includes(search) || rowFleet.includes(search) || rowZoho.includes(search));
  });
  const dir = state.sortDir === "asc" ? 1 : -1;
  return filtered.sort((a, b) => {
    const av = normalize(a[state.sortKey]);
    const bv = normalize(b[state.sortKey]);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

function renderPagination(totalRows) {
  const totalPages = Math.max(1, Math.ceil(totalRows / state.pageSize));
  state.page = Math.min(Math.max(state.page, 1), totalPages);

  if (totalPages <= 1) {
    elements.pagination.innerHTML = "";
    return;
  }

  const pages = new Set([1, totalPages, state.page, state.page - 1, state.page + 1]);
  const pageButtons = Array.from(pages)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);

  const parts = [`<button type="button" data-page-nav="prev" ${state.page === 1 ? "disabled" : ""} aria-label="Previous page">‹</button>`];
  let previousPage = 0;
  for (const page of pageButtons) {
    if (previousPage && page - previousPage > 1) {
      parts.push(`<span class="pagination-gap" aria-hidden="true">…</span>`);
    }
    parts.push(`<button type="button" data-page-number="${page}" class="${page === state.page ? "current" : ""}" aria-current="${page === state.page ? "page" : "false"}">${page}</button>`);
    previousPage = page;
  }
  parts.push(`<button type="button" data-page-nav="next" ${state.page === totalPages ? "disabled" : ""} aria-label="Next page">›</button>`);
  elements.pagination.innerHTML = parts.join("");
}

function renderRows() {
  const rows = filteredRows();
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / state.pageSize));
  const canMapEscalations = String(state.currentUser?.user_type ?? "").trim() === "7";
  state.page = Math.min(Math.max(state.page, 1), totalPages);
  const startIndex = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(startIndex, startIndex + state.pageSize);
  state.pageRows = pageRows;

  elements.visibleCount.textContent = rows.length;
  elements.uniqueCount.textContent = rows.filter((row) => Boolean(row.hasUniqueEscalation)).length;
  elements.count.textContent = totalRows
    ? `Showing ${startIndex + 1}-${Math.min(startIndex + state.pageSize, totalRows)} of ${totalRows} fleet${totalRows === 1 ? "" : "s"}`
    : "No escalations match the current filters";

  if (!rows.length) {
    elements.rows.innerHTML = `<tr><td colspan="5" class="empty-row">No escalation mappings match the current filters.</td></tr>`;
    renderPagination(0);
    return;
  }

  elements.rows.innerHTML = pageRows.map((row, index) => {
    const zohoUrl = row.zohoId
      ? `https://crm.zoho.com/crm/org641484768/tab/Accounts/${encodeURIComponent(row.zohoId)}`
      : "";
    const hasZohoLookup = Boolean(row.zohoId || (row.zohoAccount && row.zohoAccount !== "N/A"));
    const statusLabel = row.hasUniqueEscalation ? "Unique Escalation" : (hasZohoLookup ? "Zoho Mapping" : "N/A");
    const statusClass = row.hasUniqueEscalation ? "status-open" : "status-gray";
    return `
      <tr class="escalation-row" data-escalation-index="${index}" data-escalation-source="${row.hasUniqueEscalation ? "unique" : "zoho"}">
        <td class="ticket-title">${escapeHtml(row.company)}</td>
        <td>${escapeHtml(row.fleet)}</td>
        <td>${escapeHtml(row.zohoAccount || "N/A")}</td>
        <td>
          <span class="badge ${statusClass}">${escapeHtml(statusLabel)}</span>
        </td>
        <td>
          <div class="escalation-actions">
            ${row.hasUniqueEscalation
              ? `<button class="filter-button compact" type="button" data-escalation-action="view-unique" data-escalation-index="${index}" ${row.uniqueEscalationId ? "" : "disabled"}>View Escalation</button>`
              : `<button class="filter-button compact" type="button" data-escalation-action="view-zoho" data-escalation-index="${index}" ${hasZohoLookup ? "" : "disabled"}>View Escalation</button>`}
            ${canMapEscalations && !row.hasUniqueEscalation
              ? `<button class="filter-button compact secondary" type="button" data-escalation-action="map" data-escalation-index="${index}">Map Escalation</button>`
              : ""}
            ${!row.hasUniqueEscalation && zohoUrl ? `<a class="filter-button compact secondary" href="${zohoUrl}" target="_blank" rel="noopener noreferrer">Open Zoho</a>` : ""}
            ${!row.hasUniqueEscalation && !row.zohoId && !row.zohoAccount ? `<span class="muted-action">No link</span>` : ""}
          </div>
        </td>
      </tr>
    `;
  }).join("");
  renderPagination(totalRows);
}

async function loadMapOptions(forceRefresh = false) {
  if (state.mapOptionsLoaded && !forceRefresh) return state.mapOptions;
  const data = await requestJson(api.mapOptions);
  if (!data?.isAuthorized) {
    throw new Error("Escalation mapping is limited to authorized users.");
  }
  state.mapOptions = uniqueAccountOptions(parseRows(data.accounts));
  state.mapOptionsLoaded = true;
  return state.mapOptions;
}

function renderMapOptions() {
  if (!elements.mapOptions) return;
  const term = normalize(elements.mapSearch?.value || "");
  const selectedId = state.selectedMapAccount?.id || "";
  const options = state.mapOptions
    .filter((option) => normalize(option.label).includes(term) || normalize(option.id).includes(term))
    .slice(0, 80);

  if (!options.length) {
    elements.mapOptions.innerHTML = `<div class="map-option-empty">No Zoho accounts match this search.</div>`;
    return;
  }

  elements.mapOptions.innerHTML = options.map((option) => `
    <button class="map-option ${String(option.id) === String(selectedId) ? "is-selected" : ""}" type="button" data-map-account-id="${escapeHtml(option.id)}">
      <span>${escapeHtml(option.label)}</span>
      <small>${escapeHtml(option.id)}</small>
    </button>
  `).join("");
}

function syncMapReview() {
  const row = state.activeMapRow;
  const account = state.selectedMapAccount;
  if (elements.mapSelected) {
    elements.mapSelected.textContent = account ? account.label : "Select a Zoho account";
  }
  if (elements.mapReview) {
    elements.mapReview.innerHTML = row ? `
      <div><span>Company</span><strong>${escapeHtml(row.company || "-")}</strong></div>
      <div><span>Fleet</span><strong>${escapeHtml(row.fleet || "-")}</strong></div>
      <div><span>Current Zoho</span><strong>${escapeHtml(row.zohoAccount || "N/A")}</strong></div>
      <div><span>New Zoho</span><strong>${escapeHtml(account?.label || "-")}</strong></div>
    ` : "";
  }
  if (elements.mapSave) {
    elements.mapSave.disabled = !row || !account;
  }
}

async function openMapEscalation(row) {
  state.activeMapRow = row;
  state.selectedMapAccount = null;
  if (elements.mapMeta) {
    elements.mapMeta.textContent = `${row.company || "-"} / ${row.fleet || "-"} - current: ${row.zohoAccount || "N/A"}`;
  }
  if (elements.mapSearch) {
    elements.mapSearch.value = "";
  }
  if (elements.mapOptions) {
    elements.mapOptions.innerHTML = `<div class="map-option-empty">Loading Zoho accounts...</div>`;
  }
  syncMapReview();
  openDialog(elements.mapDialog);
  elements.mapSearch?.focus();

  try {
    await loadMapOptions();
    renderMapOptions();
  } catch (error) {
    if (elements.mapOptions) {
      elements.mapOptions.innerHTML = `<div class="map-option-empty">${escapeHtml(error.message)}</div>`;
    }
  }
}

async function saveMapEscalation() {
  const row = state.activeMapRow;
  const account = state.selectedMapAccount;
  if (!row || !account || !elements.mapSave) return;

  const originalLabel = elements.mapSave.textContent;
  elements.mapSave.disabled = true;
  elements.mapSave.textContent = "Saving...";

  try {
    const body = new URLSearchParams();
    body.set("company", row.company || "");
    body.set("fleet_code", row.fleet || "");
    body.set("new_zoho_id", account.id || "");
    const data = await requestJson(api.mapUpdate, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (!data?.ok) {
      throw new Error(data?.message || "Escalation mapping could not be updated.");
    }

    row.zohoId = data.zohoId || account.id;
    row.zohoAccount = data.zohoAccount || account.label;
    closeDialog(elements.mapDialog);
    showNotice(data.message || "Escalation mapping updated.", "success");
    renderRows();
  } catch (error) {
    showNotice(error.message, "error");
    syncMapReview();
  } finally {
    elements.mapSave.textContent = originalLabel;
    elements.mapSave.disabled = !state.activeMapRow || !state.selectedMapAccount;
  }
}

async function openEscalationRow(row, source) {
  const isUnique = source === "unique";
  const detailApi = isUnique ? api.uniqueEscalation : api.zohoEscalation;
  const detailParams = isUnique
    ? new URLSearchParams({ escalationId: row.uniqueEscalationId || "" })
    : new URLSearchParams({ zohoId: row.zohoId || "" });

  showEscalationDialog(`
    <div class="escalation-view escalation-view-loading">
      <main class="escalation-view-main">
        <section class="escalation-empty-detail">
          <h3>Loading escalation list...</h3>
          <p>Fetching ${isUnique ? "unique" : "Zoho"} escalation information.</p>
        </section>
      </main>
    </div>
  `);

  try {
    const data = await requestJson(`${detailApi}?${detailParams.toString()}`);
    if (!data?.isAuthorized) {
      throw new Error(data?.message || "Escalation access is limited.");
    }
    if (data?.message) {
      showEscalationDialog(escalationDetailHtml(row, [], { source }));
      showNotice(data.message, "error");
      return;
    }
    showEscalationDialog(escalationDetailHtml(row, parseRows(data.escalationDetails), { source }));
  } catch (error) {
    showEscalationDialog(`
      <div class="escalation-view escalation-view-loading">
        <main class="escalation-view-main">
          <section class="escalation-empty-detail">
            <h3>Escalation list unavailable</h3>
            <p>${escapeHtml(error.message)}</p>
          </section>
        </main>
      </div>
    `);
  }
}

async function loadEscalations() {
  const params = new URLSearchParams();
  const data = await requestJson(`${api.escalations}?${params.toString()}`);
  if (!data?.isAuthorized) {
    state.rows = [];
    elements.rows.innerHTML = `<tr><td colspan="5" class="empty-row">Escalation access is limited to authorized internal ticket users.</td></tr>`;
    elements.count.textContent = "Access restricted";
    showNotice("Escalation access requires a Call Centre or Reload profile.", "error");
    return;
  }
  state.rows = parseRows(data.escalations);
  fillOptions(elements.companyOptions, parseRows(data.companies));
  fillOptions(elements.fleetOptions, parseRows(data.fleets));
  renderRows();
}

document.querySelector(".sidebar-nav")?.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-sidebar-toggle]");
  const section = toggle?.closest("[data-sidebar-group]");
  if (!section) return;
  event.preventDefault();
  if (elements.appShell?.classList.contains("sidebar-collapsed")) {
    setSidebarCollapsed(false);
    setSidebarGroupOpen(section, true);
    return;
  }
  setSidebarGroupOpen(section, !section.classList.contains("is-open"));
});
document.querySelector(".sidebar-nav")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const toggle = event.target.closest("[data-sidebar-toggle]");
  const section = toggle?.closest("[data-sidebar-group]");
  if (!section) return;
  event.preventDefault();
  if (elements.appShell?.classList.contains("sidebar-collapsed")) {
    setSidebarCollapsed(false);
    setSidebarGroupOpen(section, true);
    return;
  }
  setSidebarGroupOpen(section, !section.classList.contains("is-open"));
});

document.querySelectorAll("[data-sort-key]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.sortKey;
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    } else {
      state.sortKey = key;
      state.sortDir = "asc";
    }
    state.page = 1;
    renderRows();
  });
});

for (const input of [elements.search, elements.company, elements.fleet]) {
  input.addEventListener("input", () => {
    state.page = 1;
    renderRows();
  });
}

elements.clearFilters.addEventListener("click", () => {
  elements.search.value = "";
  elements.company.value = "";
  elements.fleet.value = "";
  state.page = 1;
  renderRows();
});

elements.pagination.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-page-nav]")?.dataset.pageNav;
  const page = event.target.closest("[data-page-number]")?.dataset.pageNumber;
  const totalPages = Math.max(1, Math.ceil(filteredRows().length / state.pageSize));
  if (nav === "prev") {
    state.page = Math.max(1, state.page - 1);
  } else if (nav === "next") {
    state.page = Math.min(totalPages, state.page + 1);
  } else if (page) {
    state.page = Number(page);
  } else {
    return;
  }
  renderRows();
});

elements.rows.addEventListener("click", async (event) => {
  const trigger = event.target.closest("[data-escalation-action]");
  if (!trigger) return;
  const row = state.pageRows[Number(trigger.dataset.escalationIndex)];
  if (!row) return;
  if (trigger.dataset.escalationAction === "map") {
    await openMapEscalation(row);
    return;
  }
  const isUnique = trigger.dataset.escalationAction === "view-unique";
  const source = isUnique ? "unique" : "zoho";
  await openEscalationRow(row, source);
});

elements.rows.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-escalation-action]");
  if (action) return;
  const interactive = event.target.closest("a, button, input, select, textarea");
  if (interactive) return;
  const rowEl = event.target.closest("tr[data-escalation-index]");
  if (!rowEl) return;
  const row = state.pageRows[Number(rowEl.dataset.escalationIndex)];
  if (!row) return;
  const source = row.hasUniqueEscalation ? "unique" : "zoho";
  if (row.hasUniqueEscalation) {
    if (!row.uniqueEscalationId) return;
  } else if (!row.zohoId && (!row.zohoAccount || row.zohoAccount === "N/A")) {
    return;
  }
  await openEscalationRow(row, source);
});

elements.themeToggle?.addEventListener("change", (event) => setTheme(event.target.checked ? "dark" : "light"));
elements.sidebarCollapseButton?.addEventListener("click", () => {
  setSidebarCollapsed(!elements.appShell?.classList.contains("sidebar-collapsed"));
});
elements.dialogClose?.addEventListener("click", () => closeDialog(elements.dialog));
elements.mapDialogClose?.addEventListener("click", () => closeDialog(elements.mapDialog));
elements.mapCancel?.addEventListener("click", () => closeDialog(elements.mapDialog));
elements.mapSearch?.addEventListener("input", renderMapOptions);
elements.mapOptions?.addEventListener("click", (event) => {
  const option = event.target.closest("[data-map-account-id]");
  if (!option) return;
  state.selectedMapAccount = state.mapOptions.find((account) => String(account.id) === String(option.dataset.mapAccountId)) || null;
  renderMapOptions();
  syncMapReview();
});
elements.mapSave?.addEventListener("click", saveMapEscalation);
compactSidebarQuery.addEventListener("change", (event) => {
  setSidebarCollapsed(event.matches);
});

syncThemeToggle();
window.addEventListener("storage", event => {
  if (event.storageArea === localStorage && (event.key === null || event.key.startsWith(window.QuickLogDrafts.prefix))) {
    window.clearTimeout(state.draftRefreshTimer);
    state.draftRefreshTimer = window.setTimeout(() => loadOpenQuickLogCount(), 100);
  }
});
setSidebarCollapsed(compactSidebarQuery.matches ? true : false);
syncSidebarGroups();
loadCurrentUser()
  .then((sessionOk) => sessionOk ? Promise.all([loadEscalations(), loadTicketCounts(), loadOpenQuickLogCount()]) : null)
  .catch((error) => showNotice(error.message, "error"));
