# Figma Adapter Specification

## 1. Overview

The Figma adapter protects exported assets from browser-based design workflows. Like Canva, it is primarily an export-origin adapter. It may later expand with official API assistance for richer workspace and file lineage, but the browser baseline focuses on original export capture only.

## 2. Supported Workflows

- Export frame, component, or asset outputs that result in browser-visible downloads
- Capture artifacts generated from explicit export actions
- Limited support for imported asset workflows only if product policy chooses to protect imported originals

## 3. Supported Capture Methods

- File picker: `Partial`
- Drag-and-drop: `Partial`
- Export: `Yes`
- Clipboard: `Partial`, only if browser upload/export paths expose authoritative file objects

## 4. What PinIT Can Capture

- Exported file bytes
- File metadata: format, file name when available, size, MIME type
- Editor URL
- browser-visible workspace/file hints
- partial export context such as frame or page labels if surfaced in UI

## 5. What PinIT Cannot Capture

- private workspace analytics
- collaborator actions not reflected in export event
- complete version history without API help
- downstream viewer identity

## 6. Capability Classification

### Browser-only

- detect explicit export actions,
- capture browser-visible exported artifacts,
- collect editor URL and page context.

### Requires OAuth/API

- strong workspace identity,
- canonical file/project IDs,
- version and branch metadata,
- organization/team mapping.

### Not technically available

- private collaborator analytics,
- downstream viewer identity,
- local file activity after export.

## 7. Capture Flow

1. User opens a Figma design file in the browser.
2. Adapter initializes on supported editor context.
3. Adapter detects export action.
4. Adapter captures export artifact when the browser exposes it.
5. Adapter extracts editor URL and visible workspace/file hints.
6. Adapter queues protect request.
7. Background worker uploads artifact to PinIT.
8. PinIT creates Vault, DNA, Certificate, and Monitoring records.

## 8. Public URL Detection

Figma is not primarily a public-post URL adapter.

Primary strategy:

- preserve editor URL,
- capture explicit share URL only if intentionally surfaced and relevant,
- avoid assuming a public publication artifact exists.

## 9. Monitoring Enrollment

Register:

- platform: `figma`
- editor URL
- known workspace or project hints
- export metadata
- optional share URL if explicitly relevant

## 10. Failure Modes

- export generated in non-observable pipeline
- file identity too weak without API help
- multi-export scenarios
- editor UI changes
- backend unavailable after capture

Recovery behavior:

- queue export artifact first,
- retry upload later,
- allow metadata enrichment after protection,
- mark degraded if strong project identity is unavailable.

## 11. Permissions Required

- `storage`
- `alarms`
- Host permissions for `figma.com`
- `scripting` only if needed for export-surface support
- OAuth/API: recommended for future enterprise enrichment, not required for browser-only baseline

## 12. Testing Checklist

- Export PNG/JPG/SVG where applicable
- Single-frame export
- Multi-frame or batch export
- Workspace/file hint extraction
- Queue persistence through browser restart
- Backend failure recovery
- Figma editor regression checks
