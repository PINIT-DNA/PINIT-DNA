# Platform Adapter Interface

## Purpose

This document defines the common contract for all PinIT browser platform adapters. It is the bridge between the extension architecture and implementation. Every platform adapter must conform to this contract so capture behavior, telemetry, URL linking, monitoring enrollment, failure handling, permissions, and testing stay consistent across platforms.

## Design Goals

- Detect user action, not webpage content.
- Capture only user-owned originals involved in explicit upload, export, or publish workflows.
- Never auto-protect random internet media during browsing.
- Separate browser-only capabilities from OAuth/API-dependent capabilities.
- Ensure every adapter is debuggable, testable, and replaceable without changing the rest of the extension pipeline.

## Adapter Lifecycle

```text
Platform Loaded
  -> Adapter Activated
  -> Capability Detection
  -> User Action Detected
  -> Original Capture Started
  -> Original Capture Completed
  -> Protect Request Queued
  -> Protect Upload Completed
  -> Public URL Pending
  -> Public URL Bound
  -> Monitoring Enrollment Updated
  -> Completed or Degraded
```

## Common Interface

```ts
interface PlatformAdapter {
  initialize(): Promise<void> | void;
  detectUserAction(): void;
  captureOriginal(context: CaptureContext): Promise<CaptureResult | null>;
  extractPlatformMetadata(context: CaptureContext): Promise<PlatformMetadata>;
  detectPublicUrl(context: CaptureContext): Promise<PublicUrlResult | null>;
  enrollMonitoring(context: MonitoringContext): Promise<MonitoringEnrollment>;
  cleanup(): Promise<void> | void;
}
```

## Common Types

```ts
type CaptureMode =
  | 'file_input'
  | 'drag_drop'
  | 'export_hook'
  | 'clipboard'
  | 'manual_protect'
  | 'oauth_callback';

type CapabilityClass =
  | 'browser_only'
  | 'requires_oauth_api'
  | 'not_technically_available';

interface CaptureContext {
  platformId: string;
  pageUrl: string;
  pageTitle?: string;
  captureMode: CaptureMode;
  initiatedAt: string;
  userInitiated: boolean;
}

interface CaptureResult {
  originalBytesAvailable: boolean;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  source: 'file' | 'blob' | 'url_fetch' | 'manual';
  dataHandle?: 'file' | 'blob' | 'data_url' | 'object_url';
}

interface PlatformMetadata {
  platform: string;
  uploadPageUrl: string;
  pageTitle?: string;
  platformUser?: string | null;
  profileUrl?: string | null;
  channelOrPage?: string | null;
  objectId?: string | null;
  capabilityNotes?: string[];
}

interface PublicUrlResult {
  found: boolean;
  url?: string;
  source?: 'dom' | 'mutation' | 'navigation' | 'history_api' | 'oauth_api' | 'user_confirmed';
  confidence?: 'high' | 'medium' | 'low';
}

interface MonitoringEnrollment {
  watchUrls: string[];
  metadata: Record<string, string | number | boolean | null>;
  mode: 'continuous' | 'scheduled' | 'manual' | 'high_priority' | 'legal_hold';
}
```

## Required Adapter Responsibilities

### 1. `initialize()`

Must:

- verify the page is a supported workflow surface,
- register listeners,
- emit adapter activation telemetry,
- compute a capability descriptor for the current page mode.

Must not:

- inspect unrelated media,
- queue protect jobs,
- scrape feeds.

### 2. `detectUserAction()`

Must detect only explicit user actions such as:

- file picker selection,
- drag-and-drop to upload areas,
- export actions,
- manual protect commands,
- clipboard paste into known upload workflows where applicable.

### 3. `captureOriginal()`

Must attempt to capture:

- original file bytes,
- exported blob bytes,
- or the best authoritative browser-exposed artifact.

Must record:

- capture mode,
- source handle,
- size,
- MIME type,
- filename when available,
- whether capture is authoritative or degraded.

Must not:

- capture visible media just because it exists in the DOM,
- fabricate original bytes from screenshots or thumbnails unless explicitly invoked as manual protect.

### 4. `extractPlatformMetadata()`

Must collect:

- platform ID,
- upload page URL,
- page title,
- profile/page/channel hints,
- known object IDs if browser-visible.

### 5. `detectPublicUrl()`

Must try one or more of:

- DOM observation,
- `MutationObserver`,
- navigation detection,
- `history.pushState`/`replaceState` observation,
- official API callback,
- user confirmation fallback.

Must preserve both:

- `uploadPageUrl`,
- `publicPlatformUrl`.

### 6. `enrollMonitoring()`

Must assemble:

- public URL when available,
- upload page URL,
- profile or channel URL,
- platform metadata,
- monitoring mode and confidence.

### 7. `cleanup()`

Must:

- unregister observers and listeners,
- release object URLs or temporary references,
- leave no background polling loops running in the page.

## Capability Classification Model

Every adapter feature must be classified as one of:

### Browser-only

Works using browser APIs and visible page state alone.

Examples:

- file input detection,
- drag-and-drop detection,
- export-button interception,
- page URL capture,
- some public permalink discovery.

### Requires OAuth/API

Needs official authorization or platform APIs.

Examples:

- exact channel/page/workspace identity,
- internal object IDs,
- private document metadata,
- some final publication states.

### Not Technically Available

Cannot be implemented safely or honestly under browser and platform constraints.

Examples:

- private DMs,
- private analytics,
- viewer identity from third-party platforms,
- local device file opens outside the browser.

## Telemetry Contract

Every adapter must log or emit events for:

- `adapter_loaded`
- `capability_detected`
- `user_action_detected`
- `capture_started`
- `capture_completed`
- `capture_degraded`
- `protect_queued`
- `protect_uploaded`
- `public_url_detected`
- `monitoring_context_updated`
- `adapter_error`

## Failure Handling Contract

Every adapter spec must document:

- likely UI-change breakpoints,
- missing file-event scenarios,
- network and backend failures,
- browser restart/update interruption,
- degraded-mode behavior,
- user-visible fallback.

The default policy is:

1. never block the third-party workflow unless policy explicitly requires it,
2. queue locally first,
3. preserve the original if captured,
4. retry with bounded backoff,
5. mark degraded state explicitly.

## Permission Declaration Model

Every adapter spec must list:

- browser permissions used,
- host permissions used,
- whether OAuth/API is required,
- privacy impact,
- feature dependency.

## Testing Checklist Template

Every adapter spec must define tests for:

- file picker flow,
- drag-and-drop flow,
- multi-file flow if supported,
- public URL detection,
- queue/retry behavior,
- browser close/restart recovery,
- backend failure recovery,
- DOM/UI variation regression checks.

## File Format Requirement

Every platform spec in this folder must include these headings in order:

1. Overview
2. Supported Workflows
3. Supported Capture Methods
4. What PinIT Can Capture
5. What PinIT Cannot Capture
6. Capability Classification
7. Capture Flow
8. Public URL Detection
9. Monitoring Enrollment
10. Failure Modes
11. Permissions Required
12. Testing Checklist

## Initial Priority Platforms

The first implementation wave should prioritize:

1. Instagram Web
2. YouTube Studio
3. Canva
4. Figma
5. LinkedIn

The second wave should cover:

6. Facebook
7. GitHub
8. WordPress
9. Shopify

These files together form the Platform Adapter Specification Pack and are intended to be stable engineering contracts before code implementation begins.
