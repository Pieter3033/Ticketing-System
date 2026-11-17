-- Resolve access from the authenticated SQLPage session, never from supplied role/group fields.
SET ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SET ticket_user_id = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userId'));
SET ticket_user_type = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userType'));
SET ticket_is_requester = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].isRequester')), 0);
SET ticket_requester_group = JSON_VALUE($ticket_identity, '$[0].requesterGroup');
SET ticket_staff_access = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].canManageRequesterGroups')), 0);
SET software_access_allowed = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].softwareAllowed')), 0);
SET ticket_manage_access = CASE WHEN $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL AND $ticket_is_requester = 0 THEN 1 ELSE 0 END;

SELECT 'json' AS component,
(
    SELECT
        CASE WHEN current_user_info.user_type IN (7, 8, 14) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS isAuthorized,
        CASE
            WHEN current_user_info.user_type NOT IN (7, 8, 14) OR current_user_info.user_type IS NULL
            THEN 'Escalation access requires a Call Centre or Reload profile.'
            WHEN TRY_CONVERT(INT, $escalationId) IS NULL
            THEN 'No unique escalation ID was supplied.'
            ELSE NULL
        END AS message,
        JSON_QUERY((
            SELECT TOP (1)
                detail.id,
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
                detail.gen_note
            FROM CC.dbo.el_escalation detail
            WHERE current_user_info.user_type IN (7, 8, 14)
              AND detail.id = TRY_CONVERT(INT, $escalationId)
            FOR JSON PATH
        )) AS escalationDetails
    FROM (
        SELECT
            (
                SELECT TOP (1) user_info.Usertype
                FROM Jobcard.dbo.User_info user_info
                WHERE user_info.Username = NULLIF(LTRIM(RTRIM(CAST(JSON_VALUE($ticket_identity, '$[0].username') AS NVARCHAR(200)))), '')
            ) AS user_type
    ) current_user_info
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS contents;
