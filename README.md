# XProtect Camera Renamer

Local Node tool to rename Milestone XProtect cameras through the XProtect API Gateway.

Designed for XProtect 2023 R3 or newer, where API Gateway is expected to be available. The tool detects common IDP and Configuration API routes before authentication.

## Tested route candidates

- IDP discovery:
  - `/API/IDP/.well-known/openid-configuration`
  - `/api/idp/.well-known/openid-configuration`
  - `/IDP/.well-known/openid-configuration`
  - `/idp/.well-known/openid-configuration`
- Token:
  - `/API/IDP/connect/token`
  - `/api/idp/connect/token`
  - `/IDP/connect/token`
  - `/idp/connect/token`
- Configuration API:
  - `/api/rest/v1`
  - `/API/rest/v1`

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
