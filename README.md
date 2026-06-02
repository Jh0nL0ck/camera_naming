# Camera Renamer

Local Node tool for bulk renaming Milestone XProtect cameras through the XProtect API Gateway.

This tool is intended for systems with many cameras, where renaming each camera manually from XProtect Management Client can become slow and repetitive. It lets an operator connect to the VMS, load the configured camera list, select specific cameras or all visible cameras, define a naming pattern, preview the generated names, validate duplicates, and only then apply the changes in bulk.

The naming pattern can combine fixed text, site/building/floor/zone fields, the current camera name, camera ID, and an incremental counter. Before applying anything to XProtect, the UI shows the generated names so the operator can adjust the pattern safely.

## Requirements

- Node.js 18 or newer.
- Milestone XProtect 2023 R3 or newer.
- XProtect API Gateway enabled and reachable from the machine running this tool.
- A VMS user with permissions to read cameras and update camera configuration.
- Network access from the tool machine to the XProtect API Gateway.

## Usage

```powershell
npm start
```

Open `http://localhost:4174`.

## Workflow

1. Enter server, username, and password.
2. Detect Gateway routes.
3. Connect and obtain an access token.
4. Load cameras.
5. Select cameras.
6. Define the naming pattern.
7. Preview changes.
8. Confirm and apply.

## Authentication notes

- `HTTP 400` with `invalid_grant` and `InvalidCredentials` means the IDP route is valid, but the credentials or authentication mode were rejected.
- For XProtect basic users, use `Basic/password` and the XProtect username.
- For Windows or Active Directory users, try `DOMAIN\user` or `user@domain` with `Basic/password` first.
- `Windows credentials` may require integrated Windows authentication and may not work from a standalone Node request in every environment.
- The user must have permissions to read and update camera configuration.

## Safety

- No camera is renamed until the preview is generated and the final confirmation checkbox is checked.
- Internal or self-signed certificates can be allowed from the connection form.
