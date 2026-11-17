const sql = require("mssql");
const config = require("./config");

let poolPromise;

function getPool() {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool({
      server: config.db.server,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      options: {
        encrypt: config.db.options.encrypt,
        trustServerCertificate: config.db.options.trustServerCertificate,
        enableArithAbort: true
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
      }
    });
    poolPromise = pool.connect();
  }
  return poolPromise;
}

async function withTransaction(handler) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await handler(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    if (!transaction._aborted) {
      await transaction.rollback();
    }
    throw error;
  }
}

module.exports = {
  sql,
  getPool,
  withTransaction
};
