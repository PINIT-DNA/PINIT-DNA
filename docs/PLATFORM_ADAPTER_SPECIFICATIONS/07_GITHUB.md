# GitHub Adapter Specification

## 1. Overview

The GitHub adapter protects original assets uploaded through browser-based repository workflows such as releases, issue or discussion attachments, and other explicit browser upload surfaces. It must distinguish public web uploads from private-repository or enterprise-only metadata that needs official authorization.

## 2. Supported Workflows

- Release asset upload
- Issue or discussion attachment upload where browser exposes original file
- Other explicit repository upload surfaces supported by the extension

## 3. Supported Capture Methods

- File picker: `Yes`
- Drag-and-drop: `Partial`
- Export: `No`
- Clipboard: `Partial`

## 4. What PinIT Can Capture

- Original file bytes
- File metadata
- Upload page URL
- Repository or page context visible in the browser
- Final public release or asset URL when surfaced

## 5. What PinIT Cannot Capture

- private repository data without authorization
- downstream viewer identity
- private analytics
- internal GitHub object metadata not surfaced in browser UI

## 6. Capability Classification

### Browser-only

- file picker detection,
- original file capture,
- some release/public URL detection,
- repository path extraction from the URL.

### Requires OAuth/API

- private repo enrichment,
- exact release asset identifiers in all cases,
- organization/team ownership mapping.

### Not technically available

- viewer identity,
- private usage analytics without access,
- downstream local-file activity.

## 7. Capture Flow

1. User opens a supported GitHub upload workflow.
2. Adapter initializes and identifies repository context.
3. Adapter listens for file-input and related upload events.
4. User selects original file.
5. Adapter captures original browser `File`.
6. Adapter extracts upload page URL and repository hints.
7. Adapter queues protect request.
8. Background worker uploads to PinIT backend.
9. Adapter watches for final asset or release URL when available.

## 8. Public URL Detection

Primary methods:

- DOM observation of release or upload result
- repository URL structure
- navigation/history changes

Fallback:

- persist repository/upload page URL,
- use later reconciliation or OAuth/API enrichment for stronger binding.

## 9. Monitoring Enrollment

Register:

- platform: `github`
- upload page URL
- public asset or release URL when available
- repository owner/name hints
- capture mode metadata

## 10. Failure Modes

- GitHub changes release UI structure
- uploads occur in modal or in-page widget with different event paths
- private repo metadata insufficient without auth
- backend unavailable

Recovery behavior:

- queue and retry,
- preserve repository context,
- mark URL binding pending if final URL unavailable,
- fall back to manual review in ambiguous cases.

## 11. Permissions Required

- `storage`
- `alarms`
- Host permissions for `github.com`
- OAuth/API: recommended for private repo and org enrichment, not required for public baseline

## 12. Testing Checklist

- Release asset upload
- Issue/discussion attachment upload where supported
- Drag-and-drop handling
- Public release URL detection
- Private repo behavior with and without OAuth
- Queue replay after browser restart
- Backend failure recovery
- GitHub workflow regression checks
