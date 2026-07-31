# LinkedIn Adapter Specification

## 1. Overview

The LinkedIn adapter protects original assets during browser-based professional publishing workflows. It targets post, article, and media publish paths where the browser exposes the original upload event.

## 2. Supported Workflows

- Feed post with image or video upload
- Professional content sharing where browser file selection is used
- Limited article or document attachment flows where the original browser file is available

## 3. Supported Capture Methods

- File picker: `Yes`
- Drag-and-drop: `Partial`
- Export: `No`
- Clipboard: `Partial`, only if the browser exposes the original file object in an upload flow

## 4. What PinIT Can Capture

- Original file bytes
- File metadata
- Upload page URL
- Page title and browser-visible publishing context
- Partial page/profile/company hints
- Final post URL if it becomes visible after publish

## 5. What PinIT Cannot Capture

- viewer identity
- private analytics not visible to browser
- internal LinkedIn object state not reflected in the page
- private messages or private shares

## 6. Capability Classification

### Browser-only

- file input detection,
- some drag-drop detection,
- original file capture,
- browser-visible post URL detection.

### Requires OAuth/API

- exact page/company identity,
- some object IDs,
- enterprise account attribution,
- richer document/article metadata.

### Not technically available

- private message flows,
- private viewer analytics,
- downstream device activity.

## 7. Capture Flow

1. User opens LinkedIn publish composer.
2. Adapter initializes on supported composer surface.
3. Adapter listens for upload events.
4. User selects original file.
5. Adapter captures the original browser `File`.
6. Adapter extracts upload page URL and visible account/page context.
7. Adapter queues protect request.
8. Background worker uploads to PinIT backend.
9. Adapter watches for final post URL after publish.
10. If found, adapter binds URL and updates monitoring context.

## 8. Public URL Detection

Primary methods:

- DOM observation of post result state
- mutation-driven detection
- navigation/history changes

Fallback:

- preserve upload page URL only,
- allow later metadata reconciliation.

## 9. Monitoring Enrollment

Register:

- platform: `linkedin`
- upload page URL
- final post URL when available
- profile/page/company hints
- capture mode metadata

## 10. Failure Modes

- composer UI changes
- drag-drop handled differently from file input
- post URL not immediately visible
- backend unavailable
- company-page and personal-page flows diverge

Recovery behavior:

- queue-first persistence,
- retry protection upload,
- delayed URL binding,
- fallback to manual or degraded state where necessary.

## 11. Permissions Required

- `storage`
- `alarms`
- Host permissions for `linkedin.com`
- OAuth/API: optional future enhancement for stronger company/page identity

## 12. Testing Checklist

- Image post upload flow
- Video post upload flow
- Drag-and-drop where available
- Company page vs personal profile publishing
- Final post URL detection
- Browser restart recovery
- Backend outage recovery
- LinkedIn composer regression checks
