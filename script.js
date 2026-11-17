const internalTicketsApiBase = window.INTERNAL_TICKETS_API_BASE || "";

const api = {
  tickets: "api_tickets.sql",
  ticket: "api_ticket.sql",
  createTicket: `${internalTicketsApiBase}create_ticket.sql`,
  addComment: "add_comment.sql",
  acknowledgeTicket: "acknowledge_ticket.sql",
  updateClientContacted: "update_client_contacted.sql",
  updateZohoTicket: "update_zoho_ticket.sql",
  updateDepartment: "update_department.sql",
  jobCounts: "api_job_counts.sql",
  currentUser: "api_current_user.sql",
  openQuickLogsCount: "api_open_quick_logs_count.sql",
  dashboard: "api_dashboard.sql",
  registrationLookup: "api_registration_lookup.sql"
};

const sidebarStorageKey = "pulsit-sidebar-collapsed";
const sidebarGroupStorageKey = "pulsit-sidebar-groups";
const compactSidebarQuery = window.matchMedia("(max-width: 980px)");

function getPinnedTicketViewFilters(params = new URLSearchParams(location.search)) {
  const status = params.get("status");
  const department = params.get("department");
  if (status === "Closed") return { status: "Closed" };
  if (department === "Helpdesk") return { department: "Helpdesk" };
  if (department === "CC") return { department: "CC" };
  if (department === "Pulscam") return { department: "Pulscam" };
  if (department === "TAD") return { department: "TAD" };
  if (department === "Software") return { department: "Software" };
  return {};
}

function getInitialTicketFilters() {
  const params = new URLSearchParams(location.search);
  const pinnedViewFilters = getPinnedTicketViewFilters(params);
  const filters = {};
  for (const [name, value] of params.entries()) {
    if (!value) continue;
    if (pinnedViewFilters[name] === value) continue;
    filters[name] = value;
  }
  return { pinnedViewFilters, filters };
}

const initialTicketFilterState = getInitialTicketFilters();

const state = {
  tickets: [],
  selectedTicketId: null,
  selectedTicket: null,
  currentUser: null,
  currentUserLoaded: false,
  ticketRefreshInFlight: false,
  latestCreatedTicketId: null,
  notificationAudio: null,
  notificationAudioUnlocked: false,
  page: 1,
  pageSize: 10,
  pinnedTicketViewFilters: initialTicketFilterState.pinnedViewFilters,
  filters: initialTicketFilterState.filters,
  dashboard: {
    filters: {},
    loaded: false
  }
};

const elements = {
  appShell: document.querySelector(".app-shell"),
  rows: document.querySelector("#ticketRows"),
  count: document.querySelector("#ticketCount"),
  filters: document.querySelector("#filters"),
  clearFiltersButton: document.querySelector("#clearFiltersButton"),
  form: document.querySelector("#ticketForm"),
  clientCallback: document.querySelector("#clientCallback"),
  clientCallbackFields: document.querySelector("#clientCallbackFields"),
  sidebarCollapseButton: document.querySelector("#sidebarCollapseButton"),
  themeToggle: document.querySelector("#themeToggle"),
  notice: document.querySelector("#notice"),
  pagination: document.querySelector("#ticketPagination"),
  dialog: document.querySelector("#ticketDialog"),
  detail: document.querySelector("#ticketDetail"),
  userAvatar: document.querySelector("#userAvatar"),
  userDisplayName: document.querySelector("#userDisplayName"),
  closedSummaryCard: document.querySelector("#closedSummaryCard"),
  closedSummaryCount: document.querySelector("#closedSummaryCount"),
  rowMenu: document.querySelector("#ticketRowMenu"),
  rowMenuAcknowledge: document.querySelector('[data-menu-action="acknowledge"]'),
  dashboardSection: document.querySelector("#managerDashboard"),
  dashboardFilters: document.querySelector("#dashboardFilters"),
  dashboardCategory: document.querySelector("#dashboardCategory"),
  dashboardResetButton: document.querySelector("#dashboardResetButton"),
  dashboardStatus: document.querySelector("#dashboardStatus"),
  dashboardRange: document.querySelector("#dashboardRange"),
  dashboardCategoryBreakdown: document.querySelector("#dashboardCategoryBreakdown"),
  dashboardUserBreakdown: document.querySelector("#dashboardUserBreakdown"),
  dashboardTicketBreakdown: document.querySelector("#dashboardTicketBreakdown"),
  dashboardCategoryCount: document.querySelector("#dashboardCategoryCount"),
  dashboardUserCount: document.querySelector("#dashboardUserCount"),
  dashboardTicketCount: document.querySelector("#dashboardTicketCount"),
  registrationInput: document.querySelector('#ticketForm [name="registration"]')
};

const attachmentInput = document.querySelector("#attachmentInput");
const attachmentFilename = document.querySelector("[data-upload-filename]");

const helpdeskCategories = [
  "Unit not updating - needs to unlimp",
  "Unit not updating - needs to unlock",
  "Unit not updating - needs to be limped",
  "Unit not updating - needs to lock",
  "Unit not Updating",
  "Unit stuck in limp",
  "Unit not unlocking",
  "Unit not locking",
  "Disable Event: (Tamper, Driver ID Tag, Panic etc)",
  "Reg. Update",
  "Remove Unit from System",
  "Setup Unit",
  "Script Change",
  "FOB Remote Issue",
  "Other - (Include in description)"
];
const pulscamCategories = ["Cameras Offline", "Camera Footage", "Health Check", "Setting Alterations", "Report Request", "Other"];
const softwareCategories = ["Bug", "Feature Request", "System Issue", "Access Request", "Other"];

const className = (value) => String(value || "").toLowerCase().replace(/\s+/g, "-");
const departmentLabel = (value) => value === "CC" ? "Call Centre" : value;
const statusClass = (status) => ({ "In Progress": "progress", "Waiting on User": "waiting", Cancelled: "closed" }[status] || className(status));
const dotClass = (status) => ({ Closed: "gray", "Waiting on User": "amber", "In Progress": "blue" }[status] || "green");
const toAttachmentHref = (storedFilePath) => {
  const normalizedPath = String(storedFilePath || "").trim();
  if (!normalizedPath) return "";
  if (/^[a-zA-Z]:\\/.test(normalizedPath)) {
    return `file:///${normalizedPath.replace(/\\/g, "/")}`;
  }
  const urlPath = normalizedPath.replace(/\\/g, "/");
  if (/^(https?:|data:|blob:|\/)/i.test(urlPath)) return urlPath;
  return `/${urlPath}`;
};

const rowMenuState = {
  ticketId: null,
  x: 0,
  y: 0
};

const ticketNotificationSound = "assets/notification1.wav";
const registrationLookupCache = new Map();
let registrationLookupTimer = 0;
let registrationLookupRequestId = 0;

function isFinishedStatus(status) {
  return status === "Closed" || status === "Cancelled";
}

function isClosedView() {
  return new URLSearchParams(location.search).get("status") === "Closed";
}

function currentTicketViewKey() {
  const current = new URLSearchParams(location.search);
  const status = current.get("status");
  const department = current.get("department");
  return status === "Closed"
    ? "closed"
    : department === "Helpdesk"
      ? "helpdesk"
      : department === "CC"
        ? "callcentre"
      : department === "Pulscam"
        ? "pulscam"
      : department === "TAD"
        ? "tad"
      : department === "Software"
        ? "software"
        : "active";
}

function shouldAutoRefreshTickets() {
  return ["active", "helpdesk", "callcentre", "pulscam", "software"].includes(currentTicketViewKey());
}

function canPlayTicketNotification() {
  return state.currentUserLoaded
    && Boolean(state.currentUser?.userId)
    && Number.isInteger(window.InternalTicketAccess.userType(state.currentUser))
    && !window.InternalTicketAccess.isRequester(state.currentUser)
    && ["helpdesk", "callcentre", "pulscam"].includes(currentTicketViewKey());
}

function ensureNotificationAudio() {
  if (!state.notificationAudio) {
    state.notificationAudio = new Audio(ticketNotificationSound);
    state.notificationAudio.preload = "auto";
  }
  return state.notificationAudio;
}

function unlockNotificationAudio() {
  if (!canPlayTicketNotification() || state.notificationAudioUnlocked) return;
  const audio = ensureNotificationAudio();
  const previousVolume = audio.volume;
  audio.volume = 0;
  audio.play()
    .then(() => {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = previousVolume;
      state.notificationAudioUnlocked = true;
    })
    .catch(() => {
      audio.volume = previousVolume;
    });
}

function playHelpdeskTicketNotification() {
  if (!canPlayTicketNotification()) return;
  const audio = ensureNotificationAudio();
  audio.pause();
  audio.currentTime = 0;
  audio.volume = 1;
  audio.play().catch((error) => {
    console.warn("Helpdesk ticket notification sound could not play:", error);
  });
}

