WITH current_operator AS (
 SELECT TOP(1) u.Username,COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.Name,N' ',u.Surname))),N''),u.Username) AS operator_name
 FROM Jobcard.dbo.Current_session s JOIN Jobcard.dbo.User_info u ON LOWER(LTRIM(RTRIM(u.Username)))=LOWER(LTRIM(RTRIM(s.Username)))
 WHERE s.session_id=sqlpage.cookie('session') AND TRY_CONVERT(int,u.Usertype) IN(7,8,14) ORDER BY u.Seqno
), open_logs AS (
 SELECT q.* FROM Pulsit_comparison.dbo.CC_quick_log q JOIN current_operator op
 ON LOWER(LTRIM(RTRIM(q.cc_operator))) IN(LOWER(op.Username),LOWER(op.operator_name))
 WHERE COALESCE(TRY_CONVERT(int,q.[close]),0)=0 AND COALESCE(TRY_CONVERT(int,q.zoho_insert),1) NOT IN(0,3) AND NOT EXISTS(SELECT 1 FROM CC.dbo.CCQuickLogSync completed_sync WHERE completed_sync.CaseID=q.seqno AND completed_sync.SyncState=N'Complete') AND NULLIF(LTRIM(RTRIM(q.reg_no)),N'') IS NOT NULL
)
SELECT 'json' AS component,(SELECT CAST(CASE WHEN EXISTS(SELECT 1 FROM current_operator) THEN 1 ELSE 0 END AS bit) AS authorized,
 JSON_QUERY((SELECT Username AS username,operator_name AS name FROM current_operator FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) AS operator,
 (SELECT COUNT_BIG(*) FROM open_logs) AS totalOpenCount,
 JSON_QUERY(COALESCE((SELECT q.seqno AS caseId FROM open_logs q FOR JSON PATH),N'[]')) AS openCaseIds,
 JSON_QUERY((SELECT TOP(300) q.seqno AS caseId,q.reg_no AS regNo,q.company,q.event AS eventName,q.seat,
 CONVERT(varchar(16),q.datetime_opened,120) AS datetimeOpened,
 CASE WHEN (SELECT COUNT(*) FROM CC.dbo.quick_log_Comments c WHERE c.case_id=q.seqno)>0
 THEN (SELECT COUNT(*) FROM CC.dbo.quick_log_Comments c WHERE c.case_id=q.seqno) ELSE 1 END AS commentCount,
 COALESCE((SELECT TOP(1) c.comments FROM CC.dbo.quick_log_Comments c WHERE c.case_id=q.seqno ORDER BY c.datetime_comm DESC,c.comm_id DESC),q.comments) AS lastComment
 FROM open_logs q ORDER BY q.datetime_opened DESC,q.seqno DESC FOR JSON PATH)) AS logs,
 JSON_QUERY((SELECT id AS value,seat AS label FROM Pulsit_comparison.dbo.cc_seats WHERE EXISTS(SELECT 1 FROM current_operator) AND NULLIF(LTRIM(RTRIM(seat)),N'') IS NOT NULL AND LTRIM(RTRIM(seat))<>N'...' ORDER BY id FOR JSON PATH)) AS seats
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS contents;
