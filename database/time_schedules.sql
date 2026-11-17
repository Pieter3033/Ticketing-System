IF OBJECT_ID('CC.dbo.tkt_UserTimeSchedules', 'U') IS NULL
BEGIN
    CREATE TABLE CC.dbo.tkt_UserTimeSchedules
    (
        ScheduleID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tkt_UserTimeSchedules PRIMARY KEY,
        UserID INT NOT NULL,
        ScheduleDate DATE NOT NULL,
        StartTime TIME(0) NOT NULL,
        EndTime TIME(0) NOT NULL,
        BreakMinutes INT NOT NULL CONSTRAINT DF_tkt_UserTimeSchedules_BreakMinutes DEFAULT (0),
        Notes NVARCHAR(1000) NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_tkt_UserTimeSchedules_CreatedAt DEFAULT (SYSDATETIME()),
        UpdatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_tkt_UserTimeSchedules_UpdatedAt DEFAULT (SYSDATETIME()),
        CONSTRAINT UQ_tkt_UserTimeSchedules_UserDate UNIQUE (UserID, ScheduleDate),
        CONSTRAINT CK_tkt_UserTimeSchedules_Times CHECK (EndTime > StartTime),
        CONSTRAINT CK_tkt_UserTimeSchedules_Break CHECK (BreakMinutes >= 0 AND BreakMinutes < 1440)
    );
END;