function notifyForNewHelpdeskTickets(tickets = [], enabled = false, latestCreatedTicketId = null) {
  if (!canPlayTicketNotification()) {
    state.latestCreatedTicketId = null;
    return;
  }
  // Use the server's unfiltered creation cursor, never additions to the displayed list.
  const nextCreationId = Number(latestCreatedTicketId);
  if (latestCreatedTicketId == null || String(latestCreatedTicketId).trim() === ""
    || !Number.isSafeInteger(nextCreationId) || nextCreationId < 0) return;
  const previousCreationId = state.latestCreatedTicketId;
  if (previousCreationId !== null && nextCreationId < previousCreationId) return;
  state.latestCreatedTicketId = nextCreationId;

  if (!enabled || previousCreationId === null) return;
  const hasNewTicket = tickets.some((ticket) => {
    const ticketId = Number(ticket?.ticketId);
    return Number.isSafeInteger(ticketId)
      && ticketId > previousCreationId && ticketId <= nextCreationId;
  });
  if (hasNewTicket) {
    playHelpdeskTicketNotification();
  }
}

function isTruthy(value) {
  return value === true || value === 1 || value === "1";
}

function parseTicketDate(value) {
  const normalized = String(value || "").trim().replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function ticketAgeClass(ticket) {
  if (ticket?.assignedToUserId) return "";
  const createdAt = parseTicketDate(ticket?.createdAt);
  if (!createdAt) return "";
  const ageMinutes = (Date.now() - createdAt.getTime()) / 60000;
  if (ageMinutes >= 10) return "ticket-row-age-danger";
  if (ageMinutes >= 5) return "ticket-row-age-warning";
  return "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function requesterTicketBadge(group) {
  if (!["IBLS", "CRM", "Infinity"].includes(group)) return "";
  const modifier = group === "IBLS" ? " requester-ticket-badge--ibls" : "";
  return `<span class="requester-ticket-badge${modifier}">${escapeHtml(group)}</span>`;
}

function canLookupRegistration(ticket = null) {
  return Boolean(state.currentUser?.userId)
    && Number.isInteger(window.InternalTicketAccess.userType(state.currentUser))
    && !window.InternalTicketAccess.isIBLS(state.currentUser)
    && ticket?.requesterGroup !== "IBLS";
}

function syncRegistrationLookupAccess() {
  const allowed = canLookupRegistration();
  for (const scope of document.querySelectorAll("[data-registration-lookup]")) {
    scope.hidden = !allowed;
    if (!allowed) resetRegistrationLookup(scope);
  }
  if (!allowed) {
    window.clearTimeout(registrationLookupTimer);
    registrationLookupRequestId += 1;
    registrationLookupCache.clear();
  }
}

function registrationLookupMarkup(scope, ticket = null) {
  if (!canLookupRegistration(ticket)) return "";
  return `
    <span class="registration-lookup" data-registration-lookup="${escapeHtml(scope)}" aria-live="polite">
      <span class="registration-lookup-item" data-lookup-kind="exact" hidden>
        <button class="registration-lookup-icon" type="button" aria-label="Vehicle lookup status">${registrationInfoIcon()}</button>
        <span class="registration-lookup-popover" role="tooltip"></span>
      </span>
    </span>
  `;
}

function registrationInfoIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 8h.01"></path></svg>';
}

function registrationCopyText(vehicle = {}) {
  return [
    `Registration: ${vehicle.reg_no || ""}`,
    `Description: ${vehicle.vehdesc || ""}`,
    `Company: ${vehicle.company || ""}`,
    `Fleet Code: ${vehicle.fleet_Code || ""}`,
    `Make: ${vehicle.MakeDesc || ""}`,
    `Color: ${vehicle.color || ""}`,
    `Unit ID: ${vehicle.unit_id || ""}`,
    `Chassis No: ${vehicle.chassisno || ""}`,
    `Engine No: ${vehicle.engineno || ""}`
  ].join("\n");
}

function lookupSimilarValues(result = {}) {
  return (Array.isArray(result.similarRegistrations) ? result.similarRegistrations : [])
    .map((item) => String(item?.reg_no || item || "").trim())
    .filter(Boolean);
}

function setLookupItem(item, stateName, popoverHtml, label) {
  if (!item) return;
  const icon = item.querySelector(".registration-lookup-icon");
  const popover = item.querySelector(".registration-lookup-popover");
  item.hidden = false;
  item.dataset.state = stateName;
  if (icon) icon.setAttribute("aria-label", label);
  if (popover) popover.innerHTML = popoverHtml;
}

function resetRegistrationLookup(scopeEl) {
  if (!scopeEl) return;
  for (const item of scopeEl.querySelectorAll(".registration-lookup-item")) {
    item.hidden = true;
    item.dataset.state = "neutral";
    const popover = item.querySelector(".registration-lookup-popover");
    if (popover) popover.textContent = "";
  }
}

function renderRegistrationLookup(scopeEl, result = {}, ticket = null) {
  if (!scopeEl || !canLookupRegistration(ticket)) return;
  const exactItem = scopeEl.querySelector('[data-lookup-kind="exact"]');
  const similarItem = scopeEl.querySelector('[data-lookup-kind="similar"]');
  const exactFound = isTruthy(result.exactFound) && result.vehicle;
  const similarValues = lookupSimilarValues(result);

  if (exactFound) {
    const copyText = encodeURIComponent(registrationCopyText(result.vehicle));
    setLookupItem(
      exactItem,
      "found",
      `<strong>Vehicle info found.</strong><button class="registration-copy-button" type="button" data-registration-copy="${copyText}">Copy</button>`,
      "Vehicle info found."
    );
  } else {
    setLookupItem(exactItem, "missing", "<strong>No match found.</strong>", "No match found.");
  }

  if (similarValues.length > 1) {
    setLookupItem(
      similarItem,
      "found",
      `<strong>Matching registrations</strong><span>${similarValues.map(escapeHtml).join("</span><span>")}</span>`,
      "Similar registrations found."
    );
  } else {
    setLookupItem(similarItem, "missing", "<strong>No matches found.</strong>", "No matches found.");
  }
}

function renderRegistrationLookupError(scopeEl, ticket = null) {
  if (!scopeEl || !canLookupRegistration(ticket)) return;
  setLookupItem(scopeEl.querySelector('[data-lookup-kind="exact"]'), "missing", "<strong>Lookup unavailable.</strong>", "Lookup unavailable.");
  setLookupItem(scopeEl.querySelector('[data-lookup-kind="similar"]'), "missing", "<strong>Lookup unavailable.</strong>", "Lookup unavailable.");
}

function renderRegistrationLookupPending(scopeEl, ticket = null) {
  if (!scopeEl || !canLookupRegistration(ticket)) return;
  setLookupItem(scopeEl.querySelector('[data-lookup-kind="exact"]'), "pending", "<strong>Checking vehicle info...</strong>", "Checking vehicle info.");
  setLookupItem(scopeEl.querySelector('[data-lookup-kind="similar"]'), "pending", "<strong>Checking similar registrations...</strong>", "Checking similar registrations.");
}

function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
    return Promise.resolve();
  } finally {
    textarea.remove();
  }
}

function showNotice(message, type = "success") {
  elements.notice.textContent = message;
  elements.notice.className = `notice ${type}`;
  elements.notice.hidden = false;
  window.setTimeout(() => {
    elements.notice.hidden = true;
  }, 4500);
}

function formatCurrentUser(user) {
  const parts = [user?.name, user?.surname].map((part) => String(part || "").trim()).filter(Boolean);
  if (parts.length) return parts.join(" ");
  return String(user?.username || "").trim();
}

function renderCurrentUser() {
  const label = formatCurrentUser(state.currentUser) || "Internal Tickets";
  if (elements.userDisplayName) {
    elements.userDisplayName.textContent = label;
  }
  if (elements.userAvatar) {
    const initials = label
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("");
    elements.userAvatar.textContent = initials || "IT";
  }
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
  syncTicketDepartmentOptions();
  syncRegistrationLookupAccess();
  syncRequesterAccess();
}

function syncRequesterAccess() {
  const isRequester = window.InternalTicketAccess.isRequester(state.currentUser);
  const group = window.InternalTicketAccess.requesterGroup(state.currentUser);
  document.body.classList.toggle("requester-ticket-user", isRequester);
  const staffAccess = [true, 1, "1"].includes(state.currentUser?.can_manage_requester_groups);
  document.querySelectorAll("[data-requester-staff-only]").forEach(element => { element.hidden = !staffAccess; });
  document.querySelectorAll("[data-call-centre-link]").forEach(element => { element.hidden = isRequester; });
  const pageTitle = document.querySelector(".page-title h1");
  if (pageTitle && !isRequester && currentTicketViewKey() === "callcentre") pageTitle.textContent = "Call Centre Tickets";
  if (!isRequester) return;
  document.querySelectorAll(".app-sidebar .nav-section").forEach(section => {
    section.hidden = !["tickets", "settings"].includes(section.dataset.sidebarGroup);
  });
  document.querySelectorAll(".app-sidebar a").forEach(link => {
    const view = link.dataset.navFilter;
    const logout = link.dataset.requesterAllowed === "true" || /logout\.sql(?:\?|$)/i.test(link.getAttribute("href") || "");
    link.hidden = !logout && view !== "active" && view !== "closed";
  });
  const completedLabel = document.querySelector('[data-nav-filter="closed"] > span');
  if (completedLabel) completedLabel.textContent = "Completed Tickets";
  const title = document.querySelector(".page-title h1");
  if (title) title.textContent = isClosedView() ? `${group} Completed Tickets` : `${group} Active Tickets`;
}

