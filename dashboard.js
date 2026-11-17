const isQuickLogDashboard = /(^|\/)quick_log_dashboard\.html$/i.test(window.location.pathname);
const quickLogDashboardConfig = isQuickLogDashboard ? {
  api: "api_quick_log_dashboard.sql",
  title: "Quick Log Dashboard",
  loadingStatus: "Loading quick log dashboard...",
  categoryPlaceholder: "All incident types",
  operatorPlaceholder: "All operators",
  exportFilePrefix: "quick-log-dashboard",
  contributionTicketLabel: "Quick Logs With Communications",
  operatorExportTitle: "Total Quick Logs Per Operator",
  operatorExportMetricLabel: "Total quick logs",
  operatorCallMadeExportTitle: "Total Calls Made Per Operator",
  includeContributionExport: false,
  exportEventOrder: [
    "Panic On",
    "Trailer Disconnect",
    "Door Possible Hijack",
    "Travel Stop",
    "Travel Start",
    "Mounted",
    "Removed",
    "Doors Unlocked",
    "Battery Disconnect",
    "Door Possible Hijack On",
    "Cargo Door Unlock",
    "Unlimp Vehicle"
  ],
  chartLabels: {
    empty: "No operator quick logs match the dashboard filters.",
    event: "Total quick logs",
    contribution: "Total communications",
    averageEvent: "Avg quick logs",
    averageContribution: "Avg communications",
    axis: "Total quick logs and communications",
    aria: "Bar chart of total quick logs and communications by operator",
    meta: "Operators"
  },
  metricLabels: {
    totalTicketsHandled: "Total quick logs",
    totalContributions: "Total communications",
    totalTicketsContributedTo: "Quick logs with communications",
    openTickets: "Open quick logs",
    inProgressTickets: "In progress quick logs",
    completedTickets: "Closed quick logs"
  },
  exportMetricKeys: [
    "totalTicketsHandled"
  ],
  recordTable: {
    key: "closedTickets",
    countLabel: "quick log",
    empty: "No quick logs match the dashboard filters.",
    exportTitle: "Quick Logs",
    includeInExport: false,
    pageSize: 10,
    columns: [
      { key: "ticketNumber", label: "Case" },
      { key: "category", label: "Incident" },
      { key: "registration", label: "Registration" },
      { key: "department", label: "Company" },
      { key: "status", label: "Status", type: "badge", badgePrefix: "status" },
      { key: "assignedToName", label: "Operator" },
      { key: "createdAt", label: "Opened" },
      { key: "closedAt", label: "Last Comm" },
      { key: "contributionCount", label: "Communications", type: "number" },
      { key: "priority", label: "Seat" }
    ]
  }
} : {};

const dashboardConfig = {
  api: "api_dashboard.sql",
  title: "Tickets Dashboard",
  loadingStatus: "Loading dashboard...",
  categoryPlaceholder: "All categories",
  operatorPlaceholder: "All operators",
  exportFilePrefix: "ticket-dashboard",
  operatorExportTitle: "Total Tickets Opened Per Operator",
  operatorExportMetricLabel: "Total tickets opened",
  operatorAssignedExportTitle: "Total Tickets Assigned Per Operator",
  operatorAssignedExportMetricLabel: "Total tickets assigned",
  chartLabels: {
    empty: "No user tickets or contributions match the dashboard filters.",
    event: "Total tickets",
    contribution: "Total contributions",
    averageEvent: "Avg tickets",
    averageContribution: "Avg contributions",
    axis: "Total tickets and contributions",
    aria: "Bar chart of total tickets and total contributions by user",
    meta: "Users"
  },
  metricLabels: {
    totalTicketsHandled: "Total tickets",
    totalContributions: "Total contributions",
    totalTicketsContributedTo: "Tickets contributed to",
    openTickets: "Open tickets",
    inProgressTickets: "In progress tickets",
    completedTickets: "Completed tickets"
  },
  exportMetricKeys: [
    "totalTicketsHandled",
    "totalContributions",
    "totalTicketsContributedTo",
    "openTickets",
    "inProgressTickets",
    "completedTickets"
  ],
  contributionTicketLabel: "Tickets Contributed To",
  includeContributionExport: true,
  recordTable: {
    key: "closedTickets",
    countLabel: "ticket",
    empty: "No closed tickets match the dashboard filters.",
    exportTitle: "Closed Tickets",
    includeInExport: false,
    columns: [
      { key: "ticketNumber", label: "Ticket" },
      { key: "category", label: "Category" },
      { key: "registration", label: "Registration" },
      { key: "department", label: "Department" },
      { key: "priority", label: "Priority", type: "badge", badgePrefix: "priority" },
      { key: "status", label: "Status", type: "badge", badgePrefix: "status" },
      { key: "assignedToName", label: "Assigned To" },
      { key: "createdAt", label: "Created" },
      { key: "closedAt", label: "Closed" },
      { key: "contributionCount", label: "Contributions", type: "number" }
    ]
  },
  ...quickLogDashboardConfig,
  ...(window.dashboardConfig || {})
};
dashboardConfig.chartLabels = {
  empty: "No user tickets or contributions match the dashboard filters.",
  event: "Total tickets",
  contribution: "Total contributions",
  averageEvent: "Avg tickets",
  averageContribution: "Avg contributions",
  axis: "Total tickets and contributions",
  aria: "Bar chart of total tickets and total contributions by user",
  meta: "Users",
  ...(dashboardConfig.chartLabels || {})
};
dashboardConfig.recordTable = {
  key: "closedTickets",
  countLabel: "ticket",
  empty: "No closed tickets match the dashboard filters.",
  exportTitle: "Closed Tickets",
  includeInExport: true,
  columns: [],
  ...(dashboardConfig.recordTable || {})
};
window.dashboardUserBarsLabels = dashboardConfig.chartLabels;

