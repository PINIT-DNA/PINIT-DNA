# YouTube Studio Adapter Specification

## 1. Overview

The YouTube Studio adapter protects original video assets during browser-based upload and publish flows in `studio.youtube.com`. It is a core adapter because it represents the most visible "upload once, protect automatically" workflow for creators.

## 2. Supported Workflows

- Video upload from YouTube Studio file picker
- Drag-and-drop into the Studio uploader
- Draft creation where original file is already captured
- Limited support for Shorts if the same browser upload primitives are exposed

## 3. Supported Capture Methods

- File picker: `Yes`
- Drag-and-drop: `Yes`
- Export: `No`
- Clipboard: `No`

## 4. What PinIT Can Capture

- Original video file bytes
- File metadata: filename, size, MIME type
- Upload page URL
- Studio page context
- Partial channel or account hints visible in browser state
- Final public watch URL if surfaced after upload or publish

## 5. What PinIT Cannot Capture

- Viewer identity
- YouTube private analytics not exposed to the extension
- Subscriber analytics
- Private sharing state
- Platform events that occur entirely on the backend without browser reflection

## 6. Capability Classification

### Browser-only

- File picker detection
- Drag-and-drop detection
- Original file capture
- Upload page URL capture
- Some browser-visible publish state observation

### Requires OAuth/API

- Exact channel ID validation
- exact video ID and metadata reconciliation in all cases
- private or draft state enrichment beyond what the browser reveals

### Not technically available

- downstream viewer identity
- private sharing analytics
- third-party device opens of downloaded files

## 7. Capture Flow

1. User opens YouTube Studio upload flow.
2. Adapter initializes and confirms upload page context.
3. Adapter listens for file input and drop events.
4. User selects or drops original video.
5. Adapter captures original `File` before YouTube processing.
6. Adapter queues protect request immediately.
7. Background worker uploads the original to PinIT.
8. PinIT creates Vault, DNA, Certificate, and Monitoring context.
9. Adapter watches for publish-progress and final URL signals.
10. When public URL is known, adapter binds it to the protected asset.

## 8. Public URL Detection

Primary methods:

- DOM observation of publish result UI
- mutation-driven detection of surfaced watch links
- navigation/history changes

Fallback:

- retain `uploadPageUrl`,
- mark `publicUrlPending`,
- allow later URL binding through OAuth/API enrichment or user confirmation.

## 9. Monitoring Enrollment

Register:

- platform: `youtube`
- upload page URL
- watch URL when available
- channel/page hints when known
- capture mode and timestamp

## 10. Failure Modes

- Studio UI changes file-input structure
- drag-drop handled by a different internal layer than expected
- watch URL appears only after long processing delay
- user closes tab before publish completes
- backend unavailable while upload continues

Recovery behavior:

- queue-first protect request,
- background retries,
- delayed public URL binding,
- degraded state if protection succeeded but URL linking failed.

## 11. Permissions Required

- `storage`
- `alarms`
- Host permissions for `studio.youtube.com`
- `activeTab` or `scripting` only for explicit manual fallback behavior if needed
- OAuth/API: optional future enhancement for stronger channel/video metadata

## 12. Testing Checklist

- Single video file picker flow
- Drag-and-drop upload flow
- Large video upload behavior
- Draft save flow
- Publish completion and watch URL discovery
- Browser refresh or close during upload
- Service worker restart during queue flush
- Backend outage recovery
- Studio DOM regression checks
