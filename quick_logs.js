const completedQuickLogsView = document.body.dataset.quickLogView === "completed";
const api = {
  currentUser: "api_current_user.sql",
  tickets: "api_tickets.sql",
  escalations: "api_escalations.sql",
  communicationOptions: "/CC_Escalation/api_quick_log_options.sql",
  registrationAccount: "api_quick_log_account.sql",
  openQuickLogs: completedQuickLogsView ? "api_completed_quick_logs.sql" : "api_open_quick_logs.sql",
  openQuickLogCount: "api_open_quick_logs_count.sql",
  logCommunicationSubmit: "api_log_communication_submit.sql"
};

const sidebarStorageKey = "pulsit-sidebar-collapsed";
const sidebarGroupStorageKey = "pulsit-sidebar-groups";
const compactSidebarQuery = window.matchMedia("(max-width: 980px)");
let draggedCommunicationRow = null;
let communicationDraftKey = null;
let communicationDraftRaw = null;
let communicationSubmitting = false;
let communicationSubmissionId = null;
let communicationSubmissionProtocol = null;
let communicationAttemptFingerprint = null;
let communicationCategoryActiveIndex = -1;
let communicationAccountLookupVersion = 0;
let communicationAccountChoiceVersion = 0;
let communicationAccountLookupTimer = null;
let communicationAutoAccountReg = null;

const state = {
  currentUser: null,
  rows: [],
  communicationOptions: null,
  logCommunicationZohoOptions: [],
  suggestedAccount: null,
  openQuickLogs: [],
  openQuickLogsTotal: null,
  browserDrafts: [],
  page: 0,
  pageSize: 100,
  selectedQuickLogId: "",
  quickLogFilters: {}
};