const api = {
  dashboard: dashboardConfig.api,
  currentUser: "api_current_user.sql",
  tickets: "api_tickets.sql",
  jobCounts: "api_job_counts.sql"
};

const sidebarStorageKey = "pulsit-sidebar-collapsed";
const sidebarGroupStorageKey = "pulsit-sidebar-groups";
const compactSidebarQuery = window.matchMedia("(max-width: 980px)");

const state = {
  currentUser: null,
  filters: {},
  data: null,
  recordPage: 1,
  redirectTimer: null
};

const elements = {
  appShell: document.querySelector(".app-shell"),
  sidebarCollapseButton: document.querySelector("#sidebarCollapseButton"),
  themeToggle: document.querySelector("#themeToggle"),
  dashboardSection: document.querySelector("#managerDashboard"),
  denied: document.querySelector("#dashboardDenied"),
  filters: document.querySelector("#dashboardFilters"),
  category: document.querySelector("#dashboardCategory"),
  operator: document.querySelector("#dashboardOperatorFilter"),
  operatorField: document.querySelector(".dashboard-checkbox-filter"),
  operatorToggle: document.querySelector("#dashboardOperatorToggle"),
  operatorPanel: document.querySelector("#dashboardOperatorPanel"),
  operatorSearch: document.querySelector("#dashboardOperatorSearch"),
  operatorList: document.querySelector("#dashboardOperatorList"),
  operatorSummary: document.querySelector("#dashboardOperatorSummary"),
  resetButton: document.querySelector("#dashboardResetButton"),
  exportButton: document.querySelector("#dashboardExportButton"),
  status: document.querySelector("#dashboardStatus"),
  range: document.querySelector("#dashboardRange"),
  userChart: document.querySelector("#dashboardUserBreakdown"),
  userCount: document.querySelector("#dashboardUserCount")
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

function isTruthy(value) {
  return value === true || value === 1 || value === "1";
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString() : "0";
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

function defaultFilters() {
  const now = new Date();
  const from = new Date(now.getTime() - (24 * 60 * 60 * 1000));
  return {
    category: "",
    operator_filter: "",
    date_from: toDateTimeLocalValue(from),
    date_to: toDateTimeLocalValue(now),
    contribution_filter: ""
  };
}

async function requestJson(url, options) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    ...options
  });
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
    const defaultOpen = group === "tickets" || group === "dispatch" || Boolean(section.querySelector(".active, .is-active"));
    setSidebarGroupOpen(section, saved[group] ?? defaultOpen, false);
  }
}

function setStatus(message, type = "muted") {
  elements.status.textContent = message || "";
  elements.status.className = `dashboard-status ${type}`;
  elements.status.hidden = !message;
}

function parseOperatorFilter(value) {
  return String(value || "")
    .split("\u001f")
    .map((item) => item.trim())
    .filter(Boolean);
}

function serializeOperatorFilter(values = []) {
  return Array.from(new Set(values.map((item) => String(item || "").trim()).filter(Boolean))).join("\u001f");
}

function selectedOperatorValues() {
  if (!elements.operatorList) return [];
  return Array.from(elements.operatorList.querySelectorAll("[data-dashboard-operator-option]:checked"))
    .map((input) => input.value);
}

function setOperatorDropdownOpen(open) {
  if (!elements.operatorToggle || !elements.operatorPanel) return;
  elements.operatorToggle.setAttribute("aria-expanded", open ? "true" : "false");
  elements.operatorPanel.hidden = !open;
  elements.operatorField?.classList.toggle("is-open", open);
  if (open) {
    elements.operatorSearch?.focus();
  }
}

function filterOperatorOptions() {
  if (!elements.operatorList) return;
  const term = String(elements.operatorSearch?.value || "").trim().toLowerCase();
  let visibleCount = 0;
  for (const option of elements.operatorList.querySelectorAll("[data-dashboard-operator-row]")) {
    const label = String(option.dataset.operatorLabel || option.textContent || "").toLowerCase();
    const visible = !term || label.includes(term);
    option.hidden = !visible;
    if (visible) visibleCount += 1;
  }
  const empty = elements.operatorList.querySelector("[data-dashboard-operator-empty]");
  if (empty) empty.hidden = visibleCount > 0;
}

