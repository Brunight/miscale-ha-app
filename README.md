# Mi Scale for Home Assistant

An Android app that listens for the **Xiaomi Mi Body Composition Scale 2** (XMTZC05HM, `MIBFS`)
over Bluetooth Low Energy and saves each weigh-in, with its body composition, to
**Home Assistant**. The phone is the receiver, so the scale doesn't need to be near the
HA server.

It replaces [miscale-dashboard](../miscale-dashboard)'s server-side scanner; the packet
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

1. In HA, open your profile › Security › **Long-lived access tokens** and create one. Each
   person uses a token from their own HA user.
2. Install the app, open Settings and fill in the HA URL, the token, your name, height,
   birth date and sex (the body composition formulas need them).
3. After the first weigh-in, the main screen shows the scale's address. Put it in
   Settings to ignore other scales nearby (optional).

To pre-fill the HA URL on every phone, copy `.env.example` to `.env` and set
`EXPO_PUBLIC_HA_URL` before building. It's read at build time, so rebuild after changing it.

`mobile_app` must be loaded in HA; it is when `default_config:` is in your configuration.
Plain `http://` URLs are allowed. Prefer the server's IP address to `homeassistant.local`,
since not every Android version resolves `.local` names.

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

Without a local Android SDK, build in the cloud with `bunx eas-cli build -p android --profile development`.

The `android/` folder is generated (`expo prebuild`) and not committed; native settings
live in `app.json`.

| Path | What it does |
| --- | --- |
| `src/lib/packet.ts` | Decodes the scale's 13-byte advertisement, drops repeats |
| `src/lib/session.ts` | Groups packets into one weigh-in (weight, then impedance) |
| `src/lib/body.ts` | Body composition formulas (openScale), identical to the dashboard's |
| `src/lib/identify.ts` | Decides whether a weigh-in is this phone's owner's |
| `src/lib/ha.ts` | mobile_app registration, sensor updates, household weights |
| `src/hooks/useScale.ts` | BLE permissions and scanning |
| `src/hooks/useWeighIn.ts` | Wait for impedance → identify → send or ask |
| `src/app/` | Screens: weigh-in (`index.tsx`) and settings |

## Not yet

- **Background scanning**: today the app scans only while it's open. Next is an Android
  foreground service plus a "Was that you?" notification for unclear weigh-ins.
- **Importing history** from miscale-dashboard's SQLite database into HA statistics.
