# Instagram Web Adapter Specification

## 1. Overview

The Instagram Web adapter protects user-owned originals during intentional publish workflows on Instagram's browser experience. It focuses on feed post and reel-oriented media flows and does not attempt to inspect general browsing, feed scrolling, or private sharing behavior.

## 2. Supported Workflows

- Create post with image or video upload
- Create reel with media upload when browser flow exposes original file
- Limited support for story-adjacent flows where browser upload widgets are exposed
- Manual protect fallback on explicitly user-selected media

## 3. Supported Capture Methods

- File picker: `Yes`
- Drag-and-drop: `Partial`
- Export: `No`
- Clipboard: `Partial`, only if Instagram exposes a browser upload path compatible with original file capture

## 4. What PinIT Can Capture

- Original file bytes when selected via browser upload controls
- File metadata: filename, MIME type, size
- Upload page URL
- Page title and browser-visible platform context
- Partial profile/account hints from page state
- Final public permalink if it becomes visible after publish

## 5. What PinIT Cannot Capture

- Private analytics
- Viewer identity
- Private messages or private shares
- Exact downstream repost counts inside Instagram private surfaces
- Platform-internal events not exposed to the browser

## 6. Capability Classification

### Browser-only

- Detect file input selection
- Capture original file bytes
- Observe upload composer context
- Attempt late permalink detection via DOM or mutation

### Requires OAuth/API

- Strong account/business identity confirmation
- Some post IDs or internal object identifiers
- Enterprise team attribution

### Not technically available

- Private DM flow visibility
- Viewer identity
- Private share analytics

## 7. Capture Flow

1. User opens Instagram publish or reel composer.
2. Adapter initializes and confirms supported composer surface.
3. Adapter listens for file input or drag-drop events.
4. User selects original file.
5. Adapter captures original browser `File`.
6. Adapter extracts page URL and available account hints.
7. Adapter queues protect request immediately.
8. Background worker uploads to PinIT backend asynchronously.
9. User's Instagram upload continues.
10. Adapter watches for permalink or publish-result state.
11. If found, adapter registers final public URL.

## 8. Public URL Detection

Primary methods:

- DOM observation for permalink anchors
- `MutationObserver` for publish completion UI
- navigation/history changes

Fallback:

- leave asset linked only to upload page URL,
- permit later user confirmation or backend reconciliation.

## 9. Monitoring Enrollment

Register:

- platform: `instagram`
- upload page URL
- final post/reel URL when available
- profile URL when known
- page title and capture mode

## 10. Failure Modes

- UI changes remove or rename upload widget
- Reel/stories composer diverges from feed composer
- Drag-drop bypasses expected input event
- Publish completes without visible permalink
- Network/backend failure during protect upload

Recovery behavior:

- queue-first local persistence,
- retry asynchronously,
- mark URL binding as pending,
- fallback to manual protect if automation breaks.

## 11. Permissions Required

- `storage`
- `alarms`
- `activeTab` for explicit manual fallbacks if needed
- Host permissions for `instagram.com`
- OAuth/API: optional for future enrichment, not required for browser-only baseline

## 12. Testing Checklist

- Single image file picker flow
- Single video file picker flow
- Drag-and-drop where supported
- Multi-file attempt behavior and expected limits
- Reel publish flow
- Post permalink detection after publish
- Browser close/reopen before queue flush
- Backend offline during publish
- DOM regression check against latest web composer