function canViewDispatchLink() {
  const userType = String(state.currentUser?.user_type ?? "").trim();
  const isHelpdeskUser = [true, 1, "1", "true"].includes(state.currentUser?.helpdesk);
  return userType === "7" || userType === "8" || userType === "14" || (userType === "1" && isHelpdeskUser);
}

function canViewJobcards() {
  const userType = String(state.currentUser?.user_type ?? "").trim();
  return Boolean(userType) && !["7", "8", "12", "13"].includes(userType);
}

function canViewQuickLogs() {
  return ["8", "14"].includes(String(state.currentUser?.user_type ?? "").trim());
}

function canViewDashboard() {
  return String(state.currentUser?.user_type ?? "").trim() === "7";
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

function syncSidebarCollapsed() {
  setSidebarCollapsed(compactSidebarQuery.matches || localStorage.getItem(sidebarStorageKey) !== "0");
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
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(open));
  }
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
    const defaultOpen = group === "tickets" || group === "escalations" || group === "dispatch" || hasActiveChild;
    setSidebarGroupOpen(section, saved[group] ?? defaultOpen, false);
  }
}

function syncClientCallbackFields() {
  if (!elements.clientCallback || !elements.clientCallbackFields) return;
  const enabled = elements.clientCallback.checked;
  elements.clientCallbackFields.style.display = enabled ? "grid" : "none";
  for (const input of elements.clientCallbackFields.querySelectorAll("input")) {
    input.disabled = !enabled;
    input.required = enabled;
    if (!enabled) input.value = "";
  }
}

function syncTicketDepartmentOptions() {
  const select = elements.form?.elements.department;
  if (!select) return;
  const current = select.value;
  const isIBLS = window.InternalTicketAccess.isIBLS(state.currentUser);
  const departments = isIBLS ? ["Helpdesk"] : ["Helpdesk", "Pulscam"];
  if (String(state.currentUser?.user_type ?? "").trim() === "7") departments.push("Software");
  select.innerHTML = (isIBLS ? "" : '<option value="">Select department</option>')
    + departments.map(value => `<option value="${escapeHtml(value)}"${value === "Helpdesk" ? " selected" : ""}>${escapeHtml(value)}</option>`).join("");
  select.value = departments.includes(current) ? current : "Helpdesk";
  syncTicketCategoryOptions();
}

function syncTicketCategoryOptions() {
  const department = elements.form?.elements.department;
  const category = elements.form?.elements.category;
  if (!department || !category) return;
  const current = category.value;
  const options = department.value === "Pulscam"
    ? pulscamCategories
    : department.value === "Software"
      ? softwareCategories
      : helpdeskCategories;
  category.innerHTML = `<option value="">Select category</option>${options.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
  category.value = options.includes(current) ? current : "";
}

function syncAttachmentFilename() {
  if (!attachmentInput || !attachmentFilename) return;
  const file = attachmentInput.files?.[0];
  attachmentFilename.textContent = file ? file.name : "No file chosen";
}

function renderActiveNav() {
  const key = currentTicketViewKey();

  for (const item of document.querySelectorAll("[data-nav-filter]")) {
    const isCurrent = item.dataset.navFilter === key;
    item.classList.toggle("active", isCurrent);
    item.classList.toggle("is-active", isCurrent);
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    credentials: "include",
    ...options
  });
  const text = await response.text();
  if (!text.trim().startsWith("{") && !text.trim().startsWith("[")) {
    const endpoint = String(url || "").split("?")[0];
    const detail = text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
    throw new Error(`SQLPage returned a non-JSON response from ${endpoint}.${detail ? ` ${detail}` : ""}`);
  }
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || `Request failed with HTTP ${response.status}`);
  }
  return data;
}

async function loadRegistrationLookup(registration, ticket = null) {
  if (!canLookupRegistration(ticket)) return null;
  const reg = String(registration || "").trim();
  if (!reg) return null;
  const cacheKey = reg.toUpperCase();
  if (registrationLookupCache.has(cacheKey)) {
    return registrationLookupCache.get(cacheKey);
  }
  const result = await requestJson(`${api.registrationLookup}?${new URLSearchParams({ reg_no: reg, _: String(Date.now()) }).toString()}`);
  registrationLookupCache.set(cacheKey, result || {});
  return result || {};
}

function lookupRegistrationForScope(registration, scopeEl, ticket = null) {
  const reg = String(registration || "").trim();
  if (!reg || !scopeEl || !canLookupRegistration(ticket)) {
    resetRegistrationLookup(scopeEl);
    return Promise.resolve(null);
  }
  renderRegistrationLookupPending(scopeEl, ticket);
  return loadRegistrationLookup(reg, ticket)
    .then((result) => {
      renderRegistrationLookup(scopeEl, result, ticket);
      return result;
    })
    .catch((error) => {
      console.warn("Registration lookup failed:", error);
      renderRegistrationLookupError(scopeEl, ticket);
      return null;
    });
}

function scheduleFormRegistrationLookup() {
  const scopeEl = document.querySelector('[data-registration-lookup="form"]');
  const registrationInput = elements.registrationInput || document.querySelector('#ticketForm [name="registration"]');
  const registration = registrationInput?.value || "";
  window.clearTimeout(registrationLookupTimer);
  const requestId = ++registrationLookupRequestId;
  if (!registration.trim() || !canLookupRegistration()) {
    resetRegistrationLookup(scopeEl);
    return;
  }
  renderRegistrationLookupPending(scopeEl);
  registrationLookupTimer = window.setTimeout(() => {
    loadRegistrationLookup(registration).then((result) => {
      if (requestId !== registrationLookupRequestId) return;
      renderRegistrationLookup(scopeEl, result);
    }).catch((error) => {
      if (requestId !== registrationLookupRequestId) return;
      console.warn("Registration lookup failed:", error);
      renderRegistrationLookupError(scopeEl);
    });
  }, 300);
}

function queryFromFilters() {
  const mergedFilters = {
    ...state.filters,
    ...state.pinnedTicketViewFilters
  };
  return new URLSearchParams(
    Object.entries(mergedFilters).filter(([, value]) => value)
  );
}

function hasActiveTicketFilters() {
  return Object.values(state.filters).some((value) => String(value || "").trim());
}

function syncClearFiltersButton() {
  if (elements.clearFiltersButton) {
    elements.clearFiltersButton.disabled = !hasActiveTicketFilters();
  }
}

function syncFilterControls() {
  elements.filters.reset();
  const mergedFilters = {
    ...state.filters,
    ...state.pinnedTicketViewFilters
  };
  for (const [name, value] of Object.entries(mergedFilters)) {
    const control = elements.filters.elements[name];
    if (control) control.value = value;
  }
  syncClearFiltersButton();
}

function syncUrl() {
  const query = queryFromFilters().toString();
  history.replaceState(null, "", query ? `index.html?${query}` : "index.html");
  renderActiveNav();
}

function renderDepartmentOptions(departments = []) {
  const select = elements.filters.elements.department;
  const current = select.value;
  const allowedDepartments = window.InternalTicketAccess.isIBLS(state.currentUser) ? ["Helpdesk"] : ["Helpdesk", "Pulscam", "TAD"];
  if (!window.InternalTicketAccess.isRequester(state.currentUser)) allowedDepartments.splice(1, 0, "CC");
  if (String(state.currentUser?.user_type ?? "").trim() === "7") allowedDepartments.push("Software");
  const options = allowedDepartments.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(departmentLabel(value))}</option>`);
  select.innerHTML = `<option value="">All</option>${options.join("")}`;
  select.value = allowedDepartments.includes(current) ? current : "";
}

function renderAssignedToOptions(users = []) {
  const select = elements.filters.elements.assignedTo;
  if (!select) return;
  const current = select.value;
  const options = users
    .map((user) => {
      const value = String(user?.value || "").trim();
      const label = String(user?.label || value).trim();
      if (!value) return "";
      return `<option value="${escapeHtml(value)}">${escapeHtml(label || value)}</option>`;
    })
    .filter(Boolean);
  select.innerHTML = `<option value="">All</option>${options.join("")}`;
  select.value = current;
}