function syncOperatorSummary() {
  if (!elements.operatorSummary) return;
  const selected = selectedOperatorValues();
  if (!selected.length) {
    elements.operatorSummary.textContent = dashboardConfig.operatorPlaceholder || "All operators";
  } else if (selected.length === 1) {
    elements.operatorSummary.textContent = selected[0];
  } else {
    elements.operatorSummary.textContent = `${selected.length} operators selected`;
  }
}

function syncOperatorFilterValue() {
  if (!elements.operator) return;
  elements.operator.value = serializeOperatorFilter(selectedOperatorValues());
  syncOperatorSummary();
}

function dashboardLoaderMarkup(message) {
  return `
    <div class="dashboard-loading" aria-live="polite">
      <div aria-label="Orange and tan hamster running in a metal wheel" role="img" class="wheel-and-hamster">
        <div class="wheel"></div>
        <div class="hamster">
          <div class="hamster__body">
            <div class="hamster__head">
              <div class="hamster__ear"></div>
              <div class="hamster__eye"></div>
              <div class="hamster__nose"></div>
            </div>
            <div class="hamster__limb hamster__limb--fr"></div>
            <div class="hamster__limb hamster__limb--fl"></div>
            <div class="hamster__limb hamster__limb--br"></div>
            <div class="hamster__limb hamster__limb--bl"></div>
            <div class="hamster__tail"></div>
          </div>
        </div>
        <div class="spoke"></div>
      </div>
      <strong>${escapeHtml(message)}</strong>
    </div>
  `;
}

function setDashboardLoadingPlaceholders(message) {
  if (elements.status) {
    elements.status.innerHTML = dashboardLoaderMarkup(message);
    elements.status.className = "dashboard-status muted dashboard-status-loading";
    elements.status.hidden = false;
  }
  if (elements.userChart) {
    elements.userChart.innerHTML = dashboardLoaderMarkup(message);
  }
}

function setLoading(loading) {
  for (const control of elements.filters.elements) {
    control.disabled = loading;
  }
  if (elements.exportButton) elements.exportButton.disabled = loading || !state.data;
  if (loading) setDashboardLoadingPlaceholders(dashboardConfig.loadingStatus || "Loading dashboard...");
}

function restrictedLoaderMarkup() {
  return `
    <div class="restricted-redirect-loader" role="status" aria-live="polite">
      <div class="uiverse-signin-loader" aria-hidden="true">
        <div class="uiverse-signin-loader__ring"></div>
        <div class="uiverse-signin-loader__ring"></div>
        <div class="uiverse-signin-loader__ring"></div>
        <div class="uiverse-signin-loader__dot"></div>
      </div>
      <span class="manager-dashboard-eyebrow">Restricted</span>
      <h2>Redirecting to sign in</h2>
      <p class="empty-copy">This dashboard is only available to usertype 7 users.</p>
    </div>
  `;
}

function showDeniedRedirect() {
  if (!elements.denied) return;
  elements.dashboardSection.hidden = true;
  elements.denied.hidden = false;
  elements.denied.innerHTML = restrictedLoaderMarkup();
  if (state.redirectTimer) window.clearTimeout(state.redirectTimer);
  state.redirectTimer = window.setTimeout(() => {
    window.location.href = "/signin.sql";
  }, 2000);
}

function syncFilterControls() {
  for (const [name, value] of Object.entries(state.filters)) {
    const control = elements.filters.elements[name];
    if (control) control.value = value || "";
  }
  if (elements.operatorList) {
    const selected = new Set(parseOperatorFilter(state.filters.operator_filter));
    for (const checkbox of elements.operatorList.querySelectorAll("[data-dashboard-operator-option]")) {
      checkbox.checked = selected.has(checkbox.value);
    }
    syncOperatorFilterValue();
  }
}

function readDashboardFilters() {
  const filters = Object.fromEntries(new FormData(elements.filters));
  filters.operator_filter = serializeOperatorFilter(selectedOperatorValues());
  return filters;
}

function queryFromFilters() {
  return new URLSearchParams(
    Object.entries(state.filters).filter(([, value]) => String(value || "").trim())
  );
}

function formatRange() {
  const from = state.filters.date_from;
  const to = state.filters.date_to;
  if (!from && !to) return "All time";
  if (from && to) return `${from.replace("T", " ")} to ${to.replace("T", " ")}`;
  if (from) return `From ${from.replace("T", " ")}`;
  return `Until ${to.replace("T", " ")}`;
}

function renderCategoryOptions(categories = []) {
  if (!elements.category) return;
  const current = elements.category.value;
  const options = categories
    .map((category) => {
      const value = String(category?.value || "").trim();
      const label = String(category?.label || value).trim();
      if (!value) return "";
      return `<option value="${escapeHtml(value)}">${escapeHtml(label || value)}</option>`;
    })
    .filter(Boolean);
  elements.category.innerHTML = `<option value="">${escapeHtml(dashboardConfig.categoryPlaceholder || "All categories")}</option>${options.join("")}`;
  elements.category.value = current;
}

