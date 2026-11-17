-- Read-only suggestion. Operators may select a different account.
SET account_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SET account_allowed = (SELECT CASE WHEN TRY_CONVERT(int,JSON_VALUE($account_identity,'$[0].userType')) IN(7,8,14)
 AND TRY_CONVERT(int,JSON_VALUE($account_identity,'$[0].userId')) IS NOT NULL THEN 1 ELSE 0 END);
WITH candidates AS (
 SELECT DISTINCT COALESCE(NULLIF(LTRIM(RTRIM(mapped.zoho_id)),N''),NULLIF(LTRIM(RTRIM(fallback.zoho_id)),N'')) AS value,
 COALESCE(NULLIF(LTRIM(RTRIM(mapped.Account_Name)),N''),NULLIF(LTRIM(RTRIM(fallback.Account_Name)),N''),c.Company) AS label
 FROM Risk.dbo.Vehicleinfo v JOIN Jobcard.dbo.Companies c ON c.Company=v.Company
 LEFT JOIN Pulsit_comparison.dbo.Accounts_ZOHO mapped ON mapped.zoho_id=TRY_CONVERT(nvarchar(200),c.escallation_no)
 LEFT JOIN Pulsit_comparison.dbo.Accounts_ZOHO fallback ON fallback.Account_no=c.acc_no
 WHERE $account_allowed='1'
 AND NULLIF(LTRIM(RTRIM(CAST($reg_no AS nvarchar(max)))),N'') IS NOT NULL
 AND DATALENGTH(CAST($reg_no AS nvarchar(max)))<=100
 AND UPPER(LTRIM(RTRIM(v.Reg_no)))=UPPER(LTRIM(RTRIM(CAST($reg_no AS nvarchar(50)))))
), matches AS (SELECT COUNT(DISTINCT value) AS match_count FROM candidates)
SELECT 'json' AS component,(SELECT CAST(CASE WHEN $account_allowed='1' THEN 1 ELSE 0 END AS bit) AS authorized,
 (SELECT match_count FROM matches) AS mappingCount,
 JSON_QUERY(CASE WHEN (SELECT match_count FROM matches)=1 THEN
 (SELECT TOP(1) value,label FROM candidates WHERE value IS NOT NULL ORDER BY label FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) END) AS account
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS contents;