function renderStats(stats = {}, tickets = []) {
  for (const [key, value] of Object.entries(stats)) {
    const target = document.querySelector(`[data-stat="${key}"]`);
    if (target) target.textContent = value ?? 0;
  }
  const activeCount = Number(stats.openCount || 0) + Number(stats.inProgressCount || 0) + Number(stats.waitingCount || 0);
  const navCounts = {
    active: activeCount,
    helpdesk: Number(stats.helpdeskCount || 0),
    callcentre: Number(stats.callCentreCount || 0),
    pulscam: Number(stats.pulscamCount || 0),
    tad: Number(stats.tadCount || 0),
    software: Number(stats.softwareCount || 0)
  };
  for (const [key, value] of Object.entries(navCounts)) {
    const target = document.querySelector(`[data-nav-count="${key}"]`);
    if (target) target.textContent = value;
  }
  const inProgressTarget = document.querySelector('[data-stat="inProgressCount"]');
  if (inProgressTarget) inProgressTarget.textContent = Number(stats.inProgressCount || 0);

  const closedView = isClosedView();
  const statCards = Array.from(document.querySelectorAll(".stats-grid .stat-card"));
  if (elements.closedSummaryCard && elements.closedSummaryCount) {
    elements.closedSummaryCard.hidden = false;
    elements.closedSummaryCard.style.display = closedView ? "" : "none";
    elements.closedSummaryCount.textContent = String(tickets.length);
  }
  for (const card of statCards) {
    if (card === elements.closedSummaryCard) continue;
    card.hidden = false;
    card.style.display = closedView ? "none" : "";
  }
}

function renderJobCounts(counts = {}) {
  const targets = {
    active: counts.activeCount,
    completed: counts.completedCount,
    reschedule: counts.rescheduleCount,
    approval: counts.approvalCount
  };
  for (const [key, value] of Object.entries(targets)) {
    const target = document.querySelector(`[data-job-count="${key}"]`);
    if (target) target.textContent = Number(value || 0);
  }
}

async function loadJobCounts() {
  if (!canViewJobcards()) {
    renderJobCounts({});
    return;
  }
  try {
    const data = await requestJson(api.jobCounts);
    renderJobCounts(data || {});
  } catch {
    renderJobCounts({});
  }
}

function renderOpenQuickLogCount(count = 0) {
  const target = document.querySelector('[data-nav-count="quicklog"]');
  if (target) target.textContent = String(Number(count || 0));
}