function renderOperatorOptions(operators = []) {
  if (!elements.operatorList) return;
  const selected = new Set(parseOperatorFilter(state.filters.operator_filter || elements.operator?.value));
  const options = operators
    .map((operator) => {
      const value = String(operator?.value || "").trim();
      const label = String(operator?.label || value).trim();
      if (!value) return "";
      return `
        <label class="dashboard-checkbox-filter-option" data-dashboard-operator-row data-operator-label="${escapeHtml(label || value)}">
          <input type="checkbox" value="${escapeHtml(value)}" data-dashboard-operator-option${selected.has(value) ? " checked" : ""}>
          <span>${escapeHtml(label || value)}</span>
        </label>
      `;
    })
    .filter(Boolean);
  elements.operatorList.innerHTML = options.length
    ? `${options.join("")}<span class="dashboard-checkbox-filter-empty" data-dashboard-operator-empty hidden>No matching operators</span>`
    : `<span class="dashboard-checkbox-filter-option">${escapeHtml(dashboardConfig.operatorPlaceholder || "All operators")}</span>`;
  filterOperatorOptions();
  syncOperatorFilterValue();
}

function renderMetrics(metrics = {}) {
  for (const target of document.querySelectorAll("[data-dashboard-metric]")) {
    target.textContent = formatNumber(metrics[target.dataset.dashboardMetric]);
  }
}

function renderChart(target, items, configFactory, emptyMessage) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) {
    target.innerHTML = `<p class="dashboard-empty">${escapeHtml(emptyMessage)}</p>`;
    return;
  }
  const max = Math.max(...rows.map((item) => Number(configFactory(item).value || 0)), 1);
  target.innerHTML = rows.map((item) => {
    const config = configFactory(item);
    const value = Number(config.value || 0);
    const height = Math.max(8, Math.round((value / max) * 150));
    return `
      <article class="dashboard-bar-item" style="--bar-height: ${height}px">
        <div class="dashboard-bar-track"><span></span></div>
        <strong>${formatNumber(value)}</strong>
        <span>${escapeHtml(config.label)}</span>
        <small>${escapeHtml(config.meta || "")}</small>
      </article>
    `;
  }).join("");
}

function userSeriesKey(item) {
  const userId = item?.userId ?? item?.UserID ?? item?.userID;
  if (userId !== null && userId !== undefined && String(userId).trim() !== "") {
    return `id:${String(userId).trim()}`;
  }
  return `name:${String(item?.userName || "Unassigned").trim().toLowerCase()}`;
}

function combineUserSeries(eventsByUser = [], contributionsByUser = []) {
  const users = new Map();
  const ensureUser = (item) => {
    const label = String(item?.userName || "Unassigned").trim() || "Unassigned";
    const key = userSeriesKey({ ...item, userName: label });
    if (!users.has(key)) {
      users.set(key, {
        key,
        userId: item?.userId ?? null,
        userName: label,
        eventCount: 0,
        contributionCount: 0,
        ticketCount: 0
      });
    }
    return users.get(key);
  };

  for (const item of Array.isArray(eventsByUser) ? eventsByUser : []) {
    const user = ensureUser(item);
    user.eventCount += Number(item?.eventCount || 0);
  }
  for (const item of Array.isArray(contributionsByUser) ? contributionsByUser : []) {
    const user = ensureUser(item);
    user.contributionCount += Number(item?.contributionCount || 0);
    user.ticketCount += Number(item?.ticketCount || 0);
  }

  return Array.from(users.values())
    .sort((a, b) => (b.eventCount + b.contributionCount) - (a.eventCount + a.contributionCount) || a.userName.localeCompare(b.userName));
}