const elements = {
  appShell: document.querySelector(".app-shell"),
  sidebarCollapseButton: document.querySelector("#sidebarCollapseButton"),
  themeToggle: document.querySelector("#themeToggle"),
  notice: document.querySelector("#notice"),
  logCommunicationDialog: document.querySelector("#logCommunicationDialog"),
  logCommunicationDialogClose: document.querySelector("#logCommunicationDialogClose"),
  logCommunicationForm: document.querySelector("#logCommunicationForm"),
  logCommunicationMessage: document.querySelector("#logCommunicationMessage"),
  logCommunicationCaseId: document.querySelector("#logCommunicationCaseId"),
  logCommunicationReg: document.querySelector("#logCommunicationReg"),
  logCommunicationCategory: document.querySelector("#logCommunicationCategory"),
  logCommunicationCategoryPicker: document.querySelector("#logCommunicationCategoryPicker"),
  logCommunicationCategoryTrigger: document.querySelector("#logCommunicationCategoryTrigger"),
  logCommunicationCategoryValue: document.querySelector("#logCommunicationCategoryValue"),
  logCommunicationCategoryMenu: document.querySelector("#logCommunicationCategoryMenu"),
  logCommunicationCategorySearch: document.querySelector("#logCommunicationCategorySearch"),
  logCommunicationCategoryOptions: document.querySelector("#logCommunicationCategoryOptions"),
  logCommunicationCategoryEmpty: document.querySelector("#logCommunicationCategoryEmpty"),
  logCommunicationZohoSearch: document.querySelector("#logCommunicationZohoSearch"),
  logCommunicationZoho: document.querySelector("#logCommunicationZoho"),
  logCommunicationZohoOptions: document.querySelector("#logCommunicationZohoOptions"),
  logCommunicationAccountHint: document.querySelector("#logCommunicationAccountHint"),
  logCommunicationSeat: document.querySelector("#logCommunicationSeat"),
  logCommunicationHistoryCount: document.querySelector("#logCommunicationHistoryCount"),
  logCommunicationHistoryList: document.querySelector("#logCommunicationHistoryList"),
  logCommunicationRows: document.querySelector("#logCommunicationRows"),
  logCommunicationAddRow: document.querySelector("#logCommunicationAddRow"),
  logCommunicationSummary: document.querySelector("#logCommunicationSummary"),
  logCommunicationClose: document.querySelector("#logCommunicationClose"),
  logCommunicationOperator: document.querySelector("#logCommunicationOperator"),
  logCommunicationDraftStatus: document.querySelector("#logCommunicationDraftStatus"),
  logCommunicationSaveDraft: document.querySelector("#logCommunicationSaveDraft"),
  logCommunicationSubmit: document.querySelector("#logCommunicationSubmit"),
  logCommunicationEntryCount: document.querySelector("#logCommunicationEntryCount"),
  logCommunicationHistory: document.querySelector("#logCommunicationHistory"),
  quickLogHistoryCount: document.querySelector("#quickLogHistoryCount"),
  quickLogHistoryList: document.querySelector("#quickLogHistoryList"),
  quickLogHistoryRefresh: document.querySelector("#quickLogHistoryRefresh"),
  quickLogPreviousPage: document.querySelector("#quickLogPreviousPage"),
  quickLogNextPage: document.querySelector("#quickLogNextPage"),
  createQuickLog: document.querySelector("#createQuickLog"),
  quickLogFilters: document.querySelector("#quickLogFilters"),
  clearQuickLogFilters: document.querySelector("#clearQuickLogFilters"),
  quickLogFilterCount: document.querySelector("#quickLogFilterCount")
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

function clearLogCommunicationMessage() {
  if (!elements.logCommunicationMessage) return;
  elements.logCommunicationMessage.hidden = true;
  elements.logCommunicationMessage.textContent = "";
  delete elements.logCommunicationMessage.dataset.type;
}

function showLogCommunicationMessage(message, type = "info") {
  if (!elements.logCommunicationMessage) return;
  elements.logCommunicationMessage.hidden = false;
  elements.logCommunicationMessage.textContent = message;
  elements.logCommunicationMessage.dataset.type = type;
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

function localDateTimeValue(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function logCommunicationTypes(selectedValue = "") {
  const options = (state.communicationOptions?.commTypes || [
    { value: "Call Made", label: "Call Made" },
    { value: "Call Received", label: "Call Received" },
    { value: "WhatsApp Sent", label: "WhatsApp Sent" },
    { value: "WhatsApp Received", label: "WhatsApp Received" }
  ]).filter((option) => String(option.value || option.label || "").trim() !== "...");
  return [
    '<option value="">Select comm type...</option>',
    ...options.map((option) => {
      const value = option.value || option.label || "";
      const selected = String(value).toLowerCase() === String(selectedValue).toLowerCase() ? " selected" : "";
      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(option.label || value)}</option>`;
    })
  ].join("");
}

function logCommunicationSeatOptions(selectedValue = "") {
  const selected = String(selectedValue || "").trim().toLowerCase();
  const options = (state.communicationOptions?.seats || [])
    .filter((option) => String(option.value || option.label || "").trim() !== "...")
    .filter((option) => String(option.label || option.value || "").trim() !== "...")
    .filter((option) => String(option.label || option.value || "").trim().toLowerCase() !== "wrc");
  return [
    '<option value="">Select seat...</option>',
    ...options.map((option) => {
      const value = String(option.value || "").trim();
      const label = String(option.label || value).trim();
      const isSelected = selected
        && (String(value).toLowerCase() === selected || label.toLowerCase() === selected);
      return `<option value="${escapeHtml(value)}"${isSelected ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
  ].join("");
}

function populateLogCommunicationSeats(selectedValue = "") {
  if (!elements.logCommunicationSeat) return;
  elements.logCommunicationSeat.innerHTML = logCommunicationSeatOptions(selectedValue);
}

function filteredCommunicationCategories() {
  const query = String(elements.logCommunicationCategorySearch?.value || "").trim().toLowerCase();
  return [...(elements.logCommunicationCategory?.options || [])]
    .filter(option => option.value)
    .map((option, index) => ({value: option.value, label: option.label || option.value, id: `logCommunicationCategoryOption-${index}`}))
    .filter(option => option.label.toLowerCase().includes(query));
}

function renderCommunicationCategoryOptions(activeIndex = 0) {
  if (!elements.logCommunicationCategoryOptions) return;
  const options = filteredCommunicationCategories();
  communicationCategoryActiveIndex = options.length ? Math.max(0, Math.min(activeIndex, options.length - 1)) : -1;
  elements.logCommunicationCategoryOptions.innerHTML = options.map((option, index) =>
    `<button type="button" role="option" tabindex="-1" id="${option.id}" data-category-value="${escapeHtml(option.value)}" data-category-index="${index}" class="log-communication-category-option${index === communicationCategoryActiveIndex ? " is-active" : ""}" aria-selected="${option.value === elements.logCommunicationCategory.value}">${escapeHtml(option.label)}</button>`
  ).join("");
  if (elements.logCommunicationCategoryEmpty) elements.logCommunicationCategoryEmpty.hidden = options.length > 0;
  if (communicationCategoryActiveIndex >= 0) {
    elements.logCommunicationCategorySearch.setAttribute("aria-activedescendant", options[communicationCategoryActiveIndex].id);
    elements.logCommunicationCategoryOptions.querySelector(`[data-category-index="${communicationCategoryActiveIndex}"]`)?.scrollIntoView({block: "nearest"});
  } else elements.logCommunicationCategorySearch.removeAttribute("aria-activedescendant");
}

function closeCommunicationCategoryMenu(returnFocus = false) {
  if (elements.logCommunicationCategoryMenu) elements.logCommunicationCategoryMenu.hidden = true;
  elements.logCommunicationCategoryTrigger?.setAttribute("aria-expanded", "false");
  elements.logCommunicationCategorySearch?.setAttribute("aria-expanded", "false");
  elements.logCommunicationCategorySearch?.removeAttribute("aria-activedescendant");
  if (returnFocus) elements.logCommunicationCategoryTrigger?.focus();
}

function openCommunicationCategoryMenu() {
  if (!elements.logCommunicationCategoryMenu || !elements.logCommunicationCategorySearch) {
    elements.logCommunicationCategory?.focus();
    return;
  }
  elements.logCommunicationCategoryMenu.hidden = false;
  elements.logCommunicationCategoryTrigger.setAttribute("aria-expanded", "true");
  elements.logCommunicationCategorySearch.setAttribute("aria-expanded", "true");
  elements.logCommunicationCategorySearch.value = "";
  const selectedIndex = filteredCommunicationCategories().findIndex(option => option.value === elements.logCommunicationCategory.value);
  renderCommunicationCategoryOptions(Math.max(0, selectedIndex));
  elements.logCommunicationCategorySearch.focus();
}

function setCommunicationCategoryValue(value) {
  if (elements.logCommunicationCategory) elements.logCommunicationCategory.value = value;
  if (elements.logCommunicationCategoryValue) elements.logCommunicationCategoryValue.textContent = elements.logCommunicationCategory?.value || "Select category...";
  elements.logCommunicationCategoryTrigger?.removeAttribute("aria-invalid");
  closeCommunicationCategoryMenu();
}

function selectCommunicationCategory(value) {
  if (![...(elements.logCommunicationCategory?.options || [])].some(option => option.value && option.value === value)) return;
  setCommunicationCategoryValue(value);
  updateLogCommunicationSummary();
  markCommunicationDraftDirty();
  elements.logCommunicationCategoryTrigger?.focus();
}

function communicationCategorySearchKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeCommunicationCategoryMenu(true);
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
  event.preventDefault();
  const options = filteredCommunicationCategories();
  if (!options.length) return;
  if (event.key === "Enter") selectCommunicationCategory(options[Math.max(0, communicationCategoryActiveIndex)].value);
  else renderCommunicationCategoryOptions((communicationCategoryActiveIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
}

function filteredLogCommunicationZohoOptions() {
  const query = String(elements.logCommunicationZohoSearch?.value || "").trim().toLowerCase();
  const options = state.logCommunicationZohoOptions || [];
  if (!query) return options.slice(0, 60);
  return options
    .filter((option) => String(option.label || "").toLowerCase().includes(query))
    .slice(0, 60);
}

function closeLogCommunicationZohoOptions() {
  if (!elements.logCommunicationZohoOptions) return;
  elements.logCommunicationZohoOptions.hidden = true;
  elements.logCommunicationZohoSearch?.setAttribute("aria-expanded", "false");
}

function renderLogCommunicationZohoOptions(open = false) {
  if (!elements.logCommunicationZohoOptions) return;
  const options = filteredLogCommunicationZohoOptions();
  elements.logCommunicationZohoOptions.innerHTML = options.length
    ? options.map((option) => `
      <button type="button" role="option" data-zoho-value="${escapeHtml(option.value)}">
        ${escapeHtml(option.label)}
      </button>
    `).join("")
    : '<div class="log-communication-options-empty">No Zoho accounts found</div>';
  elements.logCommunicationZohoOptions.hidden = !open;
  elements.logCommunicationZohoSearch?.setAttribute("aria-expanded", String(open));
}

function selectLogCommunicationZohoOption(option, automatic = false) {
  if (!option) return;
  if (!automatic) communicationAccountChoiceVersion++;
  communicationAutoAccountReg = automatic ? String(elements.logCommunicationReg?.value || "").trim().toUpperCase() : null;
  state.suggestedAccount = option;
  if (elements.logCommunicationZohoSearch) {
    elements.logCommunicationZohoSearch.value = option.label;
  }
  if (elements.logCommunicationZoho) {
    elements.logCommunicationZoho.value = option.value;
  }
  updateLogCommunicationSummary();
  markCommunicationDraftDirty();
  setCommunicationAccountHint(automatic ? "Account found for this registration. You can select a different account." : "The selected Zoho account will be used.");
  closeLogCommunicationZohoOptions();
}

function setCommunicationAccountHint(message) {
  if (elements.logCommunicationAccountHint) elements.logCommunicationAccountHint.textContent = message;
}

function resetCommunicationAccountLookup() {
  clearTimeout(communicationAccountLookupTimer);
  communicationAccountLookupTimer = null;
  communicationAccountLookupVersion++;
  communicationAccountChoiceVersion++;
  communicationAutoAccountReg = null;
}

function scheduleCommunicationAccountLookup(delay = 300) {
  clearTimeout(communicationAccountLookupTimer);
  const version = ++communicationAccountLookupVersion;
  const choiceVersion = communicationAccountChoiceVersion;
  const reg = String(elements.logCommunicationReg?.value || "").trim().toUpperCase();
  if (communicationSubmitting || communicationAttemptFingerprint) return;
  if (communicationAutoAccountReg && communicationAutoAccountReg !== reg) {
    elements.logCommunicationZohoSearch.value = "";
    elements.logCommunicationZoho.value = "";
    state.suggestedAccount = null;
    communicationAutoAccountReg = null;
    updateLogCommunicationSummary();
  }
  if (!reg || reg.length > 50) {
    setCommunicationAccountHint("Select an account, or enter a registration to find a suggestion.");
    return;
  }
  if (!communicationAutoAccountReg && String(elements.logCommunicationZohoSearch?.value || "").trim()) {
    setCommunicationAccountHint("The selected account is kept. You can change it.");
    return;
  }
  setCommunicationAccountHint("Looking for a mapped Zoho account...");
  communicationAccountLookupTimer = setTimeout(() => { void lookupCommunicationAccount(reg, version, choiceVersion); }, delay);
}

async function lookupCommunicationAccount(reg, version, choiceVersion) {
  const current = () => version === communicationAccountLookupVersion && choiceVersion === communicationAccountChoiceVersion
    && reg === String(elements.logCommunicationReg?.value || "").trim().toUpperCase()
    && !communicationSubmitting && !communicationAttemptFingerprint;
  if (!current()) return;
  if (!communicationAutoAccountReg && String(elements.logCommunicationZohoSearch?.value || "").trim()) {
    setCommunicationAccountHint("The selected account is kept. You can change it.");
    return;
  }
  try {
    const data = await requestJson(api.registrationAccount + "?" + new URLSearchParams({reg_no: reg}));
    if (!current()) return;
    if (data?.authorized !== true) throw new Error("Sign in again.");
    if (data.mappingCount === 1 && data.account?.value && data.account?.label) {
      const option = state.logCommunicationZohoOptions.find(item => String(item.value) === String(data.account.value))
        || {value: String(data.account.value), label: String(data.account.label)};
      state.suggestedAccount = option;
      buildLogCommunicationZohoOptions(option.value);
      selectLogCommunicationZohoOption(option, true);
    } else setCommunicationAccountHint(data.mappingCount > 1 ? "More than one account matches. Select the Zoho account to use." : "No mapping found. Select the Zoho account to use.");
  } catch (_) {
    if (current()) setCommunicationAccountHint("Account lookup is unavailable. Select a Zoho account manually.");
  }
}

function buildLogCommunicationZohoOptions(selectedValue = "") {
  const unique = new Map();
  for (const row of state.rows || []) {
    const zohoId = String(row?.zohoId || "").trim();
    const label = String(row?.zohoAccount || "").trim();
    if (!zohoId || !label || label === "N/A") continue;
    if (!unique.has(zohoId)) {
      unique.set(zohoId, {
        value: zohoId,
        label: row?.fleet ? `${label} - ${row.fleet}` : label
      });
    }
  }
  for (const log of state.openQuickLogs || []) {
    const zohoId = String(log?.zohoId || "").trim();
    const label = String(log?.zohoAccount || "").trim();
    if (!zohoId || !label || label === "N/A") continue;
    if (!unique.has(zohoId)) {
      unique.set(zohoId, {
        value: zohoId,
        label
      });
    }
  }

  if (state.suggestedAccount?.value && !unique.has(String(state.suggestedAccount.value))) unique.set(String(state.suggestedAccount.value), state.suggestedAccount);
  const options = [...unique.values()].sort((a, b) => a.label.localeCompare(b.label));
  state.logCommunicationZohoOptions = options;
  renderLogCommunicationZohoOptions(false);
  const selected = options.find((option) => String(option.value).toLowerCase() === String(selectedValue).toLowerCase());
  if (selected) {
    if (elements.logCommunicationZohoSearch) {
      elements.logCommunicationZohoSearch.value = selected.label;
    }
    if (elements.logCommunicationZoho) {
      elements.logCommunicationZoho.value = selected.value;
    }
  }
  return options;
}

function resolveLogCommunicationZohoSelection(value = "") {
  const query = String(value || "").trim();
  if (!query) return null;
  const lowered = query.toLowerCase();
  return (state.logCommunicationZohoOptions || []).find((option) =>
    String(option.value || "").toLowerCase() === lowered
    || String(option.label || "").toLowerCase() === lowered
  ) || null;
}

function syncLogCommunicationZohoSelection() {
  const searchValue = String(elements.logCommunicationZohoSearch?.value || "").trim();
  const selected = resolveLogCommunicationZohoSelection(searchValue);
  if (elements.logCommunicationZoho) {
    elements.logCommunicationZoho.value = selected?.value || "";
  }
  updateLogCommunicationSummary();
  return selected;
}

function updateLogCommunicationSummary() {
  if (!elements.logCommunicationSummary) return;
  const reg = String(elements.logCommunicationReg?.value || "").trim();
  const zohoLabel = String(elements.logCommunicationZohoSearch?.value || "").trim();
  const zohoSelection = resolveLogCommunicationZohoSelection(zohoLabel);
  const displayZoho = zohoSelection?.label || zohoLabel;
  const caseId = String(elements.logCommunicationCaseId?.value || "").trim();
  const context = [reg, elements.logCommunicationCategory?.value, displayZoho].filter(Boolean).join(" | ");
  elements.logCommunicationSummary.textContent = reg
    ? `${caseId ? `#${caseId} | ` : ""}${context}`
    : "No registration selected";
}

function communicationRowTemplate(row = {}) {
  const commType = row.commType || "";
  const contactName = row.contactName || "";
  const contactNo = row.contactNo || "";
  const emailAddress = row.emailAddress || "";
  const datetimeComm = String(row.datetimeComm || localDateTimeValue()).replace(" ", "T");
  const comments = row.comments || "";

  return `
    <tr class="log-communication-row">
      <td><div class="log-communication-row-tools">
        <button class="log-communication-drag" type="button" draggable="true" data-drag-row aria-label="Reorder communication" title="Drag to reorder, or press Alt + Up or Down">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="7" r="1"></circle><circle cx="16" cy="7" r="1"></circle><circle cx="8" cy="12" r="1"></circle><circle cx="16" cy="12" r="1"></circle><circle cx="8" cy="17" r="1"></circle><circle cx="16" cy="17" r="1"></circle></svg>
        </button>
        <button class="log-communication-remove" type="button" data-remove-row aria-label="Remove communication" title="Remove">×</button>
      </div></td>
      <td><input aria-label="Date and time" data-field="datetime_comm" type="datetime-local" step="1" value="${escapeHtml(datetimeComm)}" required></td>
      <td><select aria-label="Communication type" data-field="comm_type" required>${logCommunicationTypes(commType)}</select></td>
      <td><input aria-label="Contact person" data-field="contact_name" type="text" maxlength="200" value="${escapeHtml(contactName)}" placeholder="Contact person"></td>
      <td><input aria-label="Contact number" data-field="contact_no" type="tel" inputmode="tel" value="${escapeHtml(contactNo)}" placeholder="0821234567"></td>
      <td><input aria-label="Email address" data-field="email_address" type="email" maxlength="200" value="${escapeHtml(emailAddress)}" placeholder="Email address"></td>
      <td><textarea aria-label="Communication notes" data-field="comments" maxlength="2000" placeholder="Communication notes" required>${escapeHtml(comments)}</textarea></td>
    </tr>
  `;
}

function addLogCommunicationRow(row = {}) {
  if (!elements.logCommunicationRows) return;
  if (elements.logCommunicationRows.children.length >= 100) {
    showLogCommunicationMessage("A quick log can contain up to 100 communications.", "error");
    return;
  }
  elements.logCommunicationRows.insertAdjacentHTML("beforeend", communicationRowTemplate(row));
  syncCommunicationEntryOrder();
}

function syncCommunicationEntryOrder() {
  const rows = [...(elements.logCommunicationRows?.querySelectorAll(".log-communication-row") || [])];
  if (elements.logCommunicationEntryCount) elements.logCommunicationEntryCount.textContent = String(rows.length);
  rows.forEach((row, index) => row.setAttribute("aria-label", `Communication ${index + 1}`));
}

function setCommunicationDraftStatus(text, saved = false) {
  if (!elements.logCommunicationDraftStatus) return;
  elements.logCommunicationDraftStatus.textContent = text;
  elements.logCommunicationDraftStatus.dataset.state = saved ? "saved" : "unsaved";
}

function markCommunicationDraftDirty() {
  setCommunicationDraftStatus(communicationDraftKey ? "Draft · unsaved changes" : "Draft · not saved");
}

function resetLogCommunicationRows(row = {}) {
  if (!elements.logCommunicationRows) return;
  elements.logCommunicationRows.innerHTML = "";
  addLogCommunicationRow(row);
}

function clearLogCommunicationForm() {
  resetCommunicationAccountLookup();
  state.suggestedAccount = null;
  communicationDraftKey = null;
  communicationDraftRaw = null;
  communicationSubmissionId = null;
  communicationSubmissionProtocol = null;
  communicationAttemptFingerprint = null;
  setCommunicationDraftStatus("Draft · not saved");
  if (elements.logCommunicationOperator) elements.logCommunicationOperator.value = [state.currentUser?.name, state.currentUser?.surname].filter(Boolean).join(" ") || state.currentUser?.username || "";
  state.selectedQuickLogId = "";
  if (elements.logCommunicationCaseId) elements.logCommunicationCaseId.value = "";
  if (elements.logCommunicationReg) elements.logCommunicationReg.value = "";
  setCommunicationCategoryValue("");
  if (elements.logCommunicationZohoSearch) elements.logCommunicationZohoSearch.value = "";
  if (elements.logCommunicationZoho) elements.logCommunicationZoho.value = "";
  setCommunicationAccountHint("Select an account, or enter a registration to find a suggestion.");
  if (elements.logCommunicationClose) elements.logCommunicationClose.checked = false;
  populateLogCommunicationSeats();
  renderLogCommunicationHistory([]);
  resetLogCommunicationRows({ datetimeComm: localDateTimeValue() });
  updateLogCommunicationSummary();
  renderOpenQuickLogs();
  setCommunicationControls();
}

async function ensureCommunicationOptions() {
  if (state.communicationOptions) return state.communicationOptions;
  try {
    const data = await requestJson(api.communicationOptions);
    state.communicationOptions = data || {};
  } catch {
    state.communicationOptions = {
      commTypes: [
        { value: "Call Made", label: "Call Made" },
        { value: "Call Received", label: "Call Received" },
        { value: "WhatsApp Sent", label: "WhatsApp Sent" },
        { value: "WhatsApp Received", label: "WhatsApp Received" }
      ],
      seats: []
    };
  }
  return state.communicationOptions;
}

function renderLogCommunicationHistory(rows = []) {
  const historyRows = parseJsonArray(rows);
  if (elements.logCommunicationHistory) elements.logCommunicationHistory.hidden = historyRows.length === 0;
  if (elements.logCommunicationHistoryCount) {
    elements.logCommunicationHistoryCount.textContent = `${historyRows.length} saved`;
  }
  if (!elements.logCommunicationHistoryList) return;
  if (!historyRows.length) {
    elements.logCommunicationHistoryList.innerHTML = '<p>No saved communication rows for this quick log yet.</p>';
    return;
  }
  elements.logCommunicationHistoryList.innerHTML = historyRows.map((row) => {
    const meta = [
      row.commType || "Communication",
      row.ccOperator || "",
      row.datetimeComm || ""
    ].filter((value) => !valueIsBlank(value)).join(" | ");
    const contacts = [
      row.contactName,
      row.contactNo,
      row.emailAddress
    ].filter((value) => !valueIsBlank(value)).join(" | ");
    return `
      <article class="log-communication-history-item">
        <div class="log-communication-history-meta">${escapeHtml(meta)}</div>
        ${contacts ? `<div class="log-communication-history-contact">${escapeHtml(contacts)}</div>` : ""}
        <p>${escapeHtml(row.comments || "")}</p>
      </article>
    `;
  }).join("");
}

function normalizeFilterValue(value) {
  return String(value || "").trim().toLowerCase();
}

function quickLogFieldValue(log, field) {
  const values = {
    caseId: `${String(log.caseId || "").replace(/^#/, "")} ${log.isDraft ? "draft" : ""}`,
    zohoOb: String(log.zohoOb || "").trim(),
    regNo: log.regNo || "",
    eventName: log.eventName || "",
    zohoAccount: log.zohoAccount && log.zohoAccount !== "N/A" ? log.zohoAccount : "",
    seat: log.seat || "",
    datetimeOpened: log.datetimeOpened || "",
    company: log.company || ""
  };
  return String(values[field] ?? "");
}

function hasActiveQuickLogFilters() {
  return Object.values(state.quickLogFilters).some((value) => String(value || "").trim());
}

function syncQuickLogClearButton() {
  if (elements.clearQuickLogFilters) {
    elements.clearQuickLogFilters.disabled = !hasActiveQuickLogFilters();
  }
}

function readQuickLogFilters() {
  if (!elements.quickLogFilters) return {};
  return Object.fromEntries(new FormData(elements.quickLogFilters));
}

function filteredOpenQuickLogs() {
  const filters = Object.entries(state.quickLogFilters)
    .map(([field, value]) => [field, normalizeFilterValue(value)])
    .filter(([, value]) => value);
  if (!filters.length) return state.openQuickLogs;
  return state.openQuickLogs.filter((log) => filters.every(([field, value]) => {
    const candidate = normalizeFilterValue(quickLogFieldValue(log, field));
    const query = field === "caseId" ? value.replace(/^#/, "") : value;
    return candidate.includes(query);
  }));
}

function updateQuickLogFilterCount(visibleCount, totalCount) {
  if (!elements.quickLogFilterCount) return;
  if (!totalCount) {
    elements.quickLogFilterCount.textContent = completedQuickLogsView ? "No completed logs" : "No open quick logs";
    return;
  }
  elements.quickLogFilterCount.textContent = hasActiveQuickLogFilters()
    ? completedQuickLogsView ? `${visibleCount} of ${totalCount} on this page · ${state.openQuickLogsTotal} completed logs` : `Showing ${visibleCount} of ${totalCount} quick logs`
    : completedQuickLogsView ? `Showing ${state.page * state.pageSize + 1}–${state.page * state.pageSize + totalCount} of ${state.openQuickLogsTotal} completed logs`
    : `${totalCount} quick log${totalCount === 1 ? "" : "s"}`;
}

function renderOpenQuickLogs() {
  const totalOpen = Number.isFinite(Number(state.openQuickLogsTotal))
    ? Number(state.openQuickLogsTotal)
    : state.openQuickLogs.length;
  const quickLogNavCount = document.querySelector(completedQuickLogsView ? '[data-nav-count="completedquicklog"]' : '[data-nav-count="quicklog"]');
  if (quickLogNavCount) {
    quickLogNavCount.textContent = String(totalOpen + state.browserDrafts.filter(draft => !draft.caseId).length);
  }
  if (elements.quickLogHistoryCount) {
    elements.quickLogHistoryCount.textContent = completedQuickLogsView ? `${totalOpen} completed`
      : `${totalOpen} open · ${state.browserDrafts.length} ${state.browserDrafts.length === 1 ? "draft" : "drafts"}`;
  }
  if (elements.quickLogPreviousPage) elements.quickLogPreviousPage.disabled = state.page === 0;
  if (elements.quickLogNextPage) elements.quickLogNextPage.disabled = (state.page + 1) * state.pageSize >= totalOpen;
  syncQuickLogClearButton();
  if (!state.openQuickLogs.length) {
    updateQuickLogFilterCount(0, 0);
    if (elements.quickLogHistoryList) {
      elements.quickLogHistoryList.innerHTML = `<tr><td colspan="6" class="quick-log-history-empty">${completedQuickLogsView ? "No completed logs." : "No open quick logs."}</td></tr>`;
    }
    return;
  }
  const visibleLogs = filteredOpenQuickLogs();
  updateQuickLogFilterCount(visibleLogs.length, state.openQuickLogs.length);
  if (!visibleLogs.length) {
    if (elements.quickLogHistoryList) {
      elements.quickLogHistoryList.innerHTML = '<tr><td colspan="6" class="quick-log-history-empty">No quick logs match the current filters.</td></tr>';
    }
    return;
  }
  if (elements.quickLogHistoryList) {
    elements.quickLogHistoryList.innerHTML = visibleLogs.map((log) => {
      const isSelected = String(log.listKey) === String(state.selectedQuickLogId);
      const opened = log.isDraft && log.savedAt ? new Date(log.savedAt).toLocaleString() : log.datetimeOpened || "-";
      const caseLabel = log.caseId ? `#${log.caseId}${log.isDraft ? " · Draft" : ""}` : "Draft";
      const ob = String(log.zohoOb || "").trim();
      const entryLabel = completedQuickLogsView ? ob || "—" : caseLabel;
      const entryAction = completedQuickLogsView ? ob ? `Zoho OB ${ob}` : "completed log" : caseLabel;
      return `
        <tr class="quick-log-history-item${isSelected ? " is-selected" : ""}" data-open-quick-log="${escapeHtml(log.listKey)}" tabindex="0" aria-label="Open ${escapeHtml(entryAction)} for ${escapeHtml(log.regNo)}">
          <td class="quick-log-case"><a href="${escapeHtml(quickLogEntryUrl(log))}" target="_blank" rel="noopener noreferrer">${escapeHtml(entryLabel)}</a></td>
          <td class="ticket-title">${escapeHtml(log.regNo || "-")}</td>
          <td>${escapeHtml(log.eventName || "-")}</td>
          <td>${escapeHtml(log.seat || "-")}</td>
          <td>${escapeHtml(opened)}</td>
          <td>${escapeHtml(log.company || "-")}</td>
        </tr>
      `;
    }).join("");
  }
}

async function loadOpenQuickLogs() {
  if (elements.quickLogHistoryList) {
    elements.quickLogHistoryList.innerHTML = '<tr><td colspan="6" class="quick-log-history-empty">Loading quick logs...</td></tr>';
  }
  try {
    const data = await requestJson(api.openQuickLogs + (completedQuickLogsView ? `?page=${state.page}` : ""));
    if (data?.authorized !== true) throw new Error("Sign in with an authorized CC operator account.");
    const serverLogs = parseRows(data?.logs);
    state.browserDrafts = [];
    if (!completedQuickLogsView) try {
      const conflicts = window.QuickLogDrafts.migrate(sessionStorage, localStorage, data.operator);
      state.browserDrafts = window.QuickLogDrafts.forOpenLogs(
        window.QuickLogDrafts.collect(localStorage, data.operator),
        data.openCaseIds == null ? serverLogs : parseRows(data.openCaseIds)
      );
      if (conflicts.length) showNotice("An older draft in this tab differs from the shared draft and has been kept.", "error");
    } catch (_) { showNotice("Saved drafts could not be read. Enable browser storage to share drafts across tabs.", "error"); }
    const seatLabels = new Map(parseRows(data?.seats).map(seat => [String(seat.value), seat.label]));
    const drafts = state.browserDrafts.map(draft => ({ ...draft, seat: seatLabels.get(draft.seat) || draft.seat }));
    state.openQuickLogs = window.QuickLogDrafts.merge(serverLogs, drafts);
    if (completedQuickLogsView) { state.page = Number(data.page) || 0; state.pageSize = Number(data.pageSize) || 100; }
    const totalOpen = Number((completedQuickLogsView ? data?.totalCompletedCount : data?.totalOpenCount) ?? serverLogs.length);
    state.openQuickLogsTotal = Number.isFinite(totalOpen) ? totalOpen : serverLogs.length;
  } catch (error) {
    state.openQuickLogs = [];
    state.openQuickLogsTotal = null;
    if (elements.quickLogHistoryList) {
      elements.quickLogHistoryList.innerHTML = `<tr><td colspan="6" class="quick-log-history-empty">${escapeHtml(error.message || "Open quick logs could not be loaded.")}</td></tr>`;
    }
    updateQuickLogFilterCount(0, 0);
    return;
  }
  renderOpenQuickLogs();
  buildLogCommunicationZohoOptions();
}

function selectOpenQuickLog(caseId) {
  const log = (state.openQuickLogs || []).find((item) => String(item.caseId) === String(caseId));
  if (!log) return;
  state.selectedQuickLogId = String(log.caseId || "");
  if (elements.logCommunicationCaseId) elements.logCommunicationCaseId.value = state.selectedQuickLogId;
  if (elements.logCommunicationReg) elements.logCommunicationReg.value = log.regNo || "";
  setCommunicationCategoryValue(log.eventName || "");
  buildLogCommunicationZohoOptions(log.zohoId || "");
  populateLogCommunicationSeats(log.seat || "");
  if (elements.logCommunicationClose) elements.logCommunicationClose.checked = false;
  renderLogCommunicationHistory(log.communicationLog || []);
  resetLogCommunicationRows({
    commType: log.commType || "",
    contactName: log.contactName || "",
    contactNo: log.contactNo || "",
    datetimeComm: localDateTimeValue()
  });
  updateLogCommunicationSummary();
  clearLogCommunicationMessage();
  renderOpenQuickLogs();
}

function quickLogEntryUrl(log) {
  const url = window.QuickLogDrafts.url(log);
  return completedQuickLogsView ? url + "&completed=1" : url;
}

async function openQuickLogFromHistory(listKey) {
  const log = state.openQuickLogs.find(item => String(item.listKey) === String(listKey));
  if (log) window.open(quickLogEntryUrl(log), "_blank", "noopener,noreferrer");
}

async function openLogCommunicationDialog(draftKey = "") {
  if (communicationSubmitting) return;
  clearLogCommunicationMessage();
  await ensureCommunicationOptions();
  populateLogCommunicationSeats();
  await loadOpenQuickLogs();
  buildLogCommunicationZohoOptions();
  clearLogCommunicationForm();
  if (draftKey) restoreCommunicationDraft(draftKey);
  openDialog(elements.logCommunicationDialog);
  elements.logCommunicationReg?.focus();
}

function closeLogCommunicationDialog() {
  if (communicationSubmitting) return;
  closeDialog(elements.logCommunicationDialog);
}

function draftCommunicationRows() {
  return [...elements.logCommunicationRows.querySelectorAll(".log-communication-row")].map(row => ({
    commType: row.querySelector("[data-field='comm_type']").value,
    contactName: row.querySelector("[data-field='contact_name']").value,
    contactNo: row.querySelector("[data-field='contact_no']").value,
    emailAddress: row.querySelector("[data-field='email_address']").value,
    datetimeComm: row.querySelector("[data-field='datetime_comm']").value,
    comments: row.querySelector("[data-field='comments']").value
  }));
}

function saveCommunicationDraft({forSubmission = false} = {}) {
  if (communicationSubmitting && !forSubmission) return false;
  clearLogCommunicationMessage();
  try {
    const regNo = String(elements.logCommunicationReg.value || "").trim();
    if (!regNo) {
      elements.logCommunicationReg.focus();
      throw new Error("Enter a registration before saving the draft.");
    }
    const owner = state.currentUser?.username;
    if (!owner) throw new Error("Sign in before saving a draft.");
    const category = elements.logCommunicationCategory?.value || "";
    const key = window.QuickLogDrafts.prefix + JSON.stringify([regNo, category || "Quick Log", "new", owner]);
    const selection = syncLogCommunicationZohoSelection();
    const raw = JSON.stringify({version: 1, editor: "standalone", savedAt: new Date().toISOString(),
      submissionId: communicationSubmissionId, submissionProtocol: communicationSubmissionProtocol, attemptFingerprint: communicationAttemptFingerprint,
      category, seat: elements.logCommunicationSeat.value, zohoId: selection?.value || "", zohoAccount: selection?.label || "",
      zohoSearch: elements.logCommunicationZohoSearch.value, rows: draftCommunicationRows()});
    if (communicationDraftKey && localStorage.getItem(communicationDraftKey) !== communicationDraftRaw) throw new Error("This draft changed in another tab. Open it from Quick Logs before saving.");
    window.QuickLogDrafts.write(localStorage, key, raw, key === communicationDraftKey ? communicationDraftRaw : null);
    if (communicationDraftKey && key !== communicationDraftKey) window.QuickLogDrafts.removeIfUnchanged(localStorage, communicationDraftKey, communicationDraftRaw);
    communicationDraftKey = key;
    communicationDraftRaw = raw;
    setCommunicationDraftStatus(communicationAttemptFingerprint ? "Request saved · awaiting confirmation" : "Draft · saved in this browser", true);
    void loadOpenQuickLogs();
    return true;
  } catch (error) { showLogCommunicationMessage(error.message || "Draft could not be saved.", "error"); return false; }
}

function restoreCommunicationDraft(key) {
  resetCommunicationAccountLookup();
  const owned = state.browserDrafts.find(draft => draft.listKey === key && draft.editor === "standalone");
  if (!owned) throw new Error("This draft could not be found for your operator account.");
  const raw = localStorage.getItem(key);
  const draft = JSON.parse(raw);
  if (draft?.editor !== "standalone" || !draft.rows?.length) throw new Error("This draft could not be loaded.");
  communicationDraftKey = key;
  communicationDraftRaw = raw;
  elements.logCommunicationReg.value = owned.regNo;
  setCommunicationCategoryValue(draft.category || "");
  elements.logCommunicationZohoSearch.value = draft.zohoSearch || draft.zohoAccount || "";
  elements.logCommunicationZoho.value = draft.zohoId || "";
  state.suggestedAccount = draft.zohoId && draft.zohoAccount ? {value: draft.zohoId, label: draft.zohoAccount} : null;
  buildLogCommunicationZohoOptions();
  setCommunicationAccountHint(draft.zohoId ? "Saved account restored. You can select a different account." : "Select a Zoho account to use.");
  populateLogCommunicationSeats(draft.seat);
  elements.logCommunicationRows.innerHTML = "";
  draft.rows.forEach(addLogCommunicationRow);
  communicationSubmissionId = draft.submissionId || null;
  communicationSubmissionProtocol = communicationSubmissionId ? draft.submissionProtocol || "legacy-v3" : null;
  communicationAttemptFingerprint = draft.attemptFingerprint || null;
  if (Boolean(communicationSubmissionId) !== Boolean(communicationAttemptFingerprint)
    || (communicationSubmissionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(communicationSubmissionId))) throw new Error("The saved request could not be restored safely. Keep this draft for review.");
  updateLogCommunicationSummary();
  setCommunicationDraftStatus(communicationAttemptFingerprint ? "Submission unconfirmed · retry these same entries" : "Draft · saved in this browser", true);
  setCommunicationControls();
}

function setCommunicationControls() {
  elements.logCommunicationForm?.querySelectorAll?.("input,select,textarea,button").forEach(control => {
    control.disabled = communicationSubmitting || Boolean(communicationAttemptFingerprint);
  });
  if (elements.logCommunicationSubmit) {
    elements.logCommunicationSubmit.disabled = communicationSubmitting;
    elements.logCommunicationSubmit.textContent = communicationAttemptFingerprint ? "Retry submission" : "Close & submit";
  }
  if (elements.logCommunicationDialogClose) elements.logCommunicationDialogClose.disabled = communicationSubmitting;
}

function collectLogCommunicationRows() {
  return [...elements.logCommunicationRows.querySelectorAll(".log-communication-row")].map((row) => ({
    comm_type: row.querySelector("[data-field='comm_type']")?.value || "",
    contact_name: row.querySelector("[data-field='contact_name']")?.value || "",
    contact_no: row.querySelector("[data-field='contact_no']")?.value || "",
    email_address: row.querySelector("[data-field='email_address']")?.value || "",
    datetime_comm: communicationDateTime(row.querySelector("[data-field='datetime_comm']")?.value),
    comments: row.querySelector("[data-field='comments']")?.value || ""
  })).filter((row) => !valueIsBlank(row.comm_type) || !valueIsBlank(row.contact_name) || !valueIsBlank(row.contact_no) || !valueIsBlank(row.email_address) || !valueIsBlank(row.comments));
}

function communicationDateTime(value) {
  const text = String(value || "").replace("T", " ");
  return text.length === 16 ? text + ":00" : text;
}

async function submitLogCommunication(event) {
  event.preventDefault();
  if (communicationSubmitting) return;
  const previousAttempt = communicationAttemptFingerprint;
  let sent = false;
  communicationSubmitting = true;
  clearLogCommunicationMessage();
  try {
    await ensureCommunicationOptions();
    if (state.communicationOptions?.authorized !== true || state.communicationOptions?.submissionEnabled !== true || !state.communicationOptions?.csrfToken) throw new Error("Submission is temporarily unavailable. Save your draft and sign in again.");
    if (!previousAttempt && state.communicationOptions?.accountSelectionEnabled !== true) throw new Error("Selected-account syncing is not available yet. Save your draft and contact an administrator.");
    if (!elements.logCommunicationForm.checkValidity()) {
      elements.logCommunicationForm.reportValidity();
      return;
    }
    const category = String(elements.logCommunicationCategory?.value || "").trim();
    if (!category) {
      elements.logCommunicationCategoryTrigger?.setAttribute("aria-invalid", "true");
      openCommunicationCategoryMenu();
      throw new Error("Select a category before submitting.");
    }
    const regNo = String(elements.logCommunicationReg.value || "").trim().toUpperCase();
    if (!regNo || regNo.length > 50) throw new Error("Enter a registration of at most 50 characters.");
    if (elements.logCommunicationCaseId?.value) throw new Error("Open existing logs from Quick Logs before editing them.");
    const seat = String(elements.logCommunicationSeat?.value || "");
    if (!(state.communicationOptions.seats || []).some(option => String(option.value) === seat && String(option.label || "").trim().toLowerCase() !== "wrc")) throw new Error("Select a valid seat.");
    const account = syncLogCommunicationZohoSelection();
    if (!account) {
      elements.logCommunicationZohoSearch?.focus();
      throw new Error("Select a Zoho account from the searchable list.");
    }
    const rows = QuickLogPolicy.validateRows(collectLogCommunicationRows());
    const fingerprint = JSON.stringify([regNo, category, seat, account.value, rows]);
    if (previousAttempt && previousAttempt !== fingerprint) throw new Error("Retry the original entries first so the previous submission can be confirmed.");
    elements.logCommunicationReg.value = regNo;
    [...elements.logCommunicationRows.querySelectorAll(".log-communication-row")].forEach((row, index) => {
      row.querySelector("[data-field='contact_no']").value = rows[index].contact_no;
    });
    communicationSubmissionId ||= crypto.randomUUID();
    communicationSubmissionProtocol ||= "account-v1";
    communicationAttemptFingerprint = fingerprint;
    if (!saveCommunicationDraft({forSubmission: true})) throw new Error(elements.logCommunicationMessage?.textContent || "The request could not be preserved for a safe retry. No request was sent.");
    setCommunicationControls();
    const body = new URLSearchParams({
      submission_id: communicationSubmissionId,
      csrf_token: state.communicationOptions.csrfToken,
      case_id: "", case_snapshot: "", reg_no: regNo, category, event: category,
      zoho_account_id: account.value, seat, close_case: "1", comments_json: JSON.stringify(rows)
    });
    body.set("account_context_version", communicationSubmissionProtocol === "account-v1" ? "1" : "");
    const submittedDraftKey = communicationDraftKey;
    const submittedDraftRaw = communicationDraftRaw;
    sent = true;
    const result = await postCommunicationRequest(body);
    if (result?.success !== true || !Number.isInteger(result.caseId) || result.caseId <= 0 || result.insertedComments !== rows.length || result.submissionId?.toLowerCase() !== communicationSubmissionId.toLowerCase()) throw new Error("The service returned an unexpected confirmation. Your draft has been kept; retry this same request.");
    try { window.QuickLogDrafts.removeIfUnchanged(localStorage, submittedDraftKey, submittedDraftRaw); } catch (_) { /* An exact retry of the retained request is a no-op. */ }
    clearLogCommunicationForm();
    showLogCommunicationMessage("Case #" + result.caseId + " saved and queued for Zoho. Zoho confirmation is pending.", "success");
    await loadOpenQuickLogs();
    buildLogCommunicationZohoOptions();
  } catch (error) {
    if (!previousAttempt && (!sent || error.confirmedNotSaved)) {
      communicationSubmissionId = null;
      communicationSubmissionProtocol = null;
      communicationAttemptFingerprint = null;
      if (sent) saveCommunicationDraft({forSubmission: true});
    }
    showLogCommunicationMessage(error.message || "The request could not be confirmed. Your draft has been kept; retry the same request.", "error");
  } finally {
    communicationSubmitting = false;
    setCommunicationControls();
  }
}

async function postCommunicationRequest(body) {
  const response = await fetch(api.logCommunicationSubmit, {
    method: "POST", body,
    headers: {Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded"},
    ...(typeof AbortSignal !== "undefined" ? {signal: AbortSignal.timeout(45000)} : {})
  });
  const text = await response.text();
  if (!text.trim().startsWith("{")) {
    const code = text.match(/\bCC_(?:AUTH|REQUEST_ID|CONTEXT|CASE|SEAT|ACCOUNT|ROWS|VALIDATION|RECONCILE|STALE|LIMIT|SAVE_COUNT):/);
    if (code) {
      const error = new Error("No entries were saved. Check the registration, seat and communication entries, then retry. " + code[0].slice(0, -1));
      error.confirmedNotSaved = true;
      throw error;
    }
    throw new Error("The request could not be confirmed. Your draft has been kept; retry the same request.");
  }
  const data = JSON.parse(text);
  if (!response.ok || data?.success === false) {
    const error = new Error(data?.message || "The request could not be confirmed. Retry the same request.");
    error.confirmedNotSaved = data?.success === false && (data.definitelyNotSaved === true || ["invalid_request", "backend_unavailable", "unauthorized"].includes(data.status));
    throw error;
  }
  return data;
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

async function loadOpenQuickLogNavigationCount() {
  if (!completedQuickLogsView) return;
  try {
    const data = await requestJson(api.openQuickLogCount);
    if (data.authorized !== true) return;
    let drafts = 0;
    try { drafts = window.QuickLogDrafts.collect(localStorage, data.operator).filter(draft => !draft.caseId).length; } catch (_) { /* Keep the database count if browser storage is blocked. */ }
    const badge = document.querySelector('[data-nav-count="quicklog"]');
    if (badge) badge.textContent = String(Number(data.totalOpenCount || 0) + drafts);
  } catch (_) { /* The main list reports session/API failures. */ }
}

async function loadEscalationOptions() {
  try {
    const data = await requestJson(api.escalations);
    if (!data?.isAuthorized) return;
    state.rows = parseRows(data.escalations);
    buildLogCommunicationZohoOptions();
  } catch {
    state.rows = [];
  }
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

elements.logCommunicationDialogClose?.addEventListener("click", closeLogCommunicationDialog);
elements.logCommunicationReg?.addEventListener("input", updateLogCommunicationSummary);
elements.logCommunicationReg?.addEventListener("input", () => scheduleCommunicationAccountLookup());
elements.logCommunicationReg?.addEventListener("change", () => scheduleCommunicationAccountLookup(0));
elements.logCommunicationCategory?.addEventListener("change", () => {
  setCommunicationCategoryValue(elements.logCommunicationCategory.value);
  updateLogCommunicationSummary();
});
elements.logCommunicationCategoryTrigger?.addEventListener("click", () => {
  if (elements.logCommunicationCategoryMenu.hidden) openCommunicationCategoryMenu();
  else closeCommunicationCategoryMenu();
});
elements.logCommunicationCategoryTrigger?.addEventListener("keydown", event => {
  if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); openCommunicationCategoryMenu(); }
  else if (event.key === "Escape" && !elements.logCommunicationCategoryMenu.hidden) {
    event.preventDefault(); event.stopPropagation(); closeCommunicationCategoryMenu(true);
  }
});
elements.logCommunicationCategorySearch?.addEventListener("input", () => renderCommunicationCategoryOptions());
elements.logCommunicationCategorySearch?.addEventListener("keydown", communicationCategorySearchKeydown);
elements.logCommunicationCategoryOptions?.addEventListener("click", event => {
  const option = event.target.closest("[data-category-value]");
  if (option) selectCommunicationCategory(option.dataset.categoryValue);
});
elements.logCommunicationCategoryPicker?.addEventListener("focusout", event => {
  if (!elements.logCommunicationCategoryPicker.contains(event.relatedTarget)) closeCommunicationCategoryMenu();
});
document.addEventListener("pointerdown", event => {
  if (elements.logCommunicationCategoryPicker && !elements.logCommunicationCategoryPicker.contains(event.target)) closeCommunicationCategoryMenu();
});
elements.logCommunicationZohoSearch?.addEventListener("focus", () => renderLogCommunicationZohoOptions(true));
elements.logCommunicationZohoSearch?.addEventListener("input", () => {
  communicationAccountChoiceVersion++;
  communicationAutoAccountReg = null;
  setCommunicationAccountHint("Select the Zoho account to use.");
  syncLogCommunicationZohoSelection();
  renderLogCommunicationZohoOptions(true);
});
elements.logCommunicationZohoSearch?.addEventListener("change", syncLogCommunicationZohoSelection);
elements.logCommunicationZohoSearch?.addEventListener("blur", () => {
  window.setTimeout(closeLogCommunicationZohoOptions, 120);
});
elements.logCommunicationZohoSearch?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeLogCommunicationZohoOptions();
    return;
  }
  if (event.key !== "Enter") return;
  const selected = resolveLogCommunicationZohoSelection(elements.logCommunicationZohoSearch.value);
  if (!selected) return;
  event.preventDefault();
  selectLogCommunicationZohoOption(selected);
});
elements.logCommunicationZohoOptions?.addEventListener("mousedown", (event) => {
  const optionButton = event.target.closest("[data-zoho-value]");
  if (!optionButton) return;
  event.preventDefault();
  const selected = (state.logCommunicationZohoOptions || [])
    .find((option) => String(option.value) === String(optionButton.dataset.zohoValue));
  selectLogCommunicationZohoOption(selected);
});
elements.quickLogHistoryList?.addEventListener("click", (event) => {
  if (event.target.closest("a")) return;
  const trigger = event.target.closest("[data-open-quick-log]");
  if (!trigger) return;
  openQuickLogFromHistory(trigger.dataset.openQuickLog)
    .catch((error) => showNotice(error.message || "Quick log could not be opened.", "error"));
});
elements.quickLogHistoryList?.addEventListener("keydown", (event) => {
  if (event.target.closest("a")) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  const trigger = event.target.closest("[data-open-quick-log]");
  if (!trigger) return;
  event.preventDefault();
  openQuickLogFromHistory(trigger.dataset.openQuickLog)
    .catch((error) => showNotice(error.message || "Quick log could not be opened.", "error"));
});
elements.quickLogFilters?.addEventListener("input", () => {
  window.clearTimeout(elements.quickLogFilters.filterTimer);
  elements.quickLogFilters.filterTimer = window.setTimeout(() => {
    state.quickLogFilters = readQuickLogFilters();
    renderOpenQuickLogs();
  }, 150);
});
elements.quickLogFilters?.addEventListener("submit", (event) => {
  event.preventDefault();
  window.clearTimeout(elements.quickLogFilters.filterTimer);
  state.quickLogFilters = readQuickLogFilters();
  renderOpenQuickLogs();
});
elements.clearQuickLogFilters?.addEventListener("click", () => {
  window.clearTimeout(elements.quickLogFilters?.filterTimer);
  elements.quickLogFilters?.reset();
  state.quickLogFilters = {};
  renderOpenQuickLogs();
});
elements.quickLogHistoryRefresh?.addEventListener("click", () => {
  loadOpenQuickLogs().catch((error) => showNotice(error.message || "Open quick logs could not be loaded.", "error"));
});
elements.quickLogPreviousPage?.addEventListener("click", () => {
  if (state.page > 0) { state.page--; loadOpenQuickLogs(); }
});
elements.quickLogNextPage?.addEventListener("click", () => {
  if ((state.page + 1) * state.pageSize < state.openQuickLogsTotal) { state.page++; loadOpenQuickLogs(); }
});
elements.createQuickLog?.addEventListener("click", () => {
  openLogCommunicationDialog().catch((error) => showNotice(error.message, "error"));
});
elements.logCommunicationAddRow?.addEventListener("click", () => addLogCommunicationRow({ datetimeComm: localDateTimeValue() }));
elements.logCommunicationAddRow?.addEventListener("click", markCommunicationDraftDirty);
elements.logCommunicationSaveDraft?.addEventListener("click", saveCommunicationDraft);
elements.logCommunicationForm?.addEventListener("input", markCommunicationDraftDirty);
elements.logCommunicationForm?.addEventListener("change", markCommunicationDraftDirty);
elements.logCommunicationDialog?.addEventListener("cancel", event => {
  if (communicationSubmitting) event.preventDefault();
});
elements.logCommunicationRows?.addEventListener("dragstart", event => {
  const handle = event.target.closest("[data-drag-row]");
  if (!handle || communicationSubmitting) { event.preventDefault(); return; }
  draggedCommunicationRow = handle.closest(".log-communication-row");
  draggedCommunicationRow.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", "communication");
});
elements.logCommunicationRows?.addEventListener("dragover", event => {
  if (!draggedCommunicationRow) return;
  event.preventDefault();
  const target = event.target.closest(".log-communication-row");
  if (!target || target === draggedCommunicationRow) return;
  const bounds = target.getBoundingClientRect();
  target.parentNode.insertBefore(draggedCommunicationRow, event.clientY < bounds.top + bounds.height / 2 ? target : target.nextSibling);
});
function finishCommunicationReorder() {
  if (!draggedCommunicationRow) return;
  draggedCommunicationRow.classList.remove("is-dragging");
  draggedCommunicationRow = null;
  syncCommunicationEntryOrder();
  markCommunicationDraftDirty();
}
elements.logCommunicationRows?.addEventListener("drop", event => {
  if (draggedCommunicationRow) event.preventDefault();
  finishCommunicationReorder();
});
elements.logCommunicationRows?.addEventListener("dragend", finishCommunicationReorder);
elements.logCommunicationRows?.addEventListener("keydown", event => {
  const handle = event.target.closest("[data-drag-row]");
  if (!handle || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key) || communicationSubmitting) return;
  event.preventDefault();
  const row = handle.closest(".log-communication-row");
  if (event.key === "ArrowUp" && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
  else if (event.key === "ArrowDown" && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
  syncCommunicationEntryOrder();
  markCommunicationDraftDirty();
  handle.focus();
});
elements.logCommunicationRows?.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-row]");
  if (!removeButton) return;
  const row = removeButton.closest(".log-communication-row");
  if (!row) return;
  const rowCount = elements.logCommunicationRows.querySelectorAll(".log-communication-row").length;
  if (rowCount === 1) {
    row.querySelectorAll("input, textarea").forEach((input) => {
      if (input.type !== "datetime-local") input.value = "";
    });
    row.querySelector("[data-field='comm_type']").value = "";
    row.querySelector("[data-field='datetime_comm']").value = localDateTimeValue();
    markCommunicationDraftDirty();
    return;
  }
  row.remove();
  syncCommunicationEntryOrder();
  markCommunicationDraftDirty();
});
elements.logCommunicationForm?.addEventListener("submit", (event) => {
  submitLogCommunication(event).catch((error) => showLogCommunicationMessage(error.message || "Communication log could not be saved.", "error"));
});

elements.themeToggle?.addEventListener("change", (event) => setTheme(event.target.checked ? "dark" : "light"));
elements.sidebarCollapseButton?.addEventListener("click", () => {
  setSidebarCollapsed(!elements.appShell?.classList.contains("sidebar-collapsed"));
});
compactSidebarQuery.addEventListener("change", (event) => {
  setSidebarCollapsed(event.matches);
});

syncThemeToggle();
window.addEventListener("storage", event => {
  if (event.storageArea === localStorage && (event.key === null || event.key.startsWith(window.QuickLogDrafts.prefix))) {
    window.clearTimeout(state.draftRefreshTimer);
    state.draftRefreshTimer = window.setTimeout(() => completedQuickLogsView ? loadOpenQuickLogNavigationCount() : loadOpenQuickLogs(), 100);
  }
});
setSidebarCollapsed(compactSidebarQuery.matches ? true : false);
syncSidebarGroups();
loadCurrentUser()
  .then(async (sessionOk) => {
    if (!sessionOk) return;
    await Promise.all([loadTicketCounts(), loadEscalationOptions(), loadOpenQuickLogs(), loadOpenQuickLogNavigationCount()]);
    const draftKey = new URLSearchParams(window.location.search).get("draft");
    if (draftKey && !completedQuickLogsView) await openLogCommunicationDialog(draftKey);
  })
  .catch((error) => showNotice(error.message, "error"));
