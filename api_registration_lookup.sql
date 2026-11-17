SELECT 'json' AS component,
(
    SELECT
        request_data.reg AS registration,
        CAST(
            CASE
                WHEN EXISTS
                (
                    SELECT 1
                    FROM Risk.dbo.unitinfo unit_row
                    WHERE request_data.reg IS NOT NULL
                      AND UPPER(LTRIM(RTRIM(unit_row.reg_no))) = UPPER(LTRIM(RTRIM(request_data.reg)))
                      AND LOWER(LTRIM(RTRIM(COALESCE(unit_row.ctrltype, '')))) <> 'lmu ir'
                )
                AND EXISTS
                (
                    SELECT 1
                    FROM Risk.dbo.vehicleinfo vehicle_row
                    WHERE request_data.reg IS NOT NULL
                      AND UPPER(LTRIM(RTRIM(vehicle_row.reg_no))) = UPPER(LTRIM(RTRIM(request_data.reg)))
                )
                THEN 1
                ELSE 0
            END AS BIT
        ) AS exactFound,
        JSON_QUERY((
            SELECT TOP (1)
                unit_row.unit_id AS unit_id,
                vehicle_row.reg_no,
                vehicle_row.vehdesc,
                vehicle_row.company,
                vehicle_row.fleet_Code,
                vehicle_row.MakeDesc,
                vehicle_row.Colour AS color,
                vehicle_row.ChassisNo AS chassisno,
                vehicle_row.EngineNo AS engineno
            FROM Risk.dbo.vehicleinfo vehicle_row
            CROSS APPLY
            (
                SELECT TOP (1)
                    unit_lookup.unit_id
                FROM Risk.dbo.unitinfo unit_lookup
                WHERE request_data.reg IS NOT NULL
                  AND UPPER(LTRIM(RTRIM(unit_lookup.reg_no))) = UPPER(LTRIM(RTRIM(request_data.reg)))
                  AND LOWER(LTRIM(RTRIM(COALESCE(unit_lookup.ctrltype, '')))) <> 'lmu ir'
                ORDER BY unit_lookup.unit_id
            ) unit_row
            WHERE request_data.reg IS NOT NULL
              AND UPPER(LTRIM(RTRIM(vehicle_row.reg_no))) = UPPER(LTRIM(RTRIM(request_data.reg)))
            ORDER BY vehicle_row.reg_no
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        )) AS vehicle,
        JSON_QUERY((
            SELECT similar.reg_no
            FROM
            (
                SELECT DISTINCT CAST(vehicle_match.reg_no AS NVARCHAR(50)) AS reg_no
                FROM Risk.dbo.vehicleinfo vehicle_match
                WHERE request_data.base_reg IS NOT NULL
                  AND (
                      UPPER(LTRIM(RTRIM(vehicle_match.reg_no))) = UPPER(LTRIM(RTRIM(request_data.base_reg)))
                      OR UPPER(LTRIM(RTRIM(vehicle_match.reg_no))) LIKE UPPER(LTRIM(RTRIM(request_data.base_reg))) + '\_%' ESCAPE '\'
                  )
                UNION
                SELECT DISTINCT CAST(unit_match.reg_no AS NVARCHAR(50)) AS reg_no
                FROM Risk.dbo.unitinfo unit_match
                WHERE request_data.base_reg IS NOT NULL
                  AND LOWER(LTRIM(RTRIM(COALESCE(unit_match.ctrltype, '')))) <> 'lmu ir'
                  AND (
                      UPPER(LTRIM(RTRIM(unit_match.reg_no))) = UPPER(LTRIM(RTRIM(request_data.base_reg)))
                      OR UPPER(LTRIM(RTRIM(unit_match.reg_no))) LIKE UPPER(LTRIM(RTRIM(request_data.base_reg))) + '\_%' ESCAPE '\'
                  )
            ) similar
            ORDER BY similar.reg_no
            FOR JSON PATH
        )) AS similarRegistrations
    FROM
    (
        SELECT
            NULLIF(LTRIM(RTRIM(CAST($reg_no AS NVARCHAR(50)))), '') AS reg,
            CASE
                WHEN CHARINDEX('_', NULLIF(LTRIM(RTRIM(CAST($reg_no AS NVARCHAR(50)))), '')) > 0
                THEN LEFT(NULLIF(LTRIM(RTRIM(CAST($reg_no AS NVARCHAR(50)))), ''), CHARINDEX('_', NULLIF(LTRIM(RTRIM(CAST($reg_no AS NVARCHAR(50)))), '')) - 1)
                ELSE NULLIF(LTRIM(RTRIM(CAST($reg_no AS NVARCHAR(50)))), '')
            END AS base_reg
    ) request_data
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS contents;