function renderUserBarsFallback(users = []) {
  if (!elements.userChart) return;
  if (!users.length) {
    elements.userChart.innerHTML = `<p class="dashboard-empty">${escapeHtml(dashboardConfig.chartLabels.empty)}</p>`;
    return;
  }
  const maxValue = Math.max(...users.flatMap((user) => [Number(user.eventCount || 0), Number(user.contributionCount || 0)]), 1);
  const averageEvents = users.reduce((sum, user) => sum + Number(user.eventCount || 0), 0) / Math.max(users.length, 1);
  const averageContributions = users.reduce((sum, user) => sum + Number(user.contributionCount || 0), 0) / Math.max(users.length, 1);
  const scaleMax = Math.max(maxValue, averageEvents, averageContributions);
  const chartMax = scaleMax <= 5 ? 5 : Math.ceil(scaleMax / Math.pow(10, Math.floor(Math.log10(scaleMax)))) * Math.pow(10, Math.floor(Math.log10(scaleMax)));
  const dense = users.length > 28;
  const compact = users.length > 16;
  const medium = users.length > 8;
  const chartTop = 22;
  const chartHeight = dense ? 196 : compact ? 210 : 224;
  const chartLeft = 74;
  const groupWidth = dense ? 48 : compact ? 58 : medium ? 70 : 84;
  const barWidth = dense ? 12 : compact ? 15 : medium ? 18 : 22;
  const barGap = dense ? 4 : compact ? 5 : 6;
  const labelLength = dense ? 8 : compact ? 10 : medium ? 13 : 16;
  const plotWidth = Math.max(users.length * groupWidth, 520);
  const width = chartLeft + plotWidth + 24;
  const height = chartTop + chartHeight + (dense ? 96 : 104);
  const baseline = chartTop + chartHeight;
  const ticks = [0, .25, .5, .75, 1].map((ratio) => Math.round(chartMax * ratio));
  const truncateFallbackLabel = (value) => {
    const label = String(value || "Unassigned");
    return label.length > labelLength ? `${label.slice(0, Math.max(labelLength - 1, 3))}...` : label;
  };
  elements.userChart.innerHTML = `
    <div class="dashboard-react-shell">
      <div class="dashboard-react-legend">
        <span><i class="dashboard-react-dot dashboard-react-dot-blue"></i>${escapeHtml(dashboardConfig.chartLabels.event)}</span>
        <span><i class="dashboard-react-dot dashboard-react-dot-indigo"></i>${escapeHtml(dashboardConfig.chartLabels.contribution)}</span>
        <span><i class="dashboard-react-line dashboard-react-line-blue"></i>${escapeHtml(dashboardConfig.chartLabels.averageEvent)}</span>
        <span><i class="dashboard-react-line dashboard-react-line-indigo"></i>${escapeHtml(dashboardConfig.chartLabels.averageContribution)}</span>
      </div>
      <div class="dashboard-react-scroll" role="img" aria-label="${escapeHtml(dashboardConfig.chartLabels.aria)}">
        <svg class="dashboard-react-svg" viewBox="0 0 ${width} ${height}" style="min-width: ${width}px" preserveAspectRatio="xMinYMin meet" aria-hidden="true">
          <text x="18" y="${chartTop + (chartHeight / 2)}" transform="rotate(-90 18 ${chartTop + (chartHeight / 2)})" text-anchor="middle" fill="currentColor" font-size="12" font-weight="900">${escapeHtml(dashboardConfig.chartLabels.axis)}</text>
          <line x1="${chartLeft}" y1="${chartTop}" x2="${chartLeft}" y2="${baseline}" class="dashboard-react-axis-line" stroke="currentColor"></line>
          <line x1="${chartLeft}" y1="${baseline}" x2="${width - 18}" y2="${baseline}" class="dashboard-react-axis-line" stroke="currentColor"></line>
          ${ticks.map((tick) => {
            const y = chartTop + chartHeight - ((tick / chartMax) * chartHeight);
            return `<line x1="${chartLeft}" y1="${y}" x2="${width - 18}" y2="${y}" stroke="rgba(148, 163, 184, .24)" stroke-width="1"></line><text x="${chartLeft - 12}" y="${y + 4}" text-anchor="end" fill="currentColor" font-size="11" font-weight="800">${formatNumber(tick)}</text>`;
          }).join("")}
          ${[
            { value: averageEvents, color: "#3b82f6", label: `${dashboardConfig.chartLabels.averageEvent} ${formatNumber(Math.round(averageEvents))}` },
            { value: averageContributions, color: "#6366f1", label: `${dashboardConfig.chartLabels.averageContribution} ${formatNumber(Math.round(averageContributions))}` }
          ].map((average) => {
            const y = chartTop + chartHeight - ((average.value / chartMax) * chartHeight);
            return `<line x1="${chartLeft}" y1="${y}" x2="${width - 18}" y2="${y}" stroke="${average.color}" stroke-width="2" stroke-dasharray="6 5" opacity=".88"></line><text x="${width - 22}" y="${y - 6}" text-anchor="end" fill="${average.color}" font-size="10" font-weight="900">${average.label}</text>`;
          }).join("")}
          ${users.flatMap((user, index) => {
            const groupX = chartLeft + (index * groupWidth) + Math.max(10, Math.round((groupWidth - ((barWidth * 2) + barGap)) / 2));
            const eventValue = Number(user.eventCount || 0);
            const contributionValue = Number(user.contributionCount || 0);
            const eventHeight = Math.max(eventValue ? 4 : 0, (eventValue / chartMax) * chartHeight);
            const contributionHeight = Math.max(contributionValue ? 4 : 0, (contributionValue / chartMax) * chartHeight);
            const label = String(user.userName || "Unassigned");
            const shortLabel = truncateFallbackLabel(label);
            const groupCenter = groupX + barWidth + (barGap / 2);
            return [
              `<g class="dashboard-react-group" data-dashboard-tooltip-user="${escapeHtml(label)}" data-dashboard-tooltip-events="${formatNumber(eventValue)}" data-dashboard-tooltip-contributions="${formatNumber(contributionValue)}">`,
              `<rect x="${chartLeft + (index * groupWidth)}" y="${chartTop}" width="${groupWidth}" height="${chartHeight + 54}" fill="transparent" pointer-events="all"></rect>`,
              `<rect x="${groupX}" y="${baseline - eventHeight}" width="${barWidth}" height="${eventHeight}" rx="8" fill="#3b82f6"></rect>`,
              `<rect x="${groupX + barWidth + barGap}" y="${baseline - contributionHeight}" width="${barWidth}" height="${contributionHeight}" rx="8" fill="#6366f1"></rect>`,
              `<text x="${groupX + (barWidth / 2)}" y="${baseline - eventHeight - 7}" text-anchor="middle" fill="currentColor" font-size="${groupWidth < 58 ? 9 : 10}" font-weight="900">${eventValue ? formatNumber(eventValue) : ""}</text>`,
              `<text x="${groupX + barWidth + barGap + (barWidth / 2)}" y="${baseline - contributionHeight - 7}" text-anchor="middle" fill="currentColor" font-size="${groupWidth < 58 ? 9 : 10}" font-weight="900">${contributionValue ? formatNumber(contributionValue) : ""}</text>`,
              `<text x="${groupCenter}" y="${baseline + 26}" text-anchor="end" transform="rotate(-35 ${groupCenter} ${baseline + 26})" fill="currentColor" font-size="10" font-weight="900">${escapeHtml(shortLabel)}</text></g>`
            ];
          }).flat().join("")}
          <text x="${chartLeft + (plotWidth / 2)}" y="${height - 12}" text-anchor="middle" fill="currentColor" font-size="12" font-weight="900">${escapeHtml(dashboardConfig.chartLabels.meta)}</text>
        </svg>
      </div>
      <div class="dashboard-react-tooltip" data-dashboard-fallback-tooltip hidden></div>
    </div>
  `;
  const tooltip = elements.userChart.querySelector("[data-dashboard-fallback-tooltip]");
  const positionTooltip = (event, target) => {
    if (!tooltip || !target) return;
    const tooltipWidth = 250;
    const tooltipHeight = 132;
    const x = Math.min(event.clientX + 14, window.innerWidth - tooltipWidth - 12);
    const y = Math.min(event.clientY + 14, window.innerHeight - tooltipHeight - 12);
    tooltip.style.left = `${Math.max(12, x)}px`;
    tooltip.style.top = `${Math.max(12, y)}px`;
    tooltip.innerHTML = `
      <strong>${escapeHtml(target.dataset.dashboardTooltipUser || "Unassigned")}</strong>
      <span>${escapeHtml(dashboardConfig.chartLabels.event)}: <b>${escapeHtml(target.dataset.dashboardTooltipEvents || "0")}</b></span>
      <span>${escapeHtml(dashboardConfig.chartLabels.contribution)}: <b>${escapeHtml(target.dataset.dashboardTooltipContributions || "0")}</b></span>
      <small>${escapeHtml(dashboardConfig.chartLabels.averageEvent)} ${formatNumber(Math.round(averageEvents))} | ${escapeHtml(dashboardConfig.chartLabels.averageContribution)} ${formatNumber(Math.round(averageContributions))}</small>
    `;
    tooltip.hidden = false;
  };
  elements.userChart.onpointermove = (event) => {
    const target = event.target.closest?.("[data-dashboard-tooltip-user]");
    if (!target) {
      if (tooltip) tooltip.hidden = true;
      return;
    }
    positionTooltip(event, target);
  };
  elements.userChart.onpointerleave = () => {
    if (tooltip) tooltip.hidden = true;
  };
}

