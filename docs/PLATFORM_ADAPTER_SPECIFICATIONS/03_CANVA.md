# Canva Adapter Specification

## 1. Overview

The Canva adapter protects exported originals from browser-based design workflows. Its primary job is export protection, not public social URL linking. Canva is a design-origin adapter rather than a publication-origin adapter.

## 2. Supported Workflows

- Export PNG, JPG, PDF, or similar supported browser-delivered artifacts
- Download design outputs from browser-visible export actions
- Limited support for upload/import if the browser exposes original file selection and the product chooses to protect imported sources

## 3. Supported Capture Methods

- File picker: `Partial`
- Drag-and-drop: `Partial`
- Export: `Yes`
- Clipboard: `No`

## 4. What PinIT Can Capture

- Exported original artifact bytes when Canva emits a browser-visible blob or downloadable output
- Export metadata such as format and page context
- Upload page URL or editor URL
- Partial design/workspace hints visible in browser state

## 5. What PinIT Cannot Capture

- Private Canva analytics
- collaborator identity beyond browser-visible context
- full workspace object model without official API integration
- viewer identity for shared Canva links

## 6. Capability Classification

### Browser-only

- Detect export button flows
- Capture exported blob/download artifact in many browser-visible cases
- Capture editor URL and page context

### Requires OAuth/API

- strong workspace/team/project identity
- exact design/document metadata in enterprise contexts
- richer publish/share state beyond browser export events

### Not technically available

- private collaboration analytics
- downstream viewer identity
- local usage after export outside browser visibility

## 7. Capture Flow

1. User works in Canva editor.
2. Adapter initializes on supported editor surface.
3. Adapter detects export intent.
4. Adapter intercepts browser-visible export blob or download artifact.
5. Adapter captures exported original bytes.
6. Adapter extracts editor URL and workspace hints.
7. Adapter queues protect request.
8. Background worker sends artifact to PinIT backend.
9. PinIT stores artifact in Vault and creates DNA/certificate/monitoring records.

## 8. Public URL Detection

Canva is generally not a public-post URL adapter.

Primary behavior:

- preserve editor/export page URL,
- optionally capture share/export link if explicitly available,
- do not assume a public URL exists.

Fallback:

- monitoring begins from asset identity and available context rather than a canonical public permalink.

## 9. Monitoring Enrollment

Register:

- platform: `canva`
- editor URL
- export metadata
- workspace/design hints when available
- any explicit share URL only if browser-visible and user-intended

## 10. Failure Modes

- export generated in opaque browser pipeline
- export blob not exposed to adapter
- multi-artboard or batch export complexity
- editor UI changes
- backend offline after export capture

Recovery behavior:

- queue captured artifacts locally first,
- retry upload,
- mark export capture degraded if metadata is partial,
- allow manual protect fallback if export automation fails.

## 11. Permissions Required

- `storage`
- `alarms`
- Host permissions for `canva.com`
- `scripting` may be conditionally useful for export-surface detection
- OAuth/API: optional future enhancement for team/workspace mapping

## 12. Testing Checklist

- Export PNG flow
- Export JPG flow
- Export PDF flow
- Batch export behavior
- Queue persistence after export
- Browser close during export completion
- Backend failure recovery
- Editor DOM regression checks
