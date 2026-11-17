const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const config = require("./config");
const { httpError } = require("./httpError");

function extensionOf(fileName) {
  return path.extname(String(fileName || "")).replace(".", "").toLowerCase();
}

function safeBaseName(fileName) {
  return path
    .basename(String(fileName || "attachment"), path.extname(String(fileName || "")))
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "attachment";
}

async function persistAttachment(file) {
  if (!file || !file.size) return null;
  const ext = extensionOf(file.originalname);
  if (!config.uploads.allowedExtensions.has(ext)) {
    throw httpError(400, `Attachment type .${ext || "unknown"} is not allowed.`);
  }
  await fs.mkdir(config.uploads.root, { recursive: true });
  const fileName = `${crypto.randomUUID()}-${safeBaseName(file.originalname)}.${ext}`;
  const absolutePath = path.join(config.uploads.root, fileName);
  await fs.writeFile(absolutePath, file.buffer);
  return {
    originalName: file.originalname,
    storedPath: absolutePath,
    mimeType: file.mimetype || null,
    size: file.size
  };
}

async function removeStoredAttachment(upload) {
  if (!upload?.storedPath) return;
  try {
    await fs.unlink(upload.storedPath);
  } catch {
    // Best-effort cleanup for a file created during a failed request.
  }
}

module.exports = {
  persistAttachment,
  removeStoredAttachment
};
