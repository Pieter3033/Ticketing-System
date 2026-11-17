const { sql, withTransaction } = require("./db");
const { httpError } = require("./httpError");
const ticketAccess = require("../ticket-access");

function clean(value) {
  return String(value ?? "").trim();
}

function nullableClean(value) {
  const text = clean(value);
  return text || null;
}

function prependRequesterDetails(input, body) {
  const requesterName = clean(body.requester_name);
  const requesterContact = clean(body.requester_contact);

  if (!requesterName) throw httpError(400, "Your name is required.");

  return [
    "Submitted via public ticket form",
    `Requester: ${requesterName.slice(0, 120)}`,
    requesterContact ? `Requester contact: ${requesterContact.slice(0, 120)}` : null,
    "",
    input.description
  ].filter((line) => line !== null).join("\r\n");
}

function validateTicketInput(body) {
  const department = clean(body.department);
  const priority = clean(body.priority);
  const category = clean(body.category);
  const registration = clean(body.registration);
  const description = clean(body.description);
  const clientCallback = clean(body.client_callback) === "1";
  const clientName = clientCallback ? clean(body.client_name) : "";
  const clientContact = clientCallback ? clean(body.client_contact) : "";

  if (!department) throw httpError(400, "Department is required.");
  if (!["Helpdesk", "Pulscam", "TAD", "Software"].includes(department)) throw httpError(400, "Department is invalid.");
  if (!["Low", "Medium", "High", "Critical"].includes(priority)) throw httpError(400, "Priority is invalid.");
  if (!category) throw httpError(400, "Category is required.");
  if (!registration) throw httpError(400, "Registration is required.");
  if (!description) throw httpError(400, "Description is required.");
  if (clientCallback && (!clientName || !clientContact)) {
    throw httpError(400, "Client name and contact are required when client callback is selected.");
  }

  return {
    department,
    priority,
    category,
    registration,
    description,
    clientCallback,
    clientName: clientCallback ? clientName : null,
    clientContact: clientCallback ? clientContact : null
  };
}

function bindTicketInputs(request, input, requestedByUserId) {
  request.input("title", sql.NVarChar(200), input.category.slice(0, 200));
  request.input("department", sql.NVarChar(100), input.department.slice(0, 100));
  request.input("priority", sql.NVarChar(20), input.priority);
  request.input("category", sql.NVarChar(100), input.category.slice(0, 100));
  request.input("registration", sql.NVarChar(50), input.registration.slice(0, 50));
  request.input("clientName", sql.NVarChar(100), nullableClean(input.clientName)?.slice(0, 100) || null);
  request.input("clientContact", sql.NVarChar(50), nullableClean(input.clientContact)?.slice(0, 50) || null);
  request.input("description", sql.NVarChar(sql.MAX), input.description);
  request.input("requestedByUserId", sql.Int, requestedByUserId);
  request.input("requesterGroup", sql.NVarChar(20), input.requesterGroup);
}

async function insertTicket(transaction, input, requestedByUserId) {
  const createRequest = new sql.Request(transaction);
  bindTicketInputs(createRequest, input, requestedByUserId);

  const created = await createRequest.query(`
    INSERT INTO CC.dbo.tkt_InternalTickets
    (
      Title,
      Department,
      Priority,
      Category,
      reg_no,
      c_name,
      c_contact,
      c_contacted,
      Description,
      RequestedByUserID,
      RequesterGroup
    )
    OUTPUT inserted.TicketID, inserted.TicketNumber
    VALUES
    (
      @title,
      @department,
      @priority,
      @category,
      @registration,
      @clientName,
      @clientContact,
      0,
      @description,
      @requestedByUserId,
      @requesterGroup
    );
  `);

  const ticket = created.recordset[0];
  if (!ticket?.TicketID) throw httpError(500, "Ticket was not created.");
  return ticket;
}

async function insertAttachment(transaction, ticket, file, uploadedByUserId) {
  if (!file) return;

  const attachRequest = new sql.Request(transaction);
  attachRequest.input("ticketId", sql.Int, ticket.TicketID);
  attachRequest.input("originalFileName", sql.NVarChar(255), file.originalName.slice(0, 255));
  attachRequest.input("storedFilePath", sql.NVarChar(1000), file.storedPath);
  attachRequest.input("mimeType", sql.NVarChar(150), file.mimeType ? file.mimeType.slice(0, 150) : null);
  attachRequest.input("fileSizeBytes", sql.BigInt, file.size);
  attachRequest.input("uploadedByUserId", sql.Int, uploadedByUserId);
  await attachRequest.query(`
    INSERT INTO CC.dbo.tkt_Attachments
    (
      TicketID,
      OriginalFileName,
      StoredFilePath,
      MimeType,
      FileSizeBytes,
      UploadedByUserID
    )
    VALUES
    (
      @ticketId,
      @originalFileName,
      @storedFilePath,
      @mimeType,
      @fileSizeBytes,
      @uploadedByUserId
    );
  `);
}

