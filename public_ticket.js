const publicTicketApiBase = window.INTERNAL_TICKETS_API_BASE || "";

const publicTicketApi = {
  createTicket: `${publicTicketApiBase}public_create_ticket.sql`,
  registrationLookup: "api_registration_lookup.sql"
};

const publicTicketElements = {
  form: document.querySelector("#publicTicketForm"),
  notice: document.querySelector("#notice"),
  clientCallback: document.querySelector("#clientCallback"),
  clientCallbackFields: document.querySelector("#clientCallbackFields"),
  registrationInput: document.querySelector('#publicTicketForm [name="registration"]'),
  infoButton: document.querySelector("#publicTicketInfoButton"),
  infoDialog: document.querySelector("#publicTicketInfoDialog"),
  infoDialogClose: document.querySelector("#publicTicketInfoClose")
};

const publicAttachmentInput = document.querySelector("#attachmentInput");
const publicAttachmentFilename = document.querySelector("[data-upload-filename]");

const publicHelpdeskCategories = [
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
const publicPulscamCategories = ["Cameras Offline", "Camera Footage", "Health Check", "Setting Alterations", "Report Request", "Other"];

const publicRegistrationLookupCache = new Map();
let publicRegistrationLookupTimer = 0;
let publicRegistrationLookupRequestId = 0;

function publicEscapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function publicRegistrationInfoIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 8h.01"></path></svg>';
}

