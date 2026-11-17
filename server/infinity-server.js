const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
const { createInfinityApp } = require("./infinityApp");

const port = Number(process.env.INFINITY_JSON_PORT || 3201);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid INFINITY_JSON_PORT.");
const sqlpageOrigin = process.env.INFINITY_SQLPAGE_ORIGIN || "http://127.0.0.1:8080";
if (new URL(sqlpageOrigin).port === String(port)) throw new Error("The adapter and SQLPage must use different ports.");
createInfinityApp({ sqlpageOrigin }).listen(port, "127.0.0.1", () => {
  console.log(`Infinity JSON adapter listening on http://127.0.0.1:${port}`);
});
