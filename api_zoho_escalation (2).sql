-- Legacy duplicate route: requester users must use the canonical group-scoped ticket module.
SET legacy_ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SELECT 'redirect' AS component, '/internaltickets/index.html' AS link
WHERE JSON_VALUE($legacy_ticket_identity, '$[0].userId') IS NULL
   OR COALESCE(TRY_CONVERT(INT, JSON_VALUE($legacy_ticket_identity, '$[0].canManageRequesterGroups')), 0) <> 1;

SELECT 'json' AS component,
(
    SELECT
        CASE WHEN current_user_info.user_type IN (7, 8) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS isAuthorized,
        CASE
            WHEN current_user_info.user_type NOT IN (7, 8) OR current_user_info.user_type IS NULL
            THEN 'Escalation access is limited to usertype 7 and 8.'
            WHEN NULLIF(LTRIM(RTRIM(CAST($zohoId AS NVARCHAR(100)))), '') IS NULL
            THEN 'No Zoho account ID was supplied for this escalation.'
            ELSE NULL
        END AS message,
        JSON_QUERY((
            SELECT TOP (1)
                detail.zoho_id,
                detail.[update],
                detail.verification_password,
                detail.auth_person,
                detail.auth_notes,
                detail.group_notes,
                detail.d_c_name_1, detail.d_c_name_2, detail.d_c_name_3, detail.d_c_name_4, detail.d_c_name_5,
                detail.d_c_no_1, detail.d_c_no_2, detail.d_c_no_3, detail.d_c_no_4, detail.d_c_no_5,
                detail.d_c_alt_no_1, detail.d_c_alt_no_2, detail.d_c_alt_no_3, detail.d_c_alt_no_4, detail.d_c_alt_no_5,
                detail.d_c_notes_1, detail.d_c_notes_2, detail.d_c_notes_3, detail.d_c_notes_4, detail.d_c_notes_5,
                detail.n_c_name_1, detail.n_c_name_2, detail.n_c_name_3, detail.n_c_name_4, detail.n_c_name_5,
                detail.n_c_no_1, detail.n_c_no_2, detail.n_c_no_3, detail.n_c_no_4, detail.n_c_no_5,
                detail.n_c_alt_no_1, detail.n_c_alt_no_2, detail.n_c_alt_no_3, detail.n_c_alt_no_4, detail.n_c_alt_no_5,
                detail.n_c_notes_1, detail.n_c_notes_2, detail.n_c_notes_3, detail.n_c_notes_4, detail.n_c_notes_5,
                detail.we_c_name_1, detail.we_c_name_2, detail.we_c_name_3, detail.we_c_name_4, detail.we_c_name_5,
                detail.we_c_no_1, detail.we_c_no_2, detail.we_c_no_3, detail.we_c_no_4, detail.we_c_no_5,
                detail.we_c_alt_no_1, detail.we_c_alt_no_2, detail.we_c_alt_no_3, detail.we_c_alt_no_4, detail.we_c_alt_no_5,
                detail.we_c_notes_1, detail.we_c_notes_2, detail.we_c_notes_3, detail.we_c_notes_4, detail.we_c_notes_5,
                detail.po_notes,
                detail.jamming_notes,
                detail.panic_notes,
                detail.remote_panic_notes,
                detail.tamper_notes,
                detail.dph_notes,
                detail.cap_notes,
                detail.tilt_notes,
                detail.harness_t_notes,
                detail.gate_jam_notes,
                detail.trailer_dis_notes,
                detail.battery_dis_notes,
                detail.limp_geofence_notes,
                detail.fatigue_notes,
                detail.travel_stop_notes,
                detail.removed_notes,
                detail.limp_activate_notes,
                detail.max_time_exceed_notes,
                detail.moving_out_of_geofence_notes,
                detail.please_call_me_notes
            FROM Pulsit_comparison.dbo.Zoho_Escalation_List detail
            WHERE current_user_info.user_type IN (7, 8)
              AND NULLIF(LTRIM(RTRIM(CAST($zohoId AS NVARCHAR(100)))), '') IS NOT NULL
              AND TRY_CONVERT(NVARCHAR(100), detail.zoho_id) = NULLIF(LTRIM(RTRIM(CAST($zohoId AS NVARCHAR(100)))), '')
            FOR JSON PATH
        )) AS escalationDetails
    FROM (
        SELECT
            (
                SELECT TOP (1) user_info.Usertype
                FROM Jobcard.dbo.User_info user_info
                WHERE user_info.Username = NULLIF(LTRIM(RTRIM(CAST(COALESCE(sqlpage.cookie('username'), sqlpage.cookie('Username')) AS NVARCHAR(200)))), '')
            ) AS user_type
    ) current_user_info
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS contents;
