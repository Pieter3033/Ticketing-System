SET schedule_user_id = (
    SELECT TOP (1) ui.Seqno
    FROM Current_session cs
    JOIN Jobcard.dbo.User_info ui
      ON LOWER(LTRIM(RTRIM(CAST(ui.Username AS NVARCHAR(200))))) = LOWER(LTRIM(RTRIM(CAST(cs.Username AS NVARCHAR(200)))))
    WHERE cs.session_id = sqlpage.cookie('session') AND ui.Usertype = 7
    ORDER BY ui.Seqno
);
SET schedule_date = TRY_CONVERT(DATE, :schedule_date);
SET start_time = TRY_CONVERT(TIME(0), :start_time);
SET end_time = TRY_CONVERT(TIME(0), :end_time);
SET break_minutes = TRY_CONVERT(INT, :break_minutes);
SET schedule_error = CASE
    WHEN $schedule_user_id IS NULL THEN 'access_denied'
    WHEN $schedule_date IS NULL THEN 'date_invalid'
    WHEN $start_time IS NULL OR $end_time IS NULL OR $end_time <= $start_time THEN 'time_invalid'
    WHEN $break_minutes IS NULL OR $break_minutes < 0 THEN 'break_invalid'
    WHEN $break_minutes >= DATEDIFF(MINUTE, $start_time, $end_time) THEN 'break_too_long'
    ELSE NULL
END;

UPDATE CC.dbo.tkt_UserTimeSchedules
SET StartTime = $start_time,
    EndTime = $end_time,
    BreakMinutes = $break_minutes,
    Notes = NULLIF(LEFT(LTRIM(RTRIM(CAST(:notes AS NVARCHAR(1000)))), 1000), ''),
    UpdatedAt = SYSDATETIME()
WHERE UserID = $schedule_user_id AND ScheduleDate = $schedule_date AND $schedule_error IS NULL;

INSERT INTO CC.dbo.tkt_UserTimeSchedules (UserID, ScheduleDate, StartTime, EndTime, BreakMinutes, Notes)
SELECT $schedule_user_id, $schedule_date, $start_time, $end_time, $break_minutes,
       NULLIF(LEFT(LTRIM(RTRIM(CAST(:notes AS NVARCHAR(1000)))), 1000), '')
WHERE $schedule_error IS NULL
  AND NOT EXISTS (SELECT 1 FROM CC.dbo.tkt_UserTimeSchedules WHERE UserID = $schedule_user_id AND ScheduleDate = $schedule_date);

SELECT 'json' AS component,
(
    SELECT CAST(CASE WHEN $schedule_error IS NULL THEN 1 ELSE 0 END AS BIT) AS success,
           CASE $schedule_error
             WHEN 'access_denied' THEN 'Time schedules are limited to user type 7.'
             WHEN 'date_invalid' THEN 'Enter a valid date.'
             WHEN 'time_invalid' THEN 'End time must be after start time.'
             WHEN 'break_invalid' THEN 'Enter a valid break duration.'
             WHEN 'break_too_long' THEN 'Break must be shorter than the scheduled shift.'
             ELSE 'Schedule saved.' END AS message
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS contents;
