# Internal tickets

Internal ticketing frontend, SQLPage endpoints, and Node.js API components.

## Development

- Install dependencies with `npm ci`.
- Use `npm test` for the isolated regression tests.
- Copy `.env.example` to `.env` and supply your own private settings when running the Node.js API with `npm start`.
- The SQLPage pages require the surrounding application's private SQLPage configuration, shared session helpers, and existing database schema. This folder is one component of that application.

The Infinity JSON adapter can be started with `npm run start:infinity`. It forwards requests to the configured SQLPage origin.

## Private configuration and data

Credentials, environment files, SQLPage configuration, database files/backups, attachments, screenshots, deployment reports, and local archives are intentionally excluded from version control. Keep them in private local configuration or an appropriate secret store.

Files under `database/` describe schema requirements or contain migration source; they are not database exports. Review migrations separately before applying them.

Operator tools under `server/deployment/` require separately supplied private deployment configuration. Running tests does not deploy this application.

With Gitleaks installed, run `gitleaks git . --redact` before pushing changes. The scanner configuration permits only the exact synthetic key in the two isolated Infinity test files.
