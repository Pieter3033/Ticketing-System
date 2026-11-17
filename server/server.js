const fs = require("fs");
const app = require("./app");
const config = require("./config");

fs.mkdirSync(config.uploads.root, { recursive: true });

app.listen(config.port, () => {
  console.log(`Internal Tickets API listening on http://localhost:${config.port}`);
});
