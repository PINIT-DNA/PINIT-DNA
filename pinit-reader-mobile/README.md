# PINIT Reader (mobile)

Local Android and iOS app for opening a `.pinit` file. It reuses the browser Reader's rules: the file is only a share token, and the PINIT Hub decides on every open.

The browser Reader at `http://localhost:3010` is unchanged.

## Run it locally

1. Start the Hub from the main project so it is listening on port 4000.
2. In this folder:

```bash
npm start
```

3. Open the project in Expo Go, or press `a` if an Android emulator is running.

### Which Hub address the phone uses

`localhost` on a phone is the phone, not your computer.

| Where the app runs | Hub address used in development |
|---|---|
| Android emulator | `http://10.0.2.2:4000/api/v1` |
| iOS simulator | `http://127.0.0.1:4000/api/v1` |
| Physical phone, USB | `http://127.0.0.1:4000/api/v1` after `adb reverse tcp:4000 tcp:4000` |
| Physical phone, same Wi-Fi | set `EXPO_PUBLIC_HUB_API_BASE` |

Example for a phone on Wi-Fi, using your computer's LAN address:

```bash
set EXPO_PUBLIC_HUB_API_BASE=http://192.168.1.4:4000/api/v1
npm start
```

A release build uses `https://pinit-dna-uf5y.onrender.com/api/v1` unless that variable is set.

## Open a real .pinit

In Expo Go, tap **Open a .pinit file** and choose a `.pinit` saved from the Hub. The app reads the token, asks the Hub, and shows the protected file only if the Hub allows it.

Tapping a `.pinit` in Files, WhatsApp, or Gmail requires an Android or iOS build (`npx expo run:android`). Expo Go cannot register the `.pinit` file type. No Play Store or App Store upload is part of this project.

## Checks

```bash
npm test
npm run typecheck
```
