const express = require("express");

const endpointPath = "/internaltickets/api_infinity_tickets.sql";
const maxBodyBytes = 16384;
const fields = {
  createdBy: "created_by",
  clientName: "client_name",
  clientContactNo: "client_contact",
  registration: "registration",
  category: "category",
  description: "description",
  priority: "priority"
};

// This adapter uses HTTP to SQLPage. It never opens a database connection.
function createInfinityApp({ sqlpageOrigin = "http://127.0.0.1:8080", fetchImpl = fetch } = {}) {
  const origin = new URL(sqlpageOrigin);
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password
      || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("INFINITY_SQLPAGE_ORIGIN must be an HTTP origin without credentials or a path.");
  }
  const upstreamUrl = new URL(endpointPath, origin).href;
  const app = express();
  app.disable("x-powered-by");

  app.all(endpointPath, (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ status: 405, message: "Use POST." });
    }
    const key = req.get("X-API-Key");
    if (!key || key.length < 32 || key.length > 256) {
      return res.status(401).json({ status: 401, message: "Invalid API credentials." });
    }
    const type = (req.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    if (!["application/json", "application/x-www-form-urlencoded"].includes(type)) {
      return res.status(415).json({ status: 415, message: "Use Content-Type: application/json." });
    }
    next();
  }, express.json({ limit: maxBodyBytes, strict: true, inflate: false }),
  express.urlencoded({ limit: maxBodyBytes, extended: false, inflate: false, parameterLimit: 32 }),
  async (req, res) => {
    if (!req.body || Array.isArray(req.body) || typeof req.body !== "object") {
      return res.status(400).json({ status: 400, message: "Supply a JSON object with string fields." });
    }
    const form = new URLSearchParams();
    for (const [externalName, internalName] of Object.entries(fields)) {
      // Legacy snake-case fields remain supported for existing form callers.
      const value = Object.hasOwn(req.body, externalName) ? req.body[externalName] : req.body[internalName];
      if (value === undefined) continue;
      if (typeof value !== "string") {
        return res.status(400).json({ status: 400, message: `${externalName} must be a string.` });
      }
      form.set(internalName, value);
    }
    // Department, requester group, IDs and initial status never come from the caller.
    // The SQLPage handler fixes intake to CC and applies the Medium default.
    if (Buffer.byteLength(form.toString(), "utf8") > maxBodyBytes) {
      return res.status(413).json({ status: 413, message: "Encoded ticket data exceeds the 16 KiB host limit." });
    }
    try {
      const upstream = await fetchImpl(upstreamUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-API-Key": req.get("X-API-Key"),
          Accept: "application/json"
        },
        body: form.toString(),
        redirect: "error",
        signal: AbortSignal.timeout(15000)
      });
      if (upstream.status === 204) return res.status(204).end();
      // SQLPage error bodies can contain database diagnostics. Return safe messages only.
      const messages = {
        400: "Supply createdBy, description, registration, clientName and clientContactNo within field limits. Priority defaults to Medium.",
        401: "Invalid API credentials.",
        413: "Request body is too large.",
        503: "Infinity ticket intake is not configured."
      };
      const status = Object.hasOwn(messages, upstream.status) ? upstream.status : 502;
      await upstream.body?.cancel();
      return res.status(status).json({ status, message: messages[status] || "Ticket processing failed. Check before retrying; the ticket may have been created." });
    } catch (error) {
      const status = ["TimeoutError", "AbortError"].includes(error.name) ? 504 : 502;
      return res.status(status).json({ status, message: "Ticket submission could not be confirmed. Check before retrying; the ticket may have been created." });
    }
  });

  app.use((error, _req, res, _next) => {
    const status = error.type === "entity.too.large" || error.type === "parameters.too.many" ? 413
      : error.status === 415 ? 415 : 400;
    res.status(status).json({ status, message: status === 413 ? "Request body is too large."
      : status === 415 ? "Use uncompressed UTF-8 JSON or form data." : "Invalid request body. Supply a JSON object with string fields." });
  });
  return app;
}

module.exports = { createInfinityApp, endpointPath };
