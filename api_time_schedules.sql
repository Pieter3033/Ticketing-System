WITH current_user_info AS
(
    SELECT TOP (1) ui.Seqno, ui.Name, ui.Surname, ui.Usertype
    FROM Current_session cs
    JOIN Jobcard.dbo.User_info ui
      ON LOWER(LTRIM(RTRIM(CAST(ui.Username AS NVARCHAR(200))))) = LOWER(LTRIM(RTRIM(CAST(cs.Username AS NVARCHAR(200)))))
    WHERE cs.session_id = sqlpage.cookie('session')
    ORDER BY ui.Seqno
)
SELECT 'json' AS component,
(
    SELECT
        CAST(CASE WHEN EXISTS (SELECT 1 FROM current_user_info WHERE Usertype = 7) THEN 1 ELSE 0 END AS BIT) AS accessAllowed,
        (SELECT TOP (1) Seqno FROM current_user_info WHERE Usertype = 7) AS userId,
        (SELECT TOP (1) LTRIM(RTRIM(CONCAT(Name, ' ', Surname))) FROM current_user_info WHERE Usertype = 7) AS employeeName,
        JSON_QUERY((
            SELECT ScheduleID AS scheduleId,
                   CONVERT(VARCHAR(10), ScheduleDate, 23) AS scheduleDate,
                   CONVERT(VARCHAR(5), StartTime, 108) AS startTime,
                   CONVERT(VARCHAR(5), EndTime, 108) AS endTime,
                   BreakMinutes AS breakMinutes,
                   COALESCE(Notes, '') AS notes,
                   CONVERT(VARCHAR(16), UpdatedAt, 120) AS updatedAt
            FROM CC.dbo.tkt_UserTimeSchedules schedule
            WHERE schedule.UserID = (SELECT TOP (1) Seqno FROM current_user_info WHERE Usertype = 7)
            ORDER BY ScheduleDate DESC
            FOR JSON PATH
        )) AS schedules
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS contents;
