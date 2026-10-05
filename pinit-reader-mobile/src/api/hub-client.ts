import type {
  AccessExtras,
  HubFailure,
  HubFailureKind,
  ReaderSession,
  ShareLinkView,
} from '../core/types';
import { readerMessage } from '../core/validation';
import { sessionHeaders } from '../session/session';

interface HubErrorBody {
  error?: string;
  code?: string;
  blocked?: boolean;
  viewerRevoked?: boolean;
  requiresOtp?: boolean;
  reason?: string | null;
  redirectToken?: string;
  link?: RawLink;
}

interface RawLink {
  filename?: string;
  mimeType?: string;
  isActive?: boolean;
  inactiveReason?: ShareLinkView['inactiveReason'];
  requireOtp?: boolean;
  otpVerified?: boolean;
  requireName?: boolean;
  allowDownload?: boolean;
  requestLocation?: boolean;
  locationAlreadyShared?: boolean;
  viewerRevoked?: boolean;
}

export type ShareInfoResult =
  | { ok: true; link: ShareLinkView }
  | HubFailure;

export type AccessResult =
  | { ok: true; redirectToken?: string }
  | HubFailure;

export type AssetResult =
  | { ok: true; bytes: Uint8Array; mimeType: string }
  | HubFailure;

export type OtpResult =
  | { ok: true }
  | { ok: false; message: string };

function failure(kind: HubFailureKind): HubFailure {
  return { ok: false, kind, message: readerMessage(kind) };
}

export function classifyHubFailure(status: number, body: HubErrorBody): HubFailure {
  const error = body.error ?? '';
  const reason = body.reason ?? '';
  if (status === 503 || body.code === 'BACKEND_OFFLINE') return failure('hub_unavailable');
  if (body.requiresOtp || /otp/i.test(error)) return failure('otp_required');
  if (body.viewerRevoked || /revoked by the owner/i.test(error)) return failure('revoked');
  if (reason === 'expired' || /expired/i.test(error)) return failure('expired');
  if (reason === 'revoked' || /turned off/i.test(error)) return failure('revoked');
  if (reason === 'exhausted' || reason === 'one_time' || /view limit|single-use/i.test(error)) {
    return failure('exhausted');
  }
  if (reason === 'BLOCKED_DEVICE' || /devices are not permitted/i.test(error)) {
    return failure('device_restricted');
  }
  if (/download/i.test(error)) return failure('download_restricted');
  if (status === 404) return failure('unavailable');
  if (status === 403 || reason === 'BLOCKED_IP' || reason === 'tampered') return failure('unauthorized');
  if (status === 410) return failure('unavailable');
  if (status >= 500) return failure('hub_unavailable');
  return failure('unavailable');
}

function toShareLink(raw: RawLink | undefined): ShareLinkView | null {
  if (!raw || typeof raw.filename !== 'string' || typeof raw.mimeType !== 'string') return null;
  return {
    filename: raw.filename,
    mimeType: raw.mimeType,
    isActive: raw.isActive === true,
    inactiveReason: raw.inactiveReason ?? null,
    requireOtp: raw.requireOtp === true,
    otpVerified: raw.otpVerified === true,
    requireName: raw.requireName === true,
    allowDownload: raw.allowDownload === true,
    requestLocation: raw.requestLocation === true,
    locationAlreadyShared: raw.locationAlreadyShared === true,
    viewerRevoked: raw.viewerRevoked === true,
  };
}

function inactiveFailure(link: ShareLinkView): HubFailure | null {
  if (link.viewerRevoked) return failure('revoked');
  if (link.isActive) return null;
  switch (link.inactiveReason) {
    case 'expired': return failure('expired');
    case 'revoked': return failure('revoked');
    case 'exhausted':
    case 'one_time': return failure('exhausted');
    case 'tampered': return failure('unauthorized');
    default: return failure('unavailable');
  }
}

export class HubClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Call fetch as a function. Binding it as a method makes the runtime reject it. */
  private send(path: string, init: RequestInit): Promise<Response> {
    const request = this.fetchImpl;
    return request(`${this.baseUrl}${path}`, init);
  }

  private async request(path: string, init: RequestInit): Promise<{ status: number; body: HubErrorBody; response: Response } | HubFailure> {
    let response: Response;
    try {
      response = await this.send(path, init);
    } catch {
      return failure('network');
    }
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('json')) {
      return { status: response.status, body: {}, response };
    }
    try {
      const body = await response.json() as HubErrorBody;
      return { status: response.status, body, response };
    } catch {
      return { status: response.status, body: {}, response };
    }
  }

  async getShareInfo(token: string, session: ReaderSession): Promise<ShareInfoResult> {
    const result = await this.request(`/share/${encodeURIComponent(token)}`, {
      method: 'GET',
      headers: sessionHeaders(session),
    });
    if ('kind' in result) return result;
    if (!result.response.ok) return classifyHubFailure(result.status, result.body);
    const link = toShareLink(result.body.link);
    if (!link) return failure('unavailable');
    const inactive = inactiveFailure(link);
    if (inactive) return inactive;
    return { ok: true, link };
  }

  async recordView(token: string, session: ReaderSession, extras: AccessExtras = {}): Promise<AccessResult> {
    const result = await this.request(`/share/${encodeURIComponent(token)}/access`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...sessionHeaders(session),
      },
      body: JSON.stringify({
        action: 'VIEWED',
        sessionId: session.sessionId,
        deviceFingerprint: session.deviceFingerprint,
        screenResolution: session.screenResolution,
        timezone: session.timezone,
        recipientName: extras.recipientName,
        locationShared: extras.locationShared ?? false,
        locationSource: extras.locationSource,
        gpsLat: extras.gpsLat,
        gpsLng: extras.gpsLng,
        gpsAccuracy: extras.gpsAccuracy,
        gpsTimestamp: extras.gpsTimestamp,
        gpsCity: extras.gpsCity,
        gpsVillage: extras.gpsVillage,
        gpsDistrict: extras.gpsDistrict,
        gpsState: extras.gpsState,
        gpsPincode: extras.gpsPincode,
        gpsFullAddress: extras.gpsFullAddress,
      }),
    });
    if ('kind' in result) return result;
    if (!result.response.ok) return classifyHubFailure(result.status, result.body);
    const redirect = result.body.redirectToken;
    return {
      ok: true,
      redirectToken: typeof redirect === 'string' && redirect !== token ? redirect : undefined,
    };
  }

  async fetchAsset(token: string, session: ReaderSession): Promise<AssetResult> {
    let response: Response;
    try {
      response = await this.send(`/share/${encodeURIComponent(token)}/file`, {
        method: 'GET',
        headers: sessionHeaders(session),
      });
    } catch {
      return failure('network');
    }
    if (!response.ok) {
      let body: HubErrorBody = {};
      try { body = await response.json() as HubErrorBody; } catch { body = {}; }
      return classifyHubFailure(response.status, body);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
    return { ok: true, bytes, mimeType };
  }

  async verifyOtp(token: string, otp: string): Promise<OtpResult> {
    const result = await this.request(`/share/${encodeURIComponent(token)}/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp }),
    });
    if ('kind' in result) return { ok: false, message: result.message };
    if (!result.response.ok) {
      return { ok: false, message: 'That code was not accepted. Try again.' };
    }
    return { ok: true };
  }
}
