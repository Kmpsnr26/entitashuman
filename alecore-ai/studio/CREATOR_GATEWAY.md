# AleCore AI Creator Gateway

Creator Gateway is the authenticated entry surface for AleCore AI Live Studio.

## Security model

When `ALECORE_AI_CREATOR_PASSWORD` is configured, Studio API access is locked behind a bounded server-side Creator session.

- the password is never returned to the browser
- the session token is stored in an `HttpOnly`, `SameSite=Strict` cookie
- login failures are rate-limited
- unsafe AleCore AI events remain denied by the existing event allowlist
- camera and microphone permissions remain controlled by Chromium/Windows
- the gateway only probes media capability after a user action and immediately stops probe tracks
- raw API keys, tokens, database passwords and other secrets must never be rendered in Neural Space
- database/server connectors should expose health/status metadata only

If no Creator password is configured, the Studio stays in development mode so existing local tests and CI remain usable.

## Windows PowerShell

Use a strong local password that is not stored in the repository:

```powershell
$env:ALECORE_AI_CREATOR_USERNAME = 'creator'
$env:ALECORE_AI_CREATOR_PASSWORD = '<your-local-strong-password>'
npm run ale:studio
```

Then open the local Studio URL and authenticate through Creator Gateway.

To clear the credentials from the current PowerShell session:

```powershell
Remove-Item Env:ALECORE_AI_CREATOR_USERNAME -ErrorAction SilentlyContinue
Remove-Item Env:ALECORE_AI_CREATOR_PASSWORD -ErrorAction SilentlyContinue
```

## Capability states

Creator authentication does not mean every external resource is silently authorized.

- Camera: browser/OS permission required
- Microphone: browser/OS permission required
- Audio: browser user-activation rules apply
- Localhost: current Studio service
- Server: current Studio service
- Database: `NOT CONFIGURED` until a dedicated authenticated connector is registered

Future stages will add connector health metadata and edge HUD presentation without exposing credentials.
