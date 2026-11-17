(() => {
  function parseJsonResponse(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed);
    } catch (_error) {
      const responseDocument = new DOMParser().parseFromString(trimmed, "text/html");
      const tableText = Array.from(responseDocument.querySelectorAll("tbody td"))
        .map((cell) => cell.textContent || "")
        .join("");
      const documentText = responseDocument.body.textContent || "";
      for (const candidate of [tableText, documentText]) {
        const start = candidate.indexOf("{");
        const end = candidate.lastIndexOf("}");
        if (start === -1 || end <= start) continue;
        try {
          return JSON.parse(candidate.slice(start, end + 1));
        } catch (_nestedError) {}
      }
      return {};
    }
  }

  async function requestJson(url) {
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Dispatch navigation request failed (${response.status}).`);
    return parseJsonResponse(await response.text());
  }

  function firstResult(payload) {
    return Array.isArray(payload) ? payload[0] || {} : payload || {};
  }

  function renderDispatchSummary(summary) {
    for (const key of ["draftCount", "pendingCount", "approvedCount"]) {
      for (const badge of document.querySelectorAll(`[data-summary-count="${key}"]`)) {
        badge.textContent = String(summary[key] ?? 0);
      }
    }
  }

  function renderEtaSummary(summary) {
    const count = Number(summary.actionCount || 0);
    for (const badge of document.querySelectorAll("[data-eta-request-count]")) {
      badge.textContent = String(count);
      badge.hidden = count <= 0;
    }
  }

  async function loadDispatchNavigationCounts() {
    if (window.InternalTicketAccess) {
      try {
        const currentUser = firstResult(await requestJson('/internaltickets/api_current_user.sql'));
        if (!currentUser?.userId || window.InternalTicketAccess.isRequester(currentUser)) return;
      } catch { return; }
    }
    const [dispatchResult, etaResult] = await Promise.allSettled([
      requestJson(`/dispatch_link/api/dispatch_summary.sql?_=${Date.now()}`),
      requestJson(`/dispatch_link/api/eta_request_summary.sql?_=${Date.now()}`)
    ]);
    if (dispatchResult.status === "fulfilled") renderDispatchSummary(firstResult(dispatchResult.value));
    if (etaResult.status === "fulfilled") renderEtaSummary(firstResult(etaResult.value));
  }

  loadDispatchNavigationCounts();
  window.setInterval(loadDispatchNavigationCounts, 30000);
})();
