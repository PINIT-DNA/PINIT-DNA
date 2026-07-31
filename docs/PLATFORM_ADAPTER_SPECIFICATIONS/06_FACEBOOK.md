# Facebook Adapter Specification

## 1. Overview

The Facebook adapter protects original assets during browser-based post and media publishing workflows. It focuses on explicit upload actions in supported composer surfaces and does not inspect passive browsing or feed content.

## 2. Supported Workflows

- Feed post with image or video upload
- Page publishing flows where browser file selection is visible
- Limited reel/story-adjacent support when the browser upload workflow exposes the original file

## 3. Supported Capture Methods

- File picker: `Yes`
- Drag-and-drop: `Partial`
- Export: `No`
- Clipboard: `Partial`

## 4. What PinIT Can Capture

- Original file bytes
- File metadata
- Upload page URL
- Browser-visible profile or page hints
- Final public post URL when visible after publish

## 5. What PinIT Cannot Capture

- private analytics
- viewer identity
- private messages
- platform-internal events not surfaced to the browser

## 6. Capability Classification

### Browser-only

- file input detection,
- original file capture,
- some drag-drop handling,
- some public URL detection after publish.

### Requires OAuth/API

- exact page/business identity,
- richer object IDs and business metadata,
- enterprise account attribution.

### Not technically available

- viewer identity,
- private shares,
- private analytics,
- downstream device opens.

## 7. Capture Flow

1. User opens Facebook composer.
2. Adapter initializes and verifies supported publish surface.
3. Adapter listens for upload events.
4. User selects original file.
5. Adapter captures browser `File`.
6. Adapter extracts upload page URL and visible page/profile hints.
7. Adapter queues protect request.
8. Background worker uploads to PinIT backend.
9. Adapter watches for final public URL if surfaced.

## 8. Public URL Detection

Primary methods:

- DOM observation
- mutation-driven publish-result detection
- navigation/history changes

Fallback:

- preserve upload page URL only,
- allow later reconciliation if public URL becomes known.

## 9. Monitoring Enrollment

Register:

- platform: `facebook`
- upload page URL
- final post URL when available
- page/profile hints
- capture mode

## 10. Failure Modes

- composer UI changes
- page and profile publish flows diverge
- post URL not surfaced immediately
- backend unavailable

Recovery behavior:

- queue first,
- retry asynchronously,
- degraded URL binding state if needed,
- manual protect fallback for broken automation.

## 11. Permissions Required

- `storage`
- `alarms`
- Host permissions for `facebook.com`
- OAuth/API: optional future enhancement for page/business enrichment

## 12. Testing Checklist

- Image upload flow
- Video upload flow
- Page publish vs personal profile flow
- Drag-and-drop behavior
- Post URL discovery
- Queue replay after browser restart
- Backend outage recovery
- Facebook composer regression checks
