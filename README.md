# Mi Scale for Home Assistant

An Android app that listens for the **Xiaomi Mi Body Composition Scale 2** (XMTZC05HM, `MIBFS`)
over Bluetooth Low Energy and saves each weigh-in, with its body composition, to
**Home Assistant**. The phone is the receiver, so the scale doesn't need to be near the
HA server.

It replaces [miscale-dashboard](https://github.com/BrOrlandi/miscale-dashboard)'s server-side scanner; the packet
parser, weigh-in grouping and body composition formulas are ported from it.

## How it works

1. Open the app and step on the scale. The phone reads the scale's advertisements (service
   data `0x181B`); nothing pairs or connects.
2. The app waits for the stabilized weight and, if you're barefoot, the impedance (up to
   25 s), then computes BMI, body fat, muscle, water, bone, protein, visceral fat and BMR.
3. It decides whose weigh-in it is (below) and sends it to Home Assistant.

### In Home Assistant

Each phone registers itself through the **mobile_app** integration, the same way the
Companion app does, as a device named `Mi Scale <name>` with these sensors (all with
`state_class: measurement`, so HA keeps long-term statistics):

Weight, Impedance, BMI, Body fat, Fat mass, Lean mass, Muscle mass, Bone mass, Body water,
Protein, Visceral fat, Basal metabolism.

Every state carries `measured_at` and `scale_time` attributes. The weight sensor also carries
`miscale_person` and `miscale_device`, which is how the phones find each other.

### Who stepped on the scale

Each person uses their own phone and their own HA user. Before sending, a phone reads every
household member's latest weight from HA and checks who the weight is closest to:

- **This phone's owner, clearly** → saved automatically.
- **Someone else**, **nobody within the tolerance**, or **the owner but someone else is
  within 1 kg as well** → the app asks "Save as mine / Not me".
- A person's very first weigh-in is theirs unless it matches someone else's weight.

Every phone reads the same data, so they reach the same answer without talking to each other.

## Setup

1. Install the app and open Settings. The HA URL is pre-filled from `EXPO_PUBLIC_HA_URL`
   (see [Releasing](#releasing)); otherwise tap **Find on this network** and pick your
   Home Assistant, or type its URL.
2. Tap **Log in to Home Assistant** and sign in on HA's own login page with **your own HA
   user**. No token to create or paste.
3. Fill in your name, height, birth date and sex (the body composition formulas need them)
   and save.
4. After the first weigh-in, the main screen shows the scale's address. Put it in
   Settings to ignore other scales nearby (optional).

Notes:

- The login works like the Companion app's: HA gives the app a refresh token, listed in
  your HA profile under **Refresh tokens**, where you can revoke it. **Log out** in the app
  revokes it too.
- HA identifies the app by `https://brunight.github.io/miscale-ha-app/`
  ([docs/index.html](docs/index.html), served by GitHub Pages), which declares the
  `miscale://auth` redirect. HA fetches that page while you log in, so **the HA server needs
  internet access**. If it doesn't have it, use **Use a long-lived token instead** in
  Settings and paste a token from your HA profile › Security.
- `mobile_app` must be loaded in HA; it is when `default_config:` is in your configuration.
- Plain `http://` URLs are allowed. Prefer the server's IP address to `homeassistant.local`,
  since not every Android version resolves `.local` names; **Find on this network** already
  picks the IP address.

## Development

Expo (SDK 58) with a development build: BLE needs native code, so Expo Go won't work.

```bash
bun install
bun run android      # builds and installs the dev build on a connected phone (needs the Android SDK)
bun run start        # starts Metro for an installed dev build
bun test             # unit tests (parser, weigh-in grouping, body composition, identification, HA client)
bun run typecheck
bun run lint
```

### Releasing

The app is on EAS (`@brunight/miscale-ha-app`), which also holds the Android signing key.

```bash
bun run build:apk                 # APK built on this machine with the EAS key → ../miscale-ha-app-apks/miscale.apk
bun run update -m "what changed"  # over-the-air update of the JS for every installed phone
```

- **JS-only changes** (screens, logic, styles) go out with `bun run update`. Phones download it on
  launch and use it from the next launch.
- **Native changes** (new native libraries, `app.json` plugins, permissions, Expo SDK) need a new
  APK. The runtime version is a fingerprint of the native code, so an update is never sent to an
  APK it doesn't match; a stale phone just keeps its current version until the new APK is installed.
- `EXPO_PUBLIC_HA_URL` for builds and updates is an EAS environment variable
  (`bunx eas-cli env:list production`); `.env` is only used by `bun run start`.
- Building needs `ANDROID_HOME=~/Android/Sdk` and a JDK 21 `JAVA_HOME`. Without a local SDK, drop
  `--local` to build in EAS's cloud.

The `android/` folder is generated (`expo prebuild`) and not committed; native settings
live in `app.json`.

| Path | What it does |
| --- | --- |
| `src/lib/packet.ts` | Decodes the scale's 13-byte advertisement, drops repeats |
| `src/lib/session.ts` | Groups packets into one weigh-in (weight, then impedance) |
| `src/lib/body.ts` | Body composition formulas (openScale), identical to the dashboard's |
| `src/lib/identify.ts` | Decides whether a weigh-in is this phone's owner's |
| `src/lib/ha.ts` | mobile_app registration, sensor updates, household weights |
| `src/lib/auth.ts` | HA login (OAuth2 with PKCE), token refresh, log out |
| `src/lib/discovery.ts` | Picks the URL of a Home Assistant found with mDNS |
| `src/hooks/useScale.ts` | BLE permissions and scanning |
| `src/hooks/useWeighIn.ts` | Wait for impedance → identify → send or ask |
| `src/app/` | Screens: weigh-in (`index.tsx`) and settings |

## Not yet

- **Background scanning**: today the app scans only while it's open. Next is an Android
  foreground service plus a "Was that you?" notification for unclear weigh-ins.
- **Importing history** from miscale-dashboard's SQLite database into HA statistics.

## License

MIT. The packet parser, weigh-in grouping and body composition formulas are ported from
[miscale-dashboard](https://github.com/BrOrlandi/miscale-dashboard) by Bruno Orlandi (MIT); see
[LICENSE](LICENSE).