function renderUserBars(data = {}) {
  const eventsByUser = data.eventsByUser || [];
  const contributionsByUser = data.contributionsByUser || [];
  const users = combineUserSeries(eventsByUser, contributionsByUser);
  if (elements.userCount) {
    const label = String(dashboardConfig.chartLabels.meta || "Users").toLowerCase();
    const singular = label.endsWith("s") ? label.slice(0, -1) : label;
    elements.userCount.textContent = `${users.length} ${users.length === 1 ? singular : label}`;
  }
  const payload = {
    users,
    eventsByUser,
    contributionsByUser,
    rangeLabel: formatRange(),
    labels: dashboardConfig.chartLabels
  };
  if (typeof window.renderDashboardUserBars === "function") {
    window.renderDashboardUserBars(payload);
  } else {
    window.dispatchEvent(new CustomEvent("dashboard:user-bars", { detail: payload }));
  }
  if (!window.dashboardUserBarsReady && typeof window.renderDashboardUserBars !== "function") {
    renderUserBarsFallback(users);
  }
}

function renderDashboard(data = {}) {
  const metrics = data.metrics || {};

  state.data = data;
  renderCategoryOptions(data.categories || []);
  renderOperatorOptions(data.operators || []);
  syncFilterControls();
  renderMetrics(metrics);
  elements.range.textContent = formatRange();
  renderUserBars(data);
  if (elements.exportButton) elements.exportButton.disabled = false;
}

async function loadDashboard() {
  if (!canViewDashboard()) return;
  state.recordPage = 1;
  setLoading(true);
  try {
    const data = await requestJson(`${api.dashboard}?${queryFromFilters().toString()}`);
    if (!isTruthy(data?.accessAllowed)) {
      showDeniedRedirect();
      return;
    }
    renderDashboard(data);
    setStatus("", "muted");
  } catch (error) {
    setStatus(error.message || "Dashboard could not be loaded.", "error");
    if (elements.userChart) {
      elements.userChart.innerHTML = `<p class="dashboard-empty">${escapeHtml(dashboardConfig.chartLabels.empty)}</p>`;
    }
  } finally {
    setLoading(false);
  }
}