async function resolveCurrentUser(transaction, sessionId) {
  const session = clean(sessionId);
  if (!session) throw httpError(401, "Missing session_id.");

  const request = new sql.Request(transaction);
  request.input("sessionId", sql.NVarChar(128), session);
  const result = await request.query(`
    WITH session_source AS
    (
      SELECT
        NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS NVARCHAR(200)))), '') AS username
      FROM Current_session current_session
      WHERE current_session.session_id = @sessionId
    ),
    user_candidates AS
    (
      SELECT
        user_info.Seqno,
        user_info.Usertype,
        session_source.username AS session_username,
        NULLIF(LTRIM(RTRIM(CAST(user_info.Username AS NVARCHAR(200)))), '') AS db_username
      FROM session_source
      JOIN Jobcard.dbo.User_info user_info
        ON session_source.username IS NOT NULL
    ),
    user_name_parts AS
    (
      SELECT
        Seqno,
        Usertype,
        session_username,
        db_username,
        CASE
          WHEN session_username IS NULL THEN NULL
          WHEN CHARINDEX('\\', session_username) > 0 THEN RIGHT(session_username, CHARINDEX('\\', REVERSE(session_username)) - 1)
          WHEN CHARINDEX('/', session_username) > 0 THEN RIGHT(session_username, CHARINDEX('/', REVERSE(session_username)) - 1)
          ELSE session_username
        END AS session_login_name,
        CASE
          WHEN db_username IS NULL THEN NULL
          WHEN CHARINDEX('\\', db_username) > 0 THEN RIGHT(db_username, CHARINDEX('\\', REVERSE(db_username)) - 1)
          WHEN CHARINDEX('/', db_username) > 0 THEN RIGHT(db_username, CHARINDEX('/', REVERSE(db_username)) - 1)
          ELSE db_username
        END AS db_login_name
      FROM user_candidates
    ),
    canonical_users AS
    (
      SELECT
        Seqno,
        Usertype,
        session_username,
        db_username,
        LOWER(
          CASE
            WHEN session_login_name IS NULL THEN NULL
            WHEN CHARINDEX('@', session_login_name) > 0 THEN LEFT(session_login_name, CHARINDEX('@', session_login_name) - 1)
            ELSE session_login_name
          END
        ) AS session_canonical_username,
        LOWER(
          CASE
            WHEN db_login_name IS NULL THEN NULL
            WHEN CHARINDEX('@', db_login_name) > 0 THEN LEFT(db_login_name, CHARINDEX('@', db_login_name) - 1)
            ELSE db_login_name
          END
        ) AS db_canonical_username
      FROM user_name_parts
    )
    SELECT TOP (1)
      Seqno,
      Usertype
    FROM canonical_users
    WHERE
      session_username IS NOT NULL
      AND (
        db_username = session_username
        OR LOWER(db_username) = session_canonical_username
        OR db_canonical_username = session_canonical_username
      )
    ORDER BY
      CASE
        WHEN db_username = session_username THEN 0
        WHEN LOWER(db_username) = session_canonical_username THEN 1
        WHEN db_canonical_username = session_canonical_username THEN 2
        ELSE 3
      END,
      Seqno;
  `);

  const userId = result.recordset[0]?.Seqno;
  if (!userId) throw httpError(403, "Your session could not be matched to an internal user record.");
  const userType = result.recordset[0]?.Usertype;
  if (userType == null || !Number.isInteger(Number(userType))) throw httpError(403, "Your user type could not be resolved.");
  return { userId: Number(userId), userType: Number(userType) };
}

async function createTicket({ body, file, sessionId }) {
  const input = validateTicketInput(body);

  return withTransaction(async (transaction) => {
    const { userId, userType } = await resolveCurrentUser(transaction, sessionId);
    if (input.department === "Software" && userType !== 7) {
      throw httpError(403, "Software tickets are limited to user type 7.");
    }
    if (ticketAccess.isIBLS({ userType }) && input.department !== "Helpdesk") {
      throw httpError(403, "IBLS users can only create Helpdesk tickets.");
    }
    input.requesterGroup = ticketAccess.requesterGroup({ userType });
    const ticket = await insertTicket(transaction, input, userId);
    await insertAttachment(transaction, ticket, file, userId);

    return {
      success: true,
      ticketId: ticket.TicketID,
      ticketNumber: ticket.TicketNumber,
      message: "Ticket created."
    };
  });
}

async function createPublicTicket({ body, file, sessionId }) {
  const input = validateTicketInput(body);
  if (input.department === "Software") throw httpError(403, "Software tickets cannot be opened from the public form.");
  input.description = prependRequesterDetails(input, body);
  input.requesterGroup = "Internal";

  return withTransaction(async (transaction) => {
    if (sessionId) {
      let user;
      try { user = await resolveCurrentUser(transaction, sessionId); }
      catch (error) { if (error.status !== 401 && error.status !== 403) throw error; }
      if (ticketAccess.isRequester(user)) throw httpError(403, "IBLS and CRM users must create tickets through their signed-in ticket form.");
    }
    const ticket = await insertTicket(transaction, input, null);
    await insertAttachment(transaction, ticket, file, null);

    return {
      success: true,
      ticketId: ticket.TicketID,
      ticketNumber: ticket.TicketNumber,
      message: "Ticket created."
    };
  });
}

module.exports = {
  createPublicTicket,
  createTicket
};