function publicRegistrationCopyText(vehicle = {}) {
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

function publicSetLookupItem(item, stateName, popoverHtml, label) {
  if (!item) return;
  const icon = item.querySelector(".registration-lookup-icon");
  const popover = item.querySelector(".registration-lookup-popover");
  item.hidden = false;
  item.dataset.state = stateName;
  if (icon) {
    icon.innerHTML = publicRegistrationInfoIcon();
    icon.setAttribute("aria-label", label);
  }
  if (popover) popover.innerHTML = popoverHtml;
}

function publicResetRegistrationLookup(scopeEl) {
  if (!scopeEl) return;
  for (const item of scopeEl.querySelectorAll(".registration-lookup-item")) {
    item.hidden = true;
    item.dataset.state = "neutral";
    const popover = item.querySelector(".registration-lookup-popover");
    if (popover) popover.textContent = "";
  }
}

function publicRenderRegistrationLookup(scopeEl, result = {}) {
  if (!scopeEl) return;
  const exactItem = scopeEl.querySelector('[data-lookup-kind="exact"]');
  const exactFound = (result?.exactFound === true || result?.exactFound === 1 || result?.exactFound === "1") && result.vehicle;

  if (exactFound) {
    const copyText = encodeURIComponent(publicRegistrationCopyText(result.vehicle));
    publicSetLookupItem(
      exactItem,
      "found",
      `<strong>Vehicle info found.</strong><button class="registration-copy-button" type="button" data-registration-copy="${copyText}">Copy</button>`,
      "Vehicle info found."
    );
    return;
  }

  publicSetLookupItem(exactItem, "missing", "<strong>No match found.</strong>", "No match found.");
}

function publicRenderRegistrationLookupPending(scopeEl) {
  publicSetLookupItem(
    scopeEl?.querySelector('[data-lookup-kind="exact"]'),
    "pending",
    "<strong>Checking vehicle info...</strong>",
    "Checking vehicle info."
  );
}

function publicRenderRegistrationLookupError(scopeEl) {
  publicSetLookupItem(
    scopeEl?.querySelector('[data-lookup-kind="exact"]'),
    "missing",
    "<strong>Lookup unavailable.</strong>",
    "Lookup unavailable."
  );
}

async function publicRequestJson(url, options) {
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

async function publicSubmitMultipartForm(url, form) {
  return publicRequestJson(url, {
    method: "POST",
    body: new FormData(form)
  });
}

function publicShowNotice(message, type = "success") {
  if (!publicTicketElements.notice) return;
  publicTicketElements.notice.textContent = message;
  publicTicketElements.notice.className = `notice ${type}`;
  publicTicketElements.notice.hidden = false;
  window.setTimeout(() => {
    if (publicTicketElements.notice.textContent === message) {
      publicTicketElements.notice.hidden = true;
    }
  }, 5000);
}

function publicSyncClientCallbackFields() {
  if (!publicTicketElements.clientCallback || !publicTicketElements.clientCallbackFields) return;
  const enabled = publicTicketElements.clientCallback.checked;
  publicTicketElements.clientCallbackFields.style.display = enabled ? "grid" : "none";
  for (const input of publicTicketElements.clientCallbackFields.querySelectorAll("input")) {
    input.disabled = !enabled;
    input.required = enabled;
    if (!enabled) input.value = "";
  }
}

function publicSyncTicketCategoryOptions() {
  const department = publicTicketElements.form?.elements.department;
  const category = publicTicketElements.form?.elements.category;
  if (!department || !category) return;
  const current = category.value;
  const options = department.value === "Pulscam" ? publicPulscamCategories : publicHelpdeskCategories;
  category.innerHTML = `<option value="">Select category</option>${options.map((value) => `<option value="${publicEscapeHtml(value)}">${publicEscapeHtml(value)}</option>`).join("")}`;
  category.value = options.includes(current) ? current : "";
}

function publicSyncAttachmentFilename() {
  if (!publicAttachmentInput || !publicAttachmentFilename) return;
  const file = publicAttachmentInput.files?.[0];
  publicAttachmentFilename.textContent = file ? file.name : "No file chosen";
}

async function publicLoadRegistrationLookup(registration) {
  const reg = String(registration || "").trim();
  if (!reg) return null;
  const cacheKey = reg.toUpperCase();
  if (publicRegistrationLookupCache.has(cacheKey)) {
    return publicRegistrationLookupCache.get(cacheKey);
  }
  const result = await publicRequestJson(
    `${publicTicketApi.registrationLookup}?${new URLSearchParams({ reg_no: reg, _: String(Date.now()) }).toString()}`
  );
  publicRegistrationLookupCache.set(cacheKey, result || {});
  return result || {};
}

function publicScheduleRegistrationLookup() {
  const scopeEl = document.querySelector('[data-registration-lookup="form"]');
  const registration = publicTicketElements.registrationInput?.value || "";
  window.clearTimeout(publicRegistrationLookupTimer);
  const requestId = ++publicRegistrationLookupRequestId;

  if (!registration.trim()) {
    publicResetRegistrationLookup(scopeEl);
    return;
  }

  publicRenderRegistrationLookupPending(scopeEl);
  publicRegistrationLookupTimer = window.setTimeout(() => {
    publicLoadRegistrationLookup(registration)
      .then((result) => {
        if (requestId !== publicRegistrationLookupRequestId) return;
        publicRenderRegistrationLookup(scopeEl, result);
      })
      .catch((error) => {
        if (requestId !== publicRegistrationLookupRequestId) return;
        console.warn("Registration lookup failed:", error);
        publicRenderRegistrationLookupError(scopeEl);
      });
  }, 300);
}

function publicCopyTextToClipboard(text) {
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

publicTicketElements.form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = publicTicketElements.form.querySelector("button[type='submit']");
  button.disabled = true;

  try {
    const result = await publicSubmitMultipartForm(publicTicketApi.createTicket, publicTicketElements.form);
    if (!result?.success) throw new Error(result?.message || "Ticket was not created.");

    publicTicketElements.form.reset();
    publicRegistrationLookupRequestId += 1;
    publicResetRegistrationLookup(document.querySelector('[data-registration-lookup="form"]'));
    publicSyncClientCallbackFields();
    publicSyncAttachmentFilename();
    publicShowNotice(`${result.ticketNumber} created successfully. Keep this number for follow-up.`);
    publicTicketElements.form.querySelector('[name="requester_name"]')?.focus();
  } catch (error) {
    publicShowNotice(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

publicTicketElements.clientCallback?.addEventListener("change", publicSyncClientCallbackFields);
publicTicketElements.form?.elements.department?.addEventListener("change", publicSyncTicketCategoryOptions);
publicSyncTicketCategoryOptions();
publicTicketElements.registrationInput?.addEventListener("input", publicScheduleRegistrationLookup);
publicTicketElements.registrationInput?.addEventListener("change", publicScheduleRegistrationLookup);
publicAttachmentInput?.addEventListener("change", publicSyncAttachmentFilename);

document.addEventListener("click", (event) => {
  const copyButton = event.target.closest("[data-registration-copy]");
  if (!copyButton) return;
  publicCopyTextToClipboard(decodeURIComponent(copyButton.dataset.registrationCopy || ""))
    .then(() => {
      copyButton.textContent = "Copied";
      window.setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1500);
    })
    .catch(() => publicShowNotice("Vehicle info could not be copied.", "error"));
});

publicTicketElements.infoButton?.addEventListener("click", () => {
  publicTicketElements.infoDialog?.showModal();
});

publicTicketElements.infoDialogClose?.addEventListener("click", () => {
  publicTicketElements.infoDialog?.close();
});

publicTicketElements.infoDialog?.addEventListener("click", (event) => {
  const bounds = publicTicketElements.infoDialog.getBoundingClientRect();
  const clickedOutside =
    event.clientX < bounds.left
    || event.clientX > bounds.right
    || event.clientY < bounds.top
    || event.clientY > bounds.bottom;

  if (clickedOutside) {
    publicTicketElements.infoDialog.close();
  }
});

publicSyncClientCallbackFields();
publicSyncAttachmentFilename();