async function loadCurrentUser() {
  try {
    state.currentUser = await requestJson(api.currentUser);
  } catch (error) {
    state.currentUser = null;
    setStatus("Could not verify your session. Please refresh and try again.", "error");
    return false;
  }
  if (window.InternalTicketSessionGuard?.isMissingSession(state.currentUser)) {
    window.InternalTicketSessionGuard.showMissingSession();
    return false;
  }
  syncSidebarAccess();
  const allowed = canViewDashboard();
  if (!allowed) {
    showDeniedRedirect();
    return false;
  }
  elements.dashboardSection.hidden = false;
  elements.denied.hidden = true;
  return true;
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

async function loadCounts() {
  try {
    const [ticketData, jobData] = await Promise.all([
      requestJson(api.tickets),
      requestJson(api.jobCounts).catch(() => ({}))
    ]);
    const stats = ticketData?.stats || {};
    const activeCount = Number(stats.openCount || 0) + Number(stats.inProgressCount || 0) + Number(stats.waitingCount || 0);
    const navCounts = {
      active: activeCount,
      helpdesk: Number(stats.helpdeskCount || 0),
    callcentre: Number(stats.callCentreCount || 0),
      pulscam: Number(stats.pulscamCount || 0),
      tad: Number(stats.tadCount || 0)
    };
    for (const [key, value] of Object.entries(navCounts)) {
      const target = document.querySelector(`[data-nav-count="${key}"]`);
      if (target) target.textContent = value;
    }
    renderJobCounts(jobData || {});
  } catch {
    renderJobCounts({});
  }
}

function sheetRows(title, rows, columns) {
  const header = `<tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>`;
  const body = rows.length
    ? rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column.key] ?? "")}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${columns.length}">No rows</td></tr>`;
  return `<h2>${escapeHtml(title)}</h2><table border="1">${header}${body}</table>`;
}

