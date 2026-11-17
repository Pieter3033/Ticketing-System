(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QuickLogDrafts = api;
}(typeof globalThis === "object" ? globalThis : this, function () {
  const prefix = "cc-escalation-draft:v1:";
  const normalize = value => String(value || "").trim().toLowerCase();

  function collect(storage, operator, deduplicate = true) {
    if (!operator?.username) return [];
    const owners = [operator.username, operator.name].filter(Boolean).map(normalize);
    const drafts = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      try {
        const context = JSON.parse(key.slice(prefix.length));
        if (!Array.isArray(context) || context.length !== 4 || context.some(value => typeof value !== "string")) continue;
        const [regNo, eventName, caseId, owner] = context;
        if (!regNo.trim() || !eventName.trim() || !owners.includes(normalize(owner))) continue;
        if (caseId !== "new" && !/^[1-9][0-9]*$/.test(caseId)) continue;
        const draft = JSON.parse(storage.getItem(key));
        if (draft?.version !== 1 || !Array.isArray(draft.rows) || !draft.rows.length || draft.rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) continue;
        drafts.push({
          listKey: key, caseId: caseId === "new" ? "" : caseId, regNo, eventName, company: String(draft.company || ""),
          isDraft: true, awaitingConfirmation: Boolean(draft.submissionId && draft.attemptFingerprint),
          savedAt: Number.isFinite(Date.parse(draft.savedAt)) ? draft.savedAt : "",
          seat: String(draft.seat || ""), commentCount: draft.rows.length,
          lastComment: String(draft.rows[draft.rows.length - 1].comments || ""),
          ownerIsUsername: normalize(owner) === normalize(operator.username),
          ...(draft.editor === "standalone" ? {editor: "standalone", zohoId: String(draft.zohoId || ""), zohoAccount: String(draft.zohoAccount || "")} : {})
        });
      } catch (_) { /* Ignore unrelated or malformed browser data. */ }
    }
    if (!deduplicate) return drafts.sort((a,b) => Number(b.ownerIsUsername) - Number(a.ownerIsUsername));
    const unique = new Map();
    for (const draft of drafts) {
      const key = JSON.stringify([draft.regNo, draft.eventName, draft.caseId]);
      const existing = unique.get(key);
      if (!existing || (draft.ownerIsUsername && !existing.ownerIsUsername)) unique.set(key, draft);
    }
    return [...unique.values()].sort((a, b) => (Date.parse(b.savedAt) || 0) - (Date.parse(a.savedAt) || 0));
  }

  function forOpenLogs(drafts, openCaseIds) {
    // Use the complete owned open-case set, including cases outside the displayed page.
    // Keep storage intact: an old draft can contain edits absent from the submitted log.
    const open = new Set(openCaseIds.map(log => String(log.caseId)));
    return drafts.filter(draft => !draft.caseId || open.has(String(draft.caseId)));
  }

  function merge(logs, drafts) {
    const result = logs.map(log => ({ ...log, listKey: String(log.caseId) }));
    for (const draft of drafts) {
      const existing = draft.caseId && result.find(log => String(log.caseId) === draft.caseId
        && normalize(log.regNo) === normalize(draft.regNo) && normalize(log.eventName) === normalize(draft.eventName));
      if (existing) {
        const original = { company: existing.company || draft.company || "", seat: existing.seat, zohoAccount: existing.zohoAccount, datetimeOpened: existing.datetimeOpened };
        Object.assign(existing, draft, original);
      } else result.unshift(draft);
    }
    return result;
  }

  function migrate(tabStorage, sharedStorage, operator) {
    const conflicts = [];
    for (const draft of collect(tabStorage, operator, false)) {
      const raw = tabStorage.getItem(draft.listKey);
      const context = JSON.parse(draft.listKey.slice(prefix.length));
      context[3] = operator.username;
      const targetKey = prefix + JSON.stringify(context);
      const shared = sharedStorage.getItem(targetKey);
      // Never overwrite a draft already saved by another tab, especially an unconfirmed request.
      if (shared !== null && shared !== raw) {
        conflicts.push(draft.listKey);
        continue;
      }
      if (shared === null) sharedStorage.setItem(targetKey, raw);
      if (sharedStorage.getItem(targetKey) === raw) tabStorage.removeItem(draft.listKey);
    }
    return conflicts;
  }

  function write(storage, key, raw, expected) {
    if (storage.getItem(key) !== expected) throw new Error("This draft changed in another tab. Open it from Quick Logs before saving.");
    storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) throw new Error("Browser storage did not preserve the draft.");
  }

  function removeIfUnchanged(storage, key, expected) {
    if (expected !== null && storage.getItem(key) === expected) storage.removeItem(key);
  }

  function url(log) {
    if (log.editor === "standalone" && log.isDraft) return "/internaltickets/quick_logs.html?" + new URLSearchParams({draft: log.listKey});
    const params = new URLSearchParams({ reg_no: log.regNo, event: log.eventName, quick_log: "1" });
    if (log.caseId) params.set("seqno", String(log.caseId));
    return "/CC_Escalation/main.sql?" + params;
  }
  return { prefix, collect, forOpenLogs, merge, url, migrate, write, removeIfUnchanged };
}));
