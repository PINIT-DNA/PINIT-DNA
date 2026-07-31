# WordPress Adapter Specification

## 1. Overview

The WordPress adapter protects original assets uploaded through browser-based publishing and media-library workflows. It must support a wide variety of installations while accepting that plugins, editors, and site customizations make WordPress one of the most variable adapter targets.

## 2. Supported Workflows

- Media library upload
- Post or page editor media upload
- Explicit browser upload flows in `wp-admin`

## 3. Supported Capture Methods

- File picker: `Yes`
- Drag-and-drop: `Partial`
- Export: `No`
- Clipboard: `Partial`

## 4. What PinIT Can Capture

- Original file bytes
- File metadata
- `wp-admin` upload or editor URL
- Site context visible in the browser
- Final public post URL when editor or publish UI exposes it

## 5. What PinIT Cannot Capture

- plugin-internal state not exposed in browser UI
- exact CMS object metadata in all custom installations
- downstream viewer identity
- private analytics

## 6. Capability Classification

### Browser-only

- media upload detection,
- original file capture,
- site/editor URL capture,
- some public URL detection after publish.

### Requires OAuth/API

- exact REST object mapping in some installations,
- multisite or enterprise editorial enrichment,
- stronger user/role attribution.

### Not technically available

- private reader identity,
- plugin-private metadata not surfaced to browser,
- downstream local-file activity.

## 7. Capture Flow

1. User opens supported WordPress admin workflow.
2. Adapter initializes on `wp-admin` surface.
3. Adapter listens for file-input and possible drop-zone events.
4. User selects original file.
5. Adapter captures original `File`.
6. Adapter extracts admin URL and site/editor context.
7. Adapter queues protect request.
8. Background worker uploads to PinIT backend.
9. Adapter attempts to bind final post URL when publish completes.

## 8. Public URL Detection

Primary methods:

- DOM observation of published permalink
- mutation-driven editor state changes
- navigation/history changes

Fallback:

- preserve `wp-admin` upload page URL,
- bind public URL later when available,
- allow optional REST-assisted enrichment.

## 9. Monitoring Enrollment

Register:

- platform: `wordpress`
- admin/upload URL
- public post URL when available
- site context
- capture mode metadata

## 10. Failure Modes

- classic editor and block editor differ
- plugins replace upload controls
- public permalink not immediately surfaced
- multisite or custom admin routes change assumptions
- backend unavailable

Recovery behavior:

- queue and retry,
- retain authoritative original,
- leave URL binding pending when needed,
- degrade gracefully across site variants.

## 11. Permissions Required

- `storage`
- `alarms`
- Host permissions for WordPress admin paths on supported domains
- OAuth/API: optional future enhancement for stronger object linkage

## 12. Testing Checklist

- Media library upload
- Post editor upload
- Classic editor vs block editor where applicable
- Drag-and-drop handling
- Public permalink detection after publish
- Queue replay and browser restart recovery
- Backend failure recovery
- Regression checks across representative WordPress variants