function uniqueExportValues(values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function operatorEventSummaryRows(totals = [], categoryOptions = []) {
  const availableCategories = new Set(
    uniqueExportValues(totals.map((total) => total?.category))
  );
  const categories = uniqueExportValues([
    ...categoryOptions.map((category) => typeof category === "string" ? category : category?.label || category?.value),
    ...totals.map((total) => total?.category)
  ]).filter((category) => availableCategories.has(category));
  const operators = uniqueExportValues(totals.map((total) => total?.operatorName));
  const countByOperatorAndCategory = new Map();

  for (const total of totals) {
    const operatorName = String(total?.operatorName || "").trim();
    const category = String(total?.category || "").trim();
    if (!operatorName || !category) continue;
    countByOperatorAndCategory.set(`${operatorName}\u001f${category}`, Number(total?.logCount || 0));
  }

  return {
    columns: [
      { key: "operatorName", label: "Operators" },
      ...categories.map((category) => ({ key: category, label: category }))
    ],
    rows: operators.map((operatorName) => {
      const row = { operatorName };
      for (const category of categories) {
        row[category] = countByOperatorAndCategory.get(`${operatorName}\u001f${category}`) || 0;
      }
      return row;
    })
  };
}

function operatorTicketSummaryRows(totals = [], metricLabel = dashboardConfig.chartLabels.event) {
  const rows = (Array.isArray(totals) ? totals : [])
    .map((total) => ({
      operatorName: String(total?.operatorName || total?.userName || "").trim(),
      ticketCount: Number(total?.ticketCount ?? total?.eventCount ?? 0)
    }))
    .filter((row) => row.operatorName);

  return {
    columns: [
      { key: "operatorName", label: "Operator" },
      { key: "ticketCount", label: metricLabel }
    ],
    rows
  };
}

function operatorCallMadeSummaryRows(totals = []) {
  const rows = (Array.isArray(totals) ? totals : [])
    .map((total) => ({
      operatorName: String(total?.operatorName || total?.userName || "").trim(),
      callCount: Number(total?.callCount ?? 0)
    }))
    .filter((row) => row.operatorName);

  return {
    columns: [
      { key: "operatorName", label: "Operator" },
      { key: "callCount", label: "Total calls made" }
    ],
    rows
  };
}

function exportDashboard() {
  if (!state.data) return;
  const metrics = state.data.metrics || {};
  const metricLabels = dashboardConfig.metricLabels || {};
  const exportMetricKeys = Array.isArray(dashboardConfig.exportMetricKeys) ? dashboardConfig.exportMetricKeys : Object.keys(metrics);
  const metricRows = exportMetricKeys
    .filter((metric) => Object.prototype.hasOwnProperty.call(metrics, metric))
    .map((metric) => ({ metric: metricLabels[metric] || metric, value: metrics[metric] }));
  const recordRows = state.data[dashboardConfig.recordTable.key] || [];
  const recordColumns = dashboardConfig.recordTable.columns || [];
  const includeContributionExport = dashboardConfig.includeContributionExport !== false;
  const includeRecordExport = dashboardConfig.recordTable.includeInExport !== false;
  const hasOperatorEventTotals = Array.isArray(state.data.operatorEventTotals);
  const hasOperatorCallMadeTotals = Array.isArray(state.data.operatorCallMadeTotals);
  const operatorEventSummary = operatorEventSummaryRows(
    state.data.operatorEventTotals || [],
    [
      ...(dashboardConfig.exportEventOrder || []),
      ...(state.data.categories || [])
    ]
  );
  const operatorOpenedSummary = operatorTicketSummaryRows(
    state.data.eventsByUser || [],
    dashboardConfig.operatorExportMetricLabel || dashboardConfig.chartLabels.event
  );
  const operatorAssignedSummary = operatorTicketSummaryRows(
    state.data.operatorTicketTotals || [],
    dashboardConfig.operatorAssignedExportMetricLabel || dashboardConfig.chartLabels.event
  );
  const operatorCallMadeSummary = operatorCallMadeSummaryRows(
    state.data.operatorCallMadeTotals || []
  );
  const workbook = `
    <html><head><meta charset="utf-8"></head><body>
      ${sheetRows("Metrics", metricRows, [
        { key: "metric", label: "Metric" },
        { key: "value", label: "Value" }
      ])}
      ${sheetRows(`${dashboardConfig.title} Categories`, state.data.ticketsByCategory || [], [
        { key: "category", label: "Category" },
        { key: "ticketCount", label: dashboardConfig.chartLabels.event },
        { key: "contributionCount", label: dashboardConfig.chartLabels.contribution }
      ])}
      ${sheetRows(dashboardConfig.operatorExportTitle || dashboardConfig.chartLabels.event, operatorOpenedSummary.rows, operatorOpenedSummary.columns)}
      ${state.data.operatorTicketTotals ? sheetRows(dashboardConfig.operatorAssignedExportTitle || "Total Tickets Assigned Per Operator", operatorAssignedSummary.rows, operatorAssignedSummary.columns) : ""}
      ${hasOperatorEventTotals ? sheetRows("Total logs per operator per event", operatorEventSummary.rows, operatorEventSummary.columns) : ""}
      ${includeContributionExport ? sheetRows(dashboardConfig.chartLabels.contribution, state.data.contributionsByUser || [], [
        { key: "userName", label: dashboardConfig.chartLabels.meta },
        { key: "contributionCount", label: dashboardConfig.chartLabels.contribution },
        { key: "ticketCount", label: dashboardConfig.contributionTicketLabel || "Records With Communications" }
      ]) : ""}
      ${includeRecordExport ? sheetRows(dashboardConfig.recordTable.exportTitle || "Records", recordRows, recordColumns) : ""}
      ${hasOperatorCallMadeTotals ? sheetRows(dashboardConfig.operatorCallMadeExportTitle || "Total Calls Made Per Operator", operatorCallMadeSummary.rows, operatorCallMadeSummary.columns) : ""}
    </body></html>
  `;
  const blob = new Blob([workbook], { type: "application/vnd.ms-excel" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${dashboardConfig.exportFilePrefix || "dashboard"}-${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

elements.filters.addEventListener("submit", (event) => {
  event.preventDefault();
  state.filters = readDashboardFilters();
  if (state.filters.date_from && state.filters.date_to && new Date(state.filters.date_from) > new Date(state.filters.date_to)) {
    setStatus("From date/time must be before To date/time.", "error");
    return;
  }
  loadDashboard();
});

elements.operatorList?.addEventListener("change", () => {
  syncOperatorFilterValue();
});

elements.operatorToggle?.addEventListener("click", () => {
  setOperatorDropdownOpen(elements.operatorToggle.getAttribute("aria-expanded") !== "true");
});

elements.operatorSearch?.addEventListener("input", filterOperatorOptions);

elements.operatorSearch?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setOperatorDropdownOpen(false);
    elements.operatorToggle?.focus();
  }
});

document.addEventListener("click", (event) => {
  if (!elements.operatorField || !elements.operatorToggle || elements.operatorPanel?.hidden) return;
  if (!elements.operatorField.contains(event.target)) {
    setOperatorDropdownOpen(false);
  }
});

elements.resetButton.addEventListener("click", () => {
  state.filters = defaultFilters();
  syncFilterControls();
  if (elements.operatorSearch) {
    elements.operatorSearch.value = "";
    filterOperatorOptions();
  }
  setOperatorDropdownOpen(false);
  loadDashboard();
});

elements.exportButton?.addEventListener("click", exportDashboard);
elements.themeToggle?.addEventListener("change", (event) => setTheme(event.target.checked ? "dark" : "light"));
elements.sidebarCollapseButton?.addEventListener("click", () => setSidebarCollapsed(!elements.appShell?.classList.contains("sidebar-collapsed")));
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

state.filters = defaultFilters();
syncFilterControls();
syncThemeToggle();
syncSidebarCollapsed();
syncSidebarGroups();
loadCurrentUser()
  .then((sessionOk) => sessionOk ? Promise.all([loadCounts(), loadDashboard()]) : null)
  .catch(() => loadCounts().catch(() => {}));
