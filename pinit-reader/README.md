# PINIT Reader

Local application that opens a `.pinit` file and asks the existing PINIT Hub whether that share can be viewed.

The `.pinit` file is a small JSON carrier. It is not the photo, video, or document. The Hub still authorizes the share, records the view, and returns the file.

This folder is separate from the Hub web app. Do not commit it to the Hub repository unless that is requested later.

## Run locally

1. Start the Hub backend on port 4000.
2. From this folder:

```
npm install
npm test
npm run dev
```

3. Open http://localhost:3010
4. Choose a `.pinit` file created by the Hub.

While `npm run dev` is running, the Reader calls `/api` on port 3010 and Vite forwards that to the Hub at `http://127.0.0.1:4000`. Set `VITE_HUB_API_BASE` to call a different Hub address directly.

In development, the screen shows the extracted token. A production build does not.
