# HumanALE Live — Android private test candidate

This candidate adds an actual native viewer for NARA runtime services. It does
not package Node/PostgreSQL inside the APK. The server must run in Termux or on
an explicitly configured HTTPS host.

## Install and connect

The test profile uses `id.my.aleprinting.humanale.live`, named **HumanALE Live**,
so the existing HumanALE application and its data remain separate. This is a
debug-signed private candidate, not a production release certificate.

Open **Buka NARA Live**, enter the running service URL, and press **Buka runtime**:

| Service | Runtime URL | Separate login origin |
| --- | --- | --- |
| Termux NARA Core Studio | `http://127.0.0.1:4178` | Leave empty |
| Local NARA Cloud AI | `http://127.0.0.1:4200` | `http://127.0.0.1:4100` |
| Deployed NARA Cloud | Configured HTTPS NARA origin | Configured HTTPS Auth origin |

Studio requires its existing local Owner credentials and streams actual core
state, events, and telemetry over SSE. Its test controls generate explicitly
simulated events; opening Studio does not start desktop agents or AI inference.

Cloud uses the existing PostgreSQL Owner SSO and server-side provider keys.
The authenticated root now has a mobile chat console using `/api/me`,
`/api/ai/providers`, and `/api/ai/stream`. A configured provider is shown as
available to try; successful inference is reported only after a complete stream.
Provider credentials never enter the APK. Cloud and Studio have different
credential stores; this change does not copy or reset either store.

## Start Studio on the phone

In the repository checkout containing this change:

```sh
npm ci --omit=dev --omit=optional --ignore-scripts
bash scripts/start-android-live.sh
```

The launcher binds only `127.0.0.1:4178` and preserves the existing Owner store.
If credentials are not provisioned, the service stays locked. For first-time
provisioning only, supply `NARA_CREATOR_USERNAME` and a private
`NARA_CREATOR_PASSWORD` in the Termux process before startup, following the
existing Creator Gateway contract. Do not place a real password in source or
send it to the assistant. After provisioning, the stored identity remains
authoritative. Keep the process running while using the APK.

Cloud setup follows `nara-cloud/README.md`: supported Node 22, PostgreSQL,
migrations, existing Owner, and server-side provider configuration. Deployment
requires HTTPS, configured public origins, and streaming proxy buffering off.
No service has been deployed by creating this candidate.

## Reproduce the APK

Use Node 22, Java 21, Android SDK 35 and the pinned Capacitor 7.6.9 tooling:

```sh
npm ci --omit=dev --omit=optional --ignore-scripts
npm install --no-save --package-lock=false --ignore-scripts --omit=dev --omit=optional @capacitor/core@7.6.9 @capacitor/cli@7.6.9 @capacitor/android@7.6.9
npm run build
node scripts/prepare-android-live-build.mjs ../humanale-live-build
cd ../humanale-live-build
npx cap add android
node scripts/prepare-android.mjs
npx cap sync android
cd android
./gradlew assembleDebug --no-daemon
```

The stage directory must be empty. Production `capacitor.config.json` is not
rewritten. Verify the generated APK application ID, debug signature, alignment,
web asset hashes, and native runtime plugin before distributing the candidate.
Debug keystores are never committed or included with downloads.

## Runtime boundaries and acceptance

The viewer is a separate, non-exported Android Activity without a native JS
bridge. It permits only the chosen runtime and optional auth origins, HTTPS for
online services, and exact loopback HTTP for local services. TLS errors cancel,
file/content access is off, third-party cookies are off, and sensor permission
requests are denied. The existing bundled avatar/native speech features remain
in the original Capacitor screen.

Opening a viewer is not proof of a connected or authenticated server. Its
loading/error bar and the server's own runtime status make this distinction.
Local web/JVM tests and APK compilation do not replace physical Android
acceptance. Production signing, final readiness, and Creator release approval
remain separate gates.
