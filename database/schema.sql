/*
Internal tickets database contract
==================================

The SQLPage app in this workspace expects these existing SQL Server tables:

- CC.dbo.tkt_InternalTickets
- CC.dbo.tkt_Comments
- CC.dbo.tkt_Attachments

IBLS requires the manually applied migration delivered in the IBLS setup package:
- tkt_InternalTickets.RequesterGroup NVARCHAR(20) NOT NULL, default Internal; permitted values Internal, IBLS and CRM after the CRM migration.
- User_info.Usertype 12 is IBLS. All IBLS users share all IBLS tickets, irrespective of creator.
- User_info.Usertype 13 is CRM. All CRM users share all CRM tickets, irrespective of creator; IBLS and CRM cannot read each other's tickets.
- Creation derives RequesterGroup from the authenticated session and preserves RequestedByUserID.
- Infinity API creation uses the fixed machine group Infinity and a NULL RequestedByUserID; ExternalCreatedBy NVARCHAR(120) NULL stores the external submitter name for the Created by display.
- Infinity requires createdBy, description, registration, clientName and clientContactNo; legacy form aliases remain supported. Category defaults to Event follow up and priority to Medium. Intake Department is fixed to CC (Call Centre).
- Infinity stores callback details in existing c_name/c_contact columns and initializes c_contacted to 0.
- Infinity intake forces priority Critical for category Dispatch Recovery Team, ignoring supplied priority; matching ignores case and surrounding spaces. Other categories retain the normal Medium default and valid caller priority.
- Infinity requires the existing RequesterGroup check to permit Infinity; review infinity-requester-group.sql.txt before activation. No database change is auto-executed.
- Authenticated normal users see Internal and Infinity tickets; IBLS and CRM retain exact group isolation.
- IBLS users create and read tickets; authorized internal staff manage them.
- New attachments use the private sqlpage/internaltickets_attachments directory and api_attachment.sql.
- Shared session resolution lives in the parent sqlpage/internaltickets_access.sql.
- Database setup scripts are intentionally outside the web root and are never auto-executed.

Do not create additional tables for this app.
Do not delete records from any database unless explicitly instructed.

The frontend uses SQLPage-hosted endpoints:

- api_tickets.sql: reads ticket summary and ticket list.
- api_ticket.sql: reads one ticket and its comments.
- create_ticket.sql: inserts into CC.dbo.tkt_InternalTickets.
- api_infinity_tickets.sql: create-only SQLPage POST form intake authenticated by an Infinity API key; empty HTTP 204 on success. server/infinityApp.js accepts JSON and forwards to SQLPage over HTTP without a separate database connection; proxy activation is required on SQLPage 0.25.
- add_comment.sql: inserts into CC.dbo.tkt_Comments.
- update_ticket.sql: updates existing records in CC.dbo.tkt_InternalTickets.
- api_current_user.sql: validates sqlpage.cookie('session') against Current_session and resolves Name/Surname from Jobcard.dbo.User_info.
*/
