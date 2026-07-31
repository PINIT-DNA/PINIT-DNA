# Shopify Adapter Specification

## 1. Overview

The Shopify adapter protects original assets uploaded through browser-based merchant workflows such as product media and related store-management surfaces. It is a hybrid adapter because browser-only capture is feasible, but precise store and object attribution is stronger with official Shopify APIs.

## 2. Supported Workflows

- Product media upload
- Explicit browser-managed store asset uploads in supported admin surfaces
- Other merchant upload flows where the browser exposes original files

## 3. Supported Capture Methods

- File picker: `Yes`
- Drag-and-drop: `Partial`
- Export: `No`
- Clipboard: `No`

## 4. What PinIT Can Capture

- Original file bytes
- File metadata
- Shopify admin page URL
- browser-visible store and product context hints
- some final storefront or admin object URLs when visible

## 5. What PinIT Cannot Capture

- complete product/store object mapping without API help
- viewer identity
- private analytics
- internal platform events not exposed to browser UI

## 6. Capability Classification

### Browser-only

- file picker detection,
- original file capture,
- admin page URL and partial store/product context capture.

### Requires OAuth/API

- exact product IDs,
- media object IDs,
- store/org identity reconciliation,
- richer merchant workflow attribution.

### Not technically available

- viewer identity,
- private analytics without access,
- downstream local-file activity outside browser visibility.

## 7. Capture Flow

1. User opens supported Shopify admin upload flow.
2. Adapter initializes on known admin surface.
3. Adapter listens for file-input and relevant upload events.
4. User selects original file.
5. Adapter captures original browser `File`.
6. Adapter extracts admin URL and visible store/product hints.
7. Adapter queues protect request.
8. Background worker uploads to PinIT backend.
9. Adapter or later enrichment process binds final storefront/admin object URL if appropriate.

## 8. Public URL Detection

Primary methods:

- browser-visible admin object URLs,
- DOM observation of resulting media state,
- optional future API enrichment.

Fallback:

- keep upload/admin URL,
- bind product/store URLs later through Shopify APIs where authorized.

## 9. Monitoring Enrollment

Register:

- platform: `shopify`
- admin/upload URL
- storefront or product URL when available
- store/product hints
- capture mode metadata

## 10. Failure Modes

- Shopify admin UI changes
- app-embedded or modal upload flows differ
- browser-only metadata too weak for precise product binding
- backend unavailable

Recovery behavior:

- queue first,
- retry protect upload,
- preserve provisional store/product context,
- enrich later through API if available.

## 11. Permissions Required

- `storage`
- `alarms`
- Host permissions for `admin.shopify.com` and supported store admin domains
- OAuth/API: recommended for exact store/product/media identity

## 12. Testing Checklist

- Product media upload
- Store admin file upload where supported
- Drag-and-drop behavior where available
- Context extraction for store/product hints
- Storefront or product URL binding when possible
- Queue replay after browser restart
- Backend failure recovery
- Shopify admin regression checks
