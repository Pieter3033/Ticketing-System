WITH current_operator AS (
 SELECT TOP(1) u.Username,COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.Name,N' ',u.Surname))),N''),u.Username) AS operator_name
 FROM Jobcard.dbo.Current_session s JOIN Jobcard.dbo.User_info u ON LOWER(LTRIM(RTRIM(u.Username)))=LOWER(LTRIM(RTRIM(s.Username)))
 WHERE s.session_id=sqlpage.cookie('session') AND TRY_CONVERT(int,u.Usertype) IN(7,8,14) ORDER BY u.Seqno
), completed_logs AS (
 SELECT q.* FROM Pulsit_comparison.dbo.CC_quick_log q JOIN current_operator op
 ON LOWER(LTRIM(RTRIM(q.cc_operator))) IN(LOWER(op.Username),LOWER(op.operator_name))
 WHERE (TRY_CONVERT(int,q.[close])=1 OR q.zoho_insert IN(0,3) OR EXISTS(SELECT 1 FROM CC.dbo.CCQuickLogSync completed_sync WHERE completed_sync.CaseID=q.seqno AND completed_sync.SyncState=N'Complete')) AND NULLIF(LTRIM(RTRIM(q.reg_no)),N'') IS NOT NULL
 AND (NULLIF($case_id,N'') IS NULL OR q.seqno=TRY_CONVERT(int,$case_id))
), paging AS (
 SELECT CASE WHEN NULLIF($case_id,N'') IS NULL AND TRY_CONVERT(int,$page) BETWEEN 0 AND 1000000 THEN TRY_CONVERT(int,$page) ELSE 0 END AS page_number
)
SELECT 'json' AS component,(SELECT CAST(CASE WHEN EXISTS(SELECT 1 FROM current_operator) THEN 1 ELSE 0 END AS bit) AS authorized,
 JSON_QUERY((SELECT Username AS username,operator_name AS name FROM current_operator FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) AS operator,
 (SELECT COUNT_BIG(*) FROM completed_logs) AS totalCompletedCount,
 (SELECT page_number FROM paging) AS page,100 AS pageSize,
 JSON_QUERY((SELECT q.seqno AS caseId,q.reg_no AS regNo,q.company,q.event AS eventName,q.seat,CAST(CASE WHEN TRY_CONVERT(int,q.[close])=1 THEN 1 ELSE 0 END AS bit) AS closed,
 NULLIF(LTRIM(RTRIM(q.reference)),N'') AS zohoOb,
 CONVERT(varchar(16),q.datetime_opened,120) AS datetimeOpened,
 CASE WHEN (SELECT COUNT(*) FROM CC.dbo.quick_log_Comments c WHERE c.case_id=q.seqno)>0
 THEN (SELECT COUNT(*) FROM CC.dbo.quick_log_Comments c WHERE c.case_id=q.seqno) ELSE 1 END AS commentCount,
 COALESCE((SELECT TOP(1) c.comments FROM CC.dbo.quick_log_Comments c WHERE c.case_id=q.seqno ORDER BY c.datetime_comm DESC,c.comm_id DESC),q.comments) AS lastComment,
 COALESCE(sync.SyncState,CASE WHEN (q.zoho_insert=0 AND NULLIF(LTRIM(RTRIM(q.zoho_id)),N'') IS NOT NULL AND NULLIF(LTRIM(RTRIM(q.reference)),N'') IS NOT NULL) THEN N'Complete' WHEN q.zoho_insert=3 THEN N'Uncertain' WHEN q.zoho_insert=0 THEN N'Unconfirmed' ELSE N'Pending' END) AS syncState,
 JSON_QUERY(CASE WHEN NULLIF($case_id,N'') IS NULL THEN NULL ELSE
 (SELECT h.commType,h.contactName,h.contactNo,h.emailAddress,h.comments,h.ccOperator,h.datetimeComm,h.zohoPushed
 FROM (
 SELECT c.comm_id AS commId,COALESCE(c.DisplayOrder,c.comm_id) AS position,c.comm_type AS commType,c.contact_name AS contactName,c.contact_no AS contactNo,
 c.email_address AS emailAddress,c.comments,c.cc_operator AS ccOperator,CONVERT(nvarchar(19),c.datetime_comm,120) AS datetimeComm,c.zoho_pushed AS zohoPushed
 FROM CC.dbo.quick_log_Comments c WHERE c.case_id=q.seqno
 UNION ALL
 SELECT 0,0,q.comm_type,q.c_name,q.c_number,CAST(NULL AS nvarchar(200)),q.comments,q.cc_operator,CONVERT(nvarchar(19),q.datetime_comm,120),
 CAST(CASE WHEN (q.zoho_insert=0 AND NULLIF(LTRIM(RTRIM(q.zoho_id)),N'') IS NOT NULL AND NULLIF(LTRIM(RTRIM(q.reference)),N'') IS NOT NULL) OR EXISTS(SELECT 1 FROM CC.dbo.CCQuickLogSync completed_sync WHERE completed_sync.CaseID=q.seqno AND completed_sync.SyncState=N'Complete') THEN 1 ELSE 0 END AS bit)
 WHERE NOT EXISTS(SELECT 1 FROM CC.dbo.quick_log_Comments c WHERE c.case_id=q.seqno)
 ) h ORDER BY h.position,h.commId FOR JSON PATH) END) AS communicationLog
 FROM completed_logs q LEFT JOIN CC.dbo.CCQuickLogSync sync ON sync.CaseID=q.seqno
 ORDER BY q.datetime_opened DESC,q.seqno DESC
 OFFSET (SELECT page_number*100 FROM paging) ROWS FETCH NEXT 100 ROWS ONLY FOR JSON PATH)) AS logs
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS contents;
