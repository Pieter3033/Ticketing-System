const express = require("express");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const config = require("./config");
const { createPublicTicket, createTicket } = require("./ticketService");
const { persistAttachment, removeStoredAttachment } = require("./uploads");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.uploads.maxBytes,
    files: 1
  }
});

app.disable("x-powered-by");
app.use(cookieParser());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && config.corsOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/internal-tickets", upload.single("attachment"), async (req, res, next) => {
  let storedFile = null;
  try {
    storedFile = await persistAttachment(req.file);
    const result = await createTicket({
      body: req.body,
      file: storedFile,
      sessionId: req.cookies.session
    });
    res.json(result);
  } catch (error) {
    await removeStoredAttachment(storedFile);
    next(error);
  }
});

app.post("/api/public-tickets", upload.single("attachment"), async (req, res, next) => {
  let storedFile = null;
  try {
    storedFile = await persistAttachment(req.file);
    const result = await createPublicTicket({
      body: req.body,
      file: storedFile,
      sessionId: req.cookies.session
    });
    res.json(result);
  } catch (error) {
    await removeStoredAttachment(storedFile);
    next(error);
  }
});

app.use((err, _req, res, _next) => {
  const status = err.status || (err.code === "LIMIT_FILE_SIZE" ? 413 : 500);
  res.status(status).json({
    success: false,
    message: err.code === "LIMIT_FILE_SIZE" ? "Attachment is too large." : (err.message || "Unexpected server error."),
    details: err.details || null
  });
});

module.exports = app;