async function loadOpenQuickLogCount() {
  if (!canViewQuickLogs()) {
    renderOpenQuickLogCount(0);
    return;
  }
  try {
    const data = await requestJson(api.openQuickLogsCount);
    const count = Number(data?.totalOpenCount ?? data?.openQuickLogsCount ?? 0);
    renderOpenQuickLogCount(Number.isFinite(count) ? count : 0);
  } catch {
    renderOpenQuickLogCount(0);
  }
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function toDateTimeLocalValue(date) {
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate())
  ].join("-") + `T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

function defaultDashboardFilters() {
  const now = new Date();
  const from = new Date(now.getTime() - (24 * 60 * 60 * 1000));
  return {
    category: "",
    date_from: toDateTimeLocalValue(from),
    date_to: toDateTimeLocalValue(now),
    contribution_filter: ""
  };
}

function dashboardQueryFromFilters() {
  return new URLSearchParams(
    Object.entries(state.dashboard.filters).filter(([, value]) => String(value || "").trim())
  );
}

function syncDashboardFilterControls() {
  if (!elements.dashboardFilters) return;
  for (const [name, value] of Object.entries(state.dashboard.filters)) {
    const control = elements.dashboardFilters.elements[name];
    if (control) control.value = value || "";
  }
}

function setDashboardStatus(message, type = "muted") {
  if (!elements.dashboardStatus) return;
  elements.dashboardStatus.textContent = message || "";
  elements.dashboardStatus.className = `dashboard-status ${type}`;
  elements.dashboardStatus.hidden = !message;
}

function setDashboardLoading(loading) {
  if (!elements.dashboardFilters) return;
  for (const control of elements.dashboardFilters.elements) {
    control.disabled = loading;
  }
  if (loading) setDashboardStatus("Loading dashboard...", "muted");
}

function formatDashboardNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString() : "0";
}

function formatDashboardRange() {
  const from = state.dashboard.filters.date_from;
  const to = state.dashboard.filters.date_to;
  if (!from && !to) return "All time";
  if (from && to) return `${from.replace("T", " ")} to ${to.replace("T", " ")}`;
  if (from) return `From ${from.replace("T", " ")}`;
  return `Until ${to.replace("T", " ")}`;
}

function renderDashboardCategoryOptions(categories = []) {
  if (!elements.dashboardCategory) return;
  const current = elements.dashboardCategory.value;
  const options = categories
    .map((category) => {
      const value = String(category?.value || "").trim();
      const label = String(category?.label || value).trim();
      if (!value) return "";
      return `<option value="${escapeHtml(value)}">${escapeHtml(label || value)}</option>`;
    })
    .filter(Boolean);
  elements.dashboardCategory.innerHTML = `<option value="">All categories</option>${options.join("")}`;
  elements.dashboardCategory.value = current;
}

function renderDashboardMetrics(metrics = {}) {
  for (const target of document.querySelectorAll("[data-dashboard-metric]")) {
    const key = target.dataset.dashboardMetric;
    target.textContent = formatDashboardNumber(metrics[key]);
  }
}

function dashboardEmpty(message) {
  return `<p class="dashboard-empty">${escapeHtml(message)}</p>`;
}

function renderDashboardBreakdown(target, items, getConfig, emptyMessage) {
  if (!target) return;
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) {
    target.innerHTML = dashboardEmpty(emptyMessage);
    return;
  }
  const max = Math.max(...rows.map((item) => Number(getConfig(item).value || 0)), 1);
  target.innerHTML = rows.map((item) => {
    const config = getConfig(item);
    const value = Number(config.value || 0);
    const percent = Math.max(4, Math.round((value / max) * 100));
    return `
      <article class="dashboard-breakdown-row">
        <div class="dashboard-breakdown-row-main">
          <strong>${escapeHtml(config.label)}</strong>
          <span>${escapeHtml(config.meta || "")}</span>
        </div>
        <b>${formatDashboardNumber(value)}</b>
        <div class="dashboard-breakdown-bar" aria-hidden="true"><span style="width: ${percent}%"></span></div>
      </article>
    `;
  }).join("");
}

function renderDashboard(data = {}) {
  const metrics = data.metrics || {};
  const ticketsByCategory = data.ticketsByCategory || [];
  const contributionsByUser = data.contributionsByUser || [];
  const contributionsByTicket = data.contributionsByTicket || [];

  renderDashboardCategoryOptions(data.categories || []);
  syncDashboardFilterControls();
  renderDashboardMetrics(metrics);

  if (elements.dashboardRange) {
    elements.dashboardRange.textContent = formatDashboardRange();
  }
  if (elements.dashboardCategoryCount) {
    elements.dashboardCategoryCount.textContent = `${ticketsByCategory.length} categor${ticketsByCategory.length === 1 ? "y" : "ies"}`;
  }
  if (elements.dashboardUserCount) {
    elements.dashboardUserCount.textContent = `${contributionsByUser.length} user${contributionsByUser.length === 1 ? "" : "s"}`;
  }
  if (elements.dashboardTicketCount) {
    elements.dashboardTicketCount.textContent = `${contributionsByTicket.length} ticket${contributionsByTicket.length === 1 ? "" : "s"}`;
  }

  renderDashboardBreakdown(
    elements.dashboardCategoryBreakdown,
    ticketsByCategory,
    (item) => ({
      label: item.category || "Uncategorised",
      meta: `${formatDashboardNumber(item.contributionCount)} contribution${Number(item.contributionCount || 0) === 1 ? "" : "s"}`,
      value: item.ticketCount
    }),
    "No tickets match the dashboard filters."
  );
  renderDashboardBreakdown(
    elements.dashboardUserBreakdown,
    contributionsByUser,
    (item) => ({
      label: item.userName || `User ${item.userId || ""}`.trim(),
      meta: `${formatDashboardNumber(item.ticketCount)} ticket${Number(item.ticketCount || 0) === 1 ? "" : "s"} contributed to`,
      value: item.contributionCount
    }),
    "No contributions match the dashboard filters."
  );
  renderDashboardBreakdown(
    elements.dashboardTicketBreakdown,
    contributionsByTicket,
    (item) => ({
      label: item.ticketNumber || `Ticket ${item.ticketId || ""}`.trim(),
      meta: `${item.category || "Uncategorised"} | ${item.createdAt || "-"}`,
      value: item.contributionCount
    }),
    "No contributed tickets match the dashboard filters."
  );
}

async function loadDashboard() {
  if (!elements.dashboardSection || !canViewDashboard()) return;
  setDashboardLoading(true);
  try {
    const data = await requestJson(`${api.dashboard}?${dashboardQueryFromFilters().toString()}`);
    if (!isTruthy(data?.accessAllowed)) {
      elements.dashboardSection.hidden = true;
      return;
    }
    // tkt_InternalTickets has no explicit "handled" column; the SQL dashboard uses non-deleted filtered tickets as the handled-ticket population.
    renderDashboard(data);
    state.dashboard.loaded = true;
    setDashboardStatus("", "muted");
  } catch (error) {
    setDashboardStatus(error.message || "Dashboard could not be loaded.", "error");
  } finally {
    setDashboardLoading(false);
  }
}

function renderPagination() {
  if (!elements.pagination) return;
  const totalPages = Math.max(1, Math.ceil(state.tickets.length / state.pageSize));
  state.page = Math.min(Math.max(state.page, 1), totalPages);

  if (totalPages === 1) {
    elements.pagination.innerHTML = "";
    return;
  }

  const buttons = [];
  buttons.push(`<button type="button" data-page-nav="prev" ${state.page === 1 ? "disabled" : ""} aria-label="Previous page">‹</button>`);

  for (let i = 1; i <= totalPages; i += 1) {
    buttons.push(`<button type="button" data-page-number="${i}" class="${i === state.page ? "current" : ""}" aria-current="${i === state.page ? "page" : "false"}">${i}</button>`);
  }

  buttons.push(`<button type="button" data-page-nav="next" ${state.page === totalPages ? "disabled" : ""} aria-label="Next page">›</button>`);
  elements.pagination.innerHTML = buttons.join("");
}

function renderTickets() {
  if (!state.tickets.length) {
    elements.rows.innerHTML = `<tr><td colspan="8" class="empty-row">No tickets match the current filters.</td></tr>`;
    elements.count.textContent = "No tickets found";
    renderPagination();
    return;
  }

  const totalTickets = state.tickets.length;
  const totalPages = Math.max(1, Math.ceil(totalTickets / state.pageSize));
  state.page = Math.min(Math.max(state.page, 1), totalPages);
  const startIndex = (state.page - 1) * state.pageSize;
  const pageTickets = state.tickets.slice(startIndex, startIndex + state.pageSize);

  elements.rows.innerHTML = pageTickets.map((ticket) => `
    <tr class="ticket-row ${ticketAgeClass(ticket)}" data-ticket-id="${ticket.ticketId}">
      <td><span class="dot ${dotClass(ticket.status)}"></span><button class="ticket-link" type="button" data-ticket-id="${ticket.ticketId}">${escapeHtml(ticket.ticketNumber)}</button>${requesterTicketBadge(ticket.requesterGroup)}</td>
      <td class="ticket-title">${escapeHtml(ticket.category)}</td>
      <td>${escapeHtml(ticket.registration || "-")}</td>
      <td>${escapeHtml(departmentLabel(ticket.department))}</td>
      <td><span class="badge priority-${className(ticket.priority)}">${escapeHtml(ticket.priority)}</span></td>
      <td>${escapeHtml(ticket.assignedToName || (ticket.assignedToUserId ? `User ${ticket.assignedToUserId}` : "-"))}</td>
      <td>${escapeHtml(ticket.createdAt)}</td>
      <td>${escapeHtml(ticket.updatedAt)}</td>
    </tr>
  `).join("");

  const endIndex = Math.min(startIndex + state.pageSize, totalTickets);
  elements.count.textContent = `Showing ${startIndex + 1}-${endIndex} of ${totalTickets} ticket${totalTickets === 1 ? "" : "s"}`;
  renderPagination();
}

function hideRowMenu() {
  if (!elements.rowMenu) return;
  elements.rowMenu.hidden = true;
  elements.rowMenu.style.left = "";
  elements.rowMenu.style.top = "";
  elements.rowMenu.style.visibility = "";
  rowMenuState.ticketId = null;
}

function showRowMenu(ticketId, x, y) {
  if (!elements.rowMenu) return;
  const ticket = state.tickets.find((item) => String(item.ticketId) === String(ticketId));
  rowMenuState.ticketId = ticketId;
  rowMenuState.x = x;
  rowMenuState.y = y;
  if (elements.rowMenuAcknowledge) {
    elements.rowMenuAcknowledge.hidden = !window.InternalTicketAccess.canManage(state.currentUser, ticket) || Boolean(ticket?.assignedToUserId);
  }
  elements.rowMenu.hidden = false;
  elements.rowMenu.style.visibility = "hidden";
  const menuRect = elements.rowMenu.getBoundingClientRect();
  const maxX = Math.max(12, window.innerWidth - menuRect.width - 12);
  const maxY = Math.max(12, window.innerHeight - menuRect.height - 12);
  elements.rowMenu.style.left = `${Math.min(x, maxX)}px`;
  elements.rowMenu.style.top = `${Math.min(y, maxY)}px`;
  elements.rowMenu.style.visibility = "visible";
}

async function loadTickets({ preservePage = false, notifyNewTickets = false } = {}) {
  const params = queryFromFilters();
  const data = await requestJson(`${api.tickets}?${params.toString()}`);
  state.tickets = isClosedView()
    ? (data?.tickets || []).filter((ticket) => isFinishedStatus(ticket.status))
    : (data?.tickets || []);
  notifyForNewHelpdeskTickets(state.tickets, notifyNewTickets, data?.latestCreatedTicketId);
  if (!preservePage) state.page = 1;
  renderStats(data?.stats, state.tickets);
  renderDepartmentOptions(data?.departments || []);
  renderAssignedToOptions(data?.assignedToUsers || []);
  syncFilterControls();
  renderTickets();
}

async function autoRefreshTickets() {
  if (!shouldAutoRefreshTickets() || state.ticketRefreshInFlight) return;
  state.ticketRefreshInFlight = true;
  try {
    await loadTickets({ preservePage: true, notifyNewTickets: true });
  } catch (error) {
    console.warn("Ticket auto-refresh failed:", error);
  } finally {
    state.ticketRefreshInFlight = false;
  }
}

function refreshTicketsFromFilters() {
  state.filters = Object.fromEntries(new FormData(elements.filters));
  for (const [name, value] of Object.entries(state.pinnedTicketViewFilters)) {
    if (state.filters[name] === value) {
      delete state.filters[name];
    }
  }
  syncUrl();
  syncClearFiltersButton();
  return loadTickets();
}

function clearTicketFilters() {
  window.clearTimeout(elements.filters.filterTimer);
  elements.filters.reset();
  state.filters = {};
  syncUrl();
  syncClearFiltersButton();
  return loadTickets();
}

async function acknowledgeTicket(ticketId) {
  const result = await requestJson(api.acknowledgeTicket, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ ticket_id: ticketId })
  });
  if (!result?.success) {
    throw new Error(result?.message || "Ticket could not be acknowledged.");
  }
  await loadTickets();
  await openTicket(ticketId);
  showNotice("Ticket acknowledged and assigned.");
}

async function updateClientContacted(ticketId, contacted) {
  const result = await requestJson(api.updateClientContacted, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      ticket_id: ticketId,
      contacted: contacted ? "1" : "0"
    })
  });
  if (!result?.success) {
    throw new Error(result?.message || "Client callback status could not be updated.");
  }
  await openTicket(ticketId);
  await loadTickets();
  showNotice(contacted ? "Client marked as contacted." : "Client marked as not contacted.");
}

async function updateZohoTicket(ticketId, zohoTicketNumber) {
  const result = await requestJson(api.updateZohoTicket, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      ticket_id: ticketId,
      zoho_ticketnum: zohoTicketNumber
    })
  });
  if (!result?.success) {
    throw new Error(result?.message || "Zoho ticket number could not be updated.");
  }
  await openTicket(ticketId);
  await loadTickets();
  showNotice("Zoho ticket number updated.");
}

async function updateTicketDepartment(ticketId, department) {
  const result = await requestJson(api.updateDepartment, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ticket_id: ticketId, department })
  });
  if (!result?.success) throw new Error(result?.message || "Department could not be updated.");
  await openTicket(ticketId);
  await loadTickets({ preservePage: true });
  showNotice(`Ticket moved to ${departmentLabel(department)}.`);
}

async function loadCurrentUser() {
  try {
    const data = await requestJson(api.currentUser);
    state.currentUser = data || null;
  } catch (error) {
    state.currentUser = null;
    state.currentUserLoaded = false;
    showNotice("Could not verify your session. " + (error.message || "Please refresh and try again."), "error");
    return false;
  }
  state.currentUserLoaded = true;
  if (window.InternalTicketSessionGuard?.isMissingSession(state.currentUser)) {
    window.InternalTicketSessionGuard.showMissingSession();
    return false;
  }
  if (!state.currentUser?.userId || state.currentUser?.user_type == null) {
    showNotice("Your session is valid, but your account or user type could not be resolved. Please contact support.", "error");
    return false;
  }
  renderCurrentUser();
  syncSidebarAccess();
  return true;
}

function ticketDetailHtml(ticket, comments, attachments = []) {
  const canManage = window.InternalTicketAccess.canManage(state.currentUser, ticket);
  const assignedTo = ticket.assignedToName || (ticket.assignedToUserId ? `User ${ticket.assignedToUserId}` : "Unassigned");
  const openedBy = ticket.createdBy || (ticket.requestedByUserId ? `User ${ticket.requestedByUserId}` : "-");
  const clientCallbackRequired = isTruthy(ticket.clientCallbackRequired);
  const clientContacted = isTruthy(ticket.clientContacted);
  const isClosedTicket = isFinishedStatus(ticket.status);
  const createdDate = escapeHtml(ticket.createdAt || "-");
  const closedDate = escapeHtml(ticket.closedAt || "-");
  const assignButton = canManage && !isClosedTicket && !ticket.assignedToUserId
    ? `<button class="ticket-view-action" type="button" data-ticket-action="assign-self" data-ticket-id="${escapeHtml(ticket.ticketId)}">Assign to me</button>`
    : "";
  const textIcon = (path) => `<svg viewBox="0 0 24 24"><path d="${path}"></path></svg>`;
  const initials = (name) => String(name || "User")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "U";
  const detailItem = (label, value, icon, className = "") => `
    <div class="ticket-view-fact${className ? ` ${className}` : ""}">
      <span class="ticket-view-fact-icon" aria-hidden="true">${icon}</span>
      <span class="ticket-view-fact-copy">
        <small>${escapeHtml(label)}</small>
        <strong>${value}</strong>
      </span>
    </div>
  `;
  const sideFact = (label, value, icon) => `
    <div class="ticket-view-side-fact">
      <span aria-hidden="true">${icon}</span>
      <span class="ticket-view-side-fact-copy">
        <small>${escapeHtml(label)}</small>
        <strong>${value}</strong>
      </span>
    </div>
  `;
  const zohoTicketNumber = String(ticket.zohoTicketNumber || "").trim();
  const zohoFact = canManage && !isClosedTicket ? `
    <div class="ticket-view-side-fact ticket-view-zoho-fact">
      <span aria-hidden="true">${textIcon("M4 7h16v10H4V7zm2 2v6h12V9H6zm2 2h5v2H8v-2z")}</span>
      <span class="ticket-view-side-fact-copy">
        <small>Zoho Ticket</small>
        <span class="zoho-ticket-editor" data-ticket-id="${escapeHtml(ticket.ticketId)}">
          <input type="text" value="${escapeHtml(zohoTicketNumber)}" placeholder="-" maxlength="100" readonly data-zoho-ticket-input data-original-value="${escapeHtml(zohoTicketNumber)}" aria-label="Zoho ticket number">
          <button type="button" data-ticket-action="edit-zoho-ticket" aria-label="Edit Zoho ticket number" title="Edit Zoho ticket number">
            ${textIcon("M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z")}
          </button>
        </span>
      </span>
    </div>
  ` : sideFact("Zoho Ticket", escapeHtml(zohoTicketNumber || "-"), textIcon("M4 7h16v10H4V7z"));
  const registrationValue = ticket.registration || "-";
  const registrationDisplay = `
    <span class="ticket-view-registration-display">
      <span>${escapeHtml(registrationValue)}</span>
      ${String(registrationValue).trim() && registrationValue !== "-" ? registrationLookupMarkup("ticket", ticket) : ""}
    </span>
  `;
  const attachment = (attachments || [])[0];
  const attachmentLink = attachment?.downloadUrl || `api_attachment.sql?attachment_id=${encodeURIComponent(attachment?.attachmentId || "")}`;
  const departmentOptions = ["Helpdesk", "Pulscam", "TAD"];
  if (!["IBLS", "CRM"].includes(ticket.requesterGroup)) departmentOptions.splice(1, 0, "CC");
  if (String(state.currentUser?.user_type ?? "").trim() === "7" && !["IBLS", "CRM"].includes(ticket.requesterGroup)) departmentOptions.push("Software");
  const departmentEditor = canManage && !isClosedTicket ? `
    <span class="department-ticket-editor">
      <select data-ticket-department aria-label="Ticket department">
        ${departmentOptions.map((value) => `<option value="${escapeHtml(value)}" ${ticket.department === value ? "selected" : ""}>${escapeHtml(departmentLabel(value))}</option>`).join("")}
      </select>
      <button type="button" data-ticket-action="save-department" data-ticket-id="${escapeHtml(ticket.ticketId)}" disabled>Save</button>
    </span>
  ` : escapeHtml(departmentLabel(ticket.department));

  return `
    <div class="ticket-view">
      <aside class="ticket-view-sidebar">
        <div class="ticket-view-back">
          <span aria-hidden="true">${textIcon("M15 18l-6-6 6-6")}</span>
          <strong>Tickets</strong>
        </div>
        <span class="ticket-number">${escapeHtml(ticket.ticketNumber)}${requesterTicketBadge(ticket.requesterGroup)}</span>
        <section class="ticket-view-side-card">
          <h2>Quick Check</h2>
          ${sideFact("Opened by", escapeHtml(openedBy), textIcon("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-7 2-7 5v1h14v-1c0-3-3-5-7-5z"))}
          ${sideFact("Priority", `<span class="badge priority-${className(ticket.priority)}">${escapeHtml(ticket.priority)}</span>`, textIcon("M5 3v18H3V3h2zm3 1h11l-3 5 3 5H8V4z"))}
          ${sideFact("Department", departmentEditor, textIcon("M4 4h7v7H4V4zm2 2v3h3V6H6zm7-2h7v7h-7V4zm2 2v3h3V6h-3zM4 13h7v7H4v-7zm2 2v3h3v-3H6zm7-2h7v7h-7v-7zm2 2v3h3v-3h-3z"))}
          ${sideFact("Category", escapeHtml(ticket.category), textIcon("M3 6h6l2 2h10v11H3V6zm2 4v7h14v-7H5z"))}
          ${sideFact("Assigned", escapeHtml(assignedTo), textIcon("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-7 2-7 5v1h14v-1c0-3-3-5-7-5z"))}
          ${sideFact("Created", createdDate, textIcon("M7 2h2v2h6V2h2v2h3v18H4V4h3V2zm11 8H6v10h12V10z"))}
          ${sideFact("Closed", closedDate, textIcon("M12 2a10 10 0 1 0 .1 0H12zm0 2a8 8 0 1 1-.1 0h.1zm4.7 5.3L11 15l-3.2-3.2 1.4-1.4 1.8 1.8 4.3-4.3 1.4 1.4z"))}
          ${zohoFact}
          <div class="ticket-view-client-details" aria-label="Client details">
            ${sideFact("Client", escapeHtml(ticket.clientName || "-"), textIcon("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-7 2-7 5v1h14v-1c0-3-3-5-7-5z"))}
            ${sideFact("Contact", escapeHtml(ticket.clientContact || "-"), textIcon("M6.6 10.8c1.4 2.7 3.9 5.2 6.6 6.6l2.2-2.2c.3-.3.8-.4 1.2-.3 1.3.4 2.6.6 4 .6.8 0 1.4.6 1.4 1.4v3.5c0 .8-.6 1.4-1.4 1.4C10.3 22.3 1.7 13.7 1.7 3.4 1.7 2.6 2.3 2 3.1 2h3.5c.8 0 1.4.6 1.4 1.4 0 1.4.2 2.7.6 4 .1.4 0 .9-.3 1.2l-1.7 2.2z"))}
          </div>
        </section>
        ${clientCallbackRequired ? `
          <section class="ticket-view-side-card callback-status-panel ${clientContacted ? "contacted" : "pending"} ${isClosedTicket ? "is-closed" : ""}" ${isClosedTicket ? 'aria-disabled="true"' : ""}>
            <div>
              <strong>Client callback required</strong>
              <span>${clientContacted ? "Client has been contacted." : "Client has not been contacted yet."}</span>
            </div>
            <label class="callback-contacted-toggle">
              <input type="checkbox" data-ticket-action="client-contacted" data-ticket-id="${escapeHtml(ticket.ticketId)}" ${clientContacted ? "checked" : ""} ${isClosedTicket || !canManage ? "disabled" : ""}>
              <span>Client contacted</span>
            </label>
          </section>
        ` : ""}
      </aside>

      <main class="ticket-view-main">
        <header class="ticket-view-header">
          <div>
            <h1>${escapeHtml(ticket.category)}</h1>
            <div class="ticket-view-badges">
              <span class="badge status-${statusClass(ticket.status)}">${escapeHtml(ticket.status)}</span>
              <span class="badge priority-${className(ticket.priority)}">${escapeHtml(ticket.priority)} Priority</span>
            </div>
          </div>
          ${assignButton}
        </header>

        <section class="ticket-view-panel ticket-view-facts" aria-label="Ticket summary">
          ${detailItem("Department", escapeHtml(departmentLabel(ticket.department)), textIcon("M4 4h7v7H4V4zm2 2v3h3V6H6zm7-2h7v7h-7V4zm2 2v3h3V6h-3zM4 13h7v7H4v-7zm2 2v3h3v-3H6zm7-2h7v7h-7v-7zm2 2v3h3v-3h-3z"))}
          ${detailItem("Category", escapeHtml(ticket.category), textIcon("M3 6h6l2 2h10v11H3V6zm2 4v7h14v-7H5z"))}
          ${detailItem("Assigned", escapeHtml(assignedTo), textIcon("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-7 2-7 5v1h14v-1c0-3-3-5-7-5z"))}
          ${detailItem("Created", createdDate, textIcon("M7 2h2v2h6V2h2v2h3v18H4V4h3V2zm11 8H6v10h12V10z"))}
          ${detailItem("Registration", registrationDisplay, textIcon("M3 6h18v12H3V6zm2 2v8h14V8H5zm2 2h5v2H7v-2zm0 3h8v2H7v-2z"), "ticket-view-registration-fact")}
        </section>

        <section class="ticket-view-panel">
          <h2><span aria-hidden="true">${textIcon("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6")}</span>Description</h2>
          <p class="description">${escapeHtml(ticket.description)}</p>
        </section>

        <section class="ticket-view-panel">
          <div class="ticket-view-panel-title">
            <h2><span aria-hidden="true">${textIcon("M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5l9.9-9.9a4 4 0 0 1 5.7 5.7l-9.9 9.9a2 2 0 1 1-2.8-2.8l8.5-8.5")}</span>Attachment</h2>
            <span>${attachment ? "1 file" : "No file"}</span>
          </div>
          ${attachment ? `
            <a class="ticket-attachment-link" href="${escapeHtml(attachmentLink)}" data-ticket-action="download-attachment">
              <span aria-hidden="true">${textIcon("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6")}</span>
              <span>
                <strong>${escapeHtml(attachment.originalFileName || "Attachment")}</strong>
                <small>${escapeHtml(attachment.uploadedAt || "-")}${attachment.uploadedByName ? ` by ${escapeHtml(attachment.uploadedByName)}` : ""}</small>
              </span>
            </a>
          ` : `<p class="empty-copy">No attachment added.</p>`}
        </section>

        <section class="ticket-view-panel">
          <div class="ticket-view-panel-title">
            <h2><span aria-hidden="true">${textIcon("M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8z")}</span>Conversation</h2>
            <span>${(comments || []).length} update${(comments || []).length === 1 ? "" : "s"}</span>
          </div>
          <div class="comments-list ticket-view-comments">
            ${(comments || []).length ? comments.map((comment) => `
              <article class="comment-card">
                <div class="comment-avatar" aria-hidden="true">${escapeHtml(initials(comment.commentedByName || `User ${comment.commentedByUserId}`))}</div>
                <div class="comment-body">
                  <div class="comment-meta">
                    <strong>${escapeHtml(comment.commentedByName || `User ${comment.commentedByUserId}`)}</strong>
                    <span class="badge status-${statusClass(comment.status)}">${escapeHtml(comment.status || "-")}</span>
                    <span>${escapeHtml(comment.commentedAt)}</span>
                  </div>
                  <p>${escapeHtml(comment.comment)}</p>
                </div>
              </article>
            `).join("") : `<p class="empty-copy">No comments yet.</p>`}
          </div>
        </section>

        ${canManage ? `<form id="commentForm" class="ticket-view-panel ticket-view-compose ${isClosedTicket ? "is-closed" : ""}" ${isClosedTicket ? 'aria-disabled="true"' : ""}>
          <input type="hidden" name="ticket_id" value="${escapeHtml(ticket.ticketId)}">
          <h2><span aria-hidden="true">${textIcon("M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z")}</span>Add a response</h2>
          ${clientCallbackRequired && !clientContacted ? `
            <div class="ticket-close-blocker" role="status">
              <strong>Ticket cannot be closed</strong>
              <span>Tick Client contacted before setting this ticket to Closed.</span>
            </div>
          ` : ""}
          <label class="ticket-view-comment-field">
            <span class="sr-only">Comment</span>
            <textarea name="comment" required placeholder="Write an update or response..." ${isClosedTicket ? "disabled" : ""}></textarea>
          </label>
          <div class="ticket-view-updatebar">
            <label>
              <span>Update priority</span>
              <select name="priority" required ${isClosedTicket ? "disabled" : ""}>
                ${["Low", "Medium", "High", "Critical"].map((value) => `<option ${ticket.priority === value ? "selected" : ""}>${value}</option>`).join("")}
              </select>
            </label>
            <label>
              <span>Update status</span>
              <select name="status" required ${isClosedTicket ? "disabled" : ""}>
                ${["Open", "In Progress", "Closed", "Cancelled"].map((value) => `<option ${ticket.status === value ? "selected" : ""}>${value}</option>`).join("")}
              </select>
            </label>
            <button class="submit" type="submit" ${isClosedTicket ? "disabled" : ""}>Save Update</button>
          </div>
        </form>` : `<section class="ticket-view-panel"><p class="empty-copy">Support manages this ticket. Updates appear in the conversation above.</p></section>`}
      </main>
    </div>
  `;
}

async function openTicket(ticketId) {
  state.selectedTicketId = ticketId;
  elements.detail.innerHTML = `<div class="ticket-detail-card">Loading ticket...</div>`;
  if (!elements.dialog.open) {
    elements.dialog.showModal();
  }
  const data = await requestJson(`${api.ticket}?ticket_id=${encodeURIComponent(ticketId)}`);
  if (!data?.ticket) {
    state.selectedTicket = null;
    elements.detail.innerHTML = `<div class="ticket-detail-card">Ticket not found.</div>`;
    return;
  }
  state.selectedTicket = data.ticket;
  elements.detail.innerHTML = ticketDetailHtml(data.ticket, data.comments || [], data.attachments || []);
  lookupRegistrationForScope(data.ticket.registration, elements.detail.querySelector('[data-registration-lookup="ticket"]'), data.ticket);
}

async function downloadTicketAttachment(link) {
  const result = await requestJson(link.getAttribute("href"));
  if (!result?.success || !/^data:[^,]*;base64,/i.test(result.dataUrl || "")) {
    throw new Error(result?.message || "Attachment could not be downloaded.");
  }
  const bytes = Uint8Array.from(atob(result.dataUrl.slice(result.dataUrl.indexOf(",") + 1)), character => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const download = document.createElement("a");
  download.href = url;
  download.download = result.filename || "attachment";
  document.body.appendChild(download);
  download.click();
  download.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

elements.detail?.addEventListener("click", event => {
  const link = event.target.closest('[data-ticket-action="download-attachment"]');
  if (!link) return;
  event.preventDefault();
  downloadTicketAttachment(link).catch(error => showNotice(error.message, "error"));
});

document.querySelector('[name="requesterGroup"]')?.addEventListener("change", () => {
  refreshTicketsFromFilters();
});

async function submitForm(url, form) {
  const body = new URLSearchParams(new FormData(form));
  return requestJson(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
}

async function submitMultipartForm(url, form) {
  return requestJson(url, {
    method: "POST",
    body: new FormData(form)
  });
}

elements.filters.addEventListener("input", (event) => {
  if (event.target.matches('input[type="text"]')) {
    window.clearTimeout(elements.filters.filterTimer);
    elements.filters.filterTimer = window.setTimeout(() => {
      refreshTicketsFromFilters();
    }, 250);
  }
});

elements.filters.addEventListener("change", (event) => {
  if (event.target.matches("select")) {
    refreshTicketsFromFilters();
  }
});

elements.filters.addEventListener("submit", (event) => {
  event.preventDefault();
  refreshTicketsFromFilters();
});

elements.clearFiltersButton?.addEventListener("click", () => {
  clearTicketFilters().catch((error) => showNotice(error.message, "error"));
});

elements.dashboardFilters?.addEventListener("submit", (event) => {
  event.preventDefault();
  state.dashboard.filters = Object.fromEntries(new FormData(elements.dashboardFilters));
  const from = state.dashboard.filters.date_from;
  const to = state.dashboard.filters.date_to;
  if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
    setDashboardStatus("From date/time must be before To date/time.", "error");
    return;
  }
  loadDashboard();
});

elements.dashboardResetButton?.addEventListener("click", () => {
  state.dashboard.filters = defaultDashboardFilters();
  syncDashboardFilterControls();
  loadDashboard();
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.currentUserLoaded) {
    await loadCurrentUser();
  }
  if (!String(state.currentUser?.userId ?? "").trim()) {
    showNotice("Your session could not be matched to an internal user record. Ticket creation is blocked until that is fixed.", "error");
    return;
  }
  if (window.InternalTicketAccess.isIBLS(state.currentUser) && elements.form.elements.department?.value !== "Helpdesk") {
    showNotice("IBLS users can only create Helpdesk tickets.", "error");
    return;
  }
  if (elements.form.elements.department?.value === "Software" && String(state.currentUser?.user_type ?? "").trim() !== "7") {
    showNotice("Software tickets are limited to user type 7.", "error");
    return;
  }
  const button = elements.form.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const result = await submitMultipartForm(api.createTicket, elements.form);
    if (!result?.success) throw new Error(result?.message || "Ticket was not created.");
    elements.form.reset();
    registrationLookupRequestId += 1;
    resetRegistrationLookup(document.querySelector('[data-registration-lookup="form"]'));
    syncClientCallbackFields();
    syncAttachmentFilename();
    showNotice(`${result.ticketNumber} created successfully.`);
    await loadTickets();
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

elements.clientCallback?.addEventListener("change", syncClientCallbackFields);
elements.form?.elements.department?.addEventListener("change", syncTicketCategoryOptions);
elements.registrationInput?.addEventListener("input", scheduleFormRegistrationLookup);
elements.registrationInput?.addEventListener("change", scheduleFormRegistrationLookup);
attachmentInput?.addEventListener("change", syncAttachmentFilename);
elements.themeToggle?.addEventListener("change", (event) => {
  setTheme(event.target.checked ? "dark" : "light");
});
elements.sidebarCollapseButton?.addEventListener("click", () => {
  setSidebarCollapsed(!elements.appShell?.classList.contains("sidebar-collapsed"));
});
compactSidebarQuery.addEventListener("change", (event) => {
  if (event.matches) setSidebarCollapsed(true);
});
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

elements.rows.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-ticket-id]");
  if (trigger) openTicket(trigger.dataset.ticketId).catch((error) => showNotice(error.message, "error"));
});

elements.rows.addEventListener("contextmenu", (event) => {
  const trigger = event.target.closest("[data-ticket-id]");
  if (!trigger) return;
  event.preventDefault();
  showRowMenu(trigger.dataset.ticketId, event.clientX, event.clientY);
});

elements.detail.addEventListener("submit", async (event) => {
  if (event.target.id !== "commentForm") return;
  event.preventDefault();
  if (state.selectedTicket?.status === "Closed") return;
  const button = event.target.querySelector("button[type='submit']");
  const chosenStatus = event.target.elements.status?.value;
  if (
    chosenStatus === "Closed"
    && isTruthy(state.selectedTicket?.clientCallbackRequired)
    && !isTruthy(state.selectedTicket?.clientContacted)
  ) {
    showNotice("Client Contacted must be ticked before closing this ticket.", "error");
    return;
  }
  button.disabled = true;
  try {
    const result = await submitForm(api.addComment, event.target);
    if (!result?.success) throw new Error(result?.message || "Comment was not added.");
    if (isFinishedStatus(chosenStatus)) {
      elements.dialog.close();
      state.selectedTicketId = null;
      state.selectedTicket = null;
      await loadTickets();
    } else {
      await openTicket(state.selectedTicketId);
    }
    showNotice("Comment added successfully.");
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

document.addEventListener("click", (event) => {
  const copyButton = event.target.closest("[data-registration-copy]");
  if (!copyButton) return;
  copyTextToClipboard(decodeURIComponent(copyButton.dataset.registrationCopy || ""))
    .then(() => {
      copyButton.textContent = "Copied";
      window.setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1500);
    })
    .catch(() => showNotice("Vehicle info could not be copied.", "error"));
});

document.addEventListener("pointerdown", unlockNotificationAudio, { once: true });
document.addEventListener("keydown", unlockNotificationAudio, { once: true });

elements.detail.addEventListener("click", async (event) => {
  const trigger = event.target.closest("[data-ticket-action='assign-self']");
  if (!trigger) return;
  const ticketId = trigger.dataset.ticketId;
  trigger.disabled = true;
  try {
    await acknowledgeTicket(ticketId);
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    trigger.disabled = false;
  }
});

elements.detail.addEventListener("change", async (event) => {
  const departmentSelect = event.target.closest("[data-ticket-department]");
  if (departmentSelect) {
    const saveButton = departmentSelect.closest(".department-ticket-editor")?.querySelector("[data-ticket-action='save-department']");
    if (saveButton) saveButton.disabled = departmentSelect.value === state.selectedTicket?.department;
    return;
  }
  const trigger = event.target.closest("[data-ticket-action='client-contacted']");
  if (!trigger) return;
  if (state.selectedTicket?.status === "Closed") return;
  trigger.disabled = true;
  try {
    await updateClientContacted(trigger.dataset.ticketId, trigger.checked);
  } catch (error) {
    trigger.checked = !trigger.checked;
    showNotice(error.message, "error");
  } finally {
    trigger.disabled = false;
  }
});

elements.detail.addEventListener("click", async (event) => {
  const trigger = event.target.closest("[data-ticket-action='save-department']");
  if (!trigger) return;
  const select = trigger.closest(".department-ticket-editor")?.querySelector("[data-ticket-department]");
  if (!select) return;
  trigger.disabled = true;
  select.disabled = true;
  try {
    await updateTicketDepartment(trigger.dataset.ticketId, select.value);
  } catch (error) {
    select.disabled = false;
    trigger.disabled = false;
    showNotice(error.message, "error");
  }
});

elements.detail.addEventListener("click", async (event) => {
  const trigger = event.target.closest("[data-ticket-action='edit-zoho-ticket']");
  if (!trigger) return;
  const editor = trigger.closest(".zoho-ticket-editor");
  const input = editor?.querySelector("[data-zoho-ticket-input]");
  const ticketId = editor?.dataset.ticketId;
  if (!input || !ticketId) return;

  if (input.readOnly) {
    input.readOnly = false;
    input.classList.add("is-editing");
    input.focus();
    input.select();
    return;
  }

  await saveZohoTicketInput(input);
});

elements.detail.addEventListener("keydown", async (event) => {
  const input = event.target.closest("[data-zoho-ticket-input]");
  if (!input || input.readOnly) return;

  if (event.key === "Enter") {
    event.preventDefault();
    await saveZohoTicketInput(input);
  } else if (event.key === "Escape") {
    input.value = input.dataset.originalValue || "";
    input.readOnly = true;
    input.classList.remove("is-editing");
  }
});

elements.detail.addEventListener("focusout", async (event) => {
  const input = event.target.closest("[data-zoho-ticket-input]");
  if (!input || input.readOnly) return;
  await saveZohoTicketInput(input);
});

async function saveZohoTicketInput(input) {
  const editor = input.closest(".zoho-ticket-editor");
  const ticketId = editor?.dataset.ticketId;
  if (!ticketId || input.dataset.saving === "1") return;

  const value = input.value.trim();
  const originalValue = input.dataset.originalValue || "";
  if (value === originalValue) {
    input.readOnly = true;
    input.classList.remove("is-editing");
    return;
  }

  input.dataset.saving = "1";
  input.disabled = true;
  try {
    await updateZohoTicket(ticketId, value);
  } catch (error) {
    input.disabled = false;
    input.dataset.saving = "";
    input.focus();
    showNotice(error.message, "error");
  }
}

elements.pagination?.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-page-nav]")?.dataset.pageNav;
  const page = event.target.closest("[data-page-number]")?.dataset.pageNumber;
  const totalPages = Math.max(1, Math.ceil(state.tickets.length / state.pageSize));

  if (nav === "prev") {
    state.page = Math.max(1, state.page - 1);
  } else if (nav === "next") {
    state.page = Math.min(totalPages, state.page + 1);
  } else if (page) {
    state.page = Number(page);
  } else {
    return;
  }

  renderTickets();
});

document.querySelector(".dialog-close").addEventListener("click", () => elements.dialog.close());
document.addEventListener("click", (event) => {
  if (!elements.rowMenu || elements.rowMenu.hidden) return;
  if (event.target.closest("#ticketRowMenu")) return;
  hideRowMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideRowMenu();
});
window.addEventListener("resize", hideRowMenu);
window.addEventListener("scroll", hideRowMenu, true);
elements.rowMenu?.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-menu-action]")?.dataset.menuAction;
  const ticketId = rowMenuState.ticketId;
  if (!action || !ticketId) return;
  hideRowMenu();
  try {
    if (action === "view") {
      await openTicket(ticketId);
    } else if (action === "acknowledge") {
      await acknowledgeTicket(ticketId);
    }
  } catch (error) {
    showNotice(error.message, "error");
  }
});

state.dashboard.filters = defaultDashboardFilters();
syncFilterControls();
syncDashboardFilterControls();
syncThemeToggle();
syncSidebarCollapsed();
renderActiveNav();
syncSidebarGroups();
if (elements.clientCallback) {
  elements.clientCallback.checked = false;
}
syncClientCallbackFields();
syncTicketCategoryOptions();
loadCurrentUser()
  .then((sessionOk) => {
    if (!sessionOk) return null;
    window.setInterval(autoRefreshTickets, 10000);
    return Promise.all([loadJobCounts(), loadOpenQuickLogCount(), loadDashboard(), loadTickets()]);
  })
  .catch(() => Promise.all([
    loadJobCounts().catch(() => {}),
    loadOpenQuickLogCount().catch(() => {}),
    loadDashboard().catch(() => {})
  ]));
