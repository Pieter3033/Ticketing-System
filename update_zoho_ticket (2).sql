-- Legacy duplicate route: requester users must use the canonical group-scoped ticket module.
SET legacy_ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SELECT 'redirect' AS component, '/internaltickets/index.html' AS link
WHERE JSON_VALUE($legacy_ticket_identity, '$[0].userId') IS NULL
   OR COALESCE(TRY_CONVERT(INT, JSON_VALUE($legacy_ticket_identity, '$[0].canManageRequesterGroups')), 0) <> 1;

UPDATE CC.dbo.tkt_InternalTickets
SET
    zoho_ticketnum = NULLIF(LEFT(LTRIM(RTRIM(CAST(:zoho_ticketnum AS NVARCHAR(100)))), 100), ''),
    UpdatedAt = SYSDATETIME()
WHERE TicketID = TRY_CONVERT(INT, :ticket_id)
  AND IsDeleted = 0;

SELECT
    'json' AS component,
    (
        SELECT
            CASE WHEN t.TicketID IS NULL THEN CAST(0 AS BIT) ELSE CAST(1 AS BIT) END AS success,
            t.TicketID AS ticketId,
            COALESCE(t.zoho_ticketnum, '') AS zohoTicketNumber,
            CASE WHEN t.TicketID IS NULL THEN 'Zoho ticket number could not be updated.' ELSE 'Zoho ticket number updated.' END AS message
        FROM (SELECT 1 AS x) seed
        LEFT JOIN
        (
            SELECT TOP (1)
                TicketID,
                zoho_ticketnum
            FROM CC.dbo.tkt_InternalTickets
            WHERE TicketID = TRY_CONVERT(INT, :ticket_id)
              AND IsDeleted = 0
              AND COALESCE(zoho_ticketnum, '') = COALESCE(NULLIF(LEFT(LTRIM(RTRIM(CAST(:zoho_ticketnum AS NVARCHAR(100)))), 100), ''), '')
        ) t ON 1 = 1
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
