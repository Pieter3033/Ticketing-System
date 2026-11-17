-- Resolve access from the authenticated SQLPage session, never from supplied role/group fields.
SET ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SET ticket_user_id = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userId'));
SET ticket_user_type = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userType'));
SET ticket_is_requester = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].isRequester')), 0);
SET ticket_requester_group = JSON_VALUE($ticket_identity, '$[0].requesterGroup');
SET ticket_staff_access = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].canManageRequesterGroups')), 0);
SET software_access_allowed = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].softwareAllowed')), 0);
SET ticket_manage_access = CASE WHEN $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL AND $ticket_is_requester = 0 THEN 1 ELSE 0 END;


-- New standalone logs use the installed atomic, idempotent queue trigger.
-- Account IDs are validation context only, never a Call Centre parent ID.
SET log_context = sqlpage.run_sql('sqlpage/quick_log_submission_context.sql');
SET log_submit_route = (SELECT CASE WHEN JSON_VALUE($log_context,'$[0].validRequest')='1'
 AND $ticket_user_type IN (7, 8, 14) AND $ticket_user_id IS NOT NULL
 THEN N'CC_Escalation/quick_log_submit.sql'
 ELSE N'internaltickets/api_log_communication_rejected.sql' END);
SELECT 'dynamic' AS component,sqlpage.run_sql($log_submit_route) AS properties;
