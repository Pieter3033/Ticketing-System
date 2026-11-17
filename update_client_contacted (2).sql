-- Legacy duplicate route: requester users must use the canonical group-scoped ticket module.
SET legacy_ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SELECT 'redirect' AS component, '/internaltickets/index.html' AS link
WHERE JSON_VALUE($legacy_ticket_identity, '$[0].userId') IS NULL
   OR COALESCE(TRY_CONVERT(INT, JSON_VALUE($legacy_ticket_identity, '$[0].canManageRequesterGroups')), 0) <> 1;

UPDATE CC.dbo.tkt_InternalTickets
SET
    c_contacted = CASE WHEN TRY_CONVERT(INT, :contacted) = 1 THEN 1 ELSE 0 END,
    UpdatedAt = SYSDATETIME()
WHERE TicketID = TRY_CONVERT(INT, :ticket_id)
  AND IsDeleted = 0
  AND (
      NULLIF(LTRIM(RTRIM(COALESCE(c_name, ''))), '') IS NOT NULL
      OR NULLIF(LTRIM(RTRIM(COALESCE(c_contact, ''))), '') IS NOT NULL
  );

SELECT
    'json' AS component,
    (
        SELECT
            CASE WHEN t.TicketID IS NULL THEN CAST(0 AS BIT) ELSE CAST(1 AS BIT) END AS success,
            t.TicketID AS ticketId,
            COALESCE(t.c_contacted, 0) AS clientContacted,
            CASE WHEN t.TicketID IS NULL THEN 'Client callback status could not be updated.' ELSE 'Client callback status updated.' END AS message
        FROM (SELECT 1 AS x) seed
        LEFT JOIN
        (
            SELECT TOP (1)
                TicketID,
                c_contacted
            FROM CC.dbo.tkt_InternalTickets
            WHERE TicketID = TRY_CONVERT(INT, :ticket_id)
              AND IsDeleted = 0
              AND COALESCE(c_contacted, 0) = CASE WHEN TRY_CONVERT(INT, :contacted) = 1 THEN 1 ELSE 0 END
              AND (
                  NULLIF(LTRIM(RTRIM(COALESCE(c_name, ''))), '') IS NOT NULL
                  OR NULLIF(LTRIM(RTRIM(COALESCE(c_contact, ''))), '') IS NOT NULL
              )
        ) t ON 1 = 1
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
