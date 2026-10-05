import { useMemo, useState } from 'react';
import { HubClient } from '../../api/hub-client';
import { hubApiBase } from '../../config';
import { READER_MESSAGES } from '../../core/validation';
import type { AccessExtras, ShareLinkView } from '../../core/types';
import { readerLog } from '../../log';
import { loadProtectedAsset } from '../../reader/asset-loader';
import { readCarrier } from '../../reader/file-reader';
import { createSessionContext } from '../../tracking/session-context';
import { AssetView } from '../components/AssetView';

type Phase =
  | { name: 'idle' }
  | { name: 'working'; label: string }
  | { name: 'otp'; token: string; link: ShareLinkView }
  | { name: 'name'; token: string; link: ShareLinkView }
  | { name: 'location'; token: string; link: ShareLinkView; recipientName?: string }
  | { name: 'ready'; token: string; link: ShareLinkView; blob: Blob; mimeType: string }
  | { name: 'error'; message: string };

export function ReaderScreen() {
  const session = useMemo(() => createSessionContext(), []);
  const client = useMemo(() => new HubClient(hubApiBase()), []);
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [otp, setOtp] = useState('');
  const [viewerName, setViewerName] = useState('');
  const [otpMessage, setOtpMessage] = useState('');

  const finish = async (token: string, extras: AccessExtras) => {
    setPhase({ name: 'working', label: 'Loading protected asset...' });
    const opened = await loadProtectedAsset(client, token, session, extras, { quiet: true });
    if (!opened.ok) {
      setPhase({ name: 'error', message: opened.message });
      return;
    }
    setPhase({
      name: 'ready',
      token,
      link: opened.link,
      blob: opened.blob,
      mimeType: opened.mimeType,
    });
  };

  const continueAfterInfo = async (token: string, link: ShareLinkView, extras: AccessExtras) => {
    if (link.requireOtp && !link.otpVerified) {
      setPhase({ name: 'otp', token, link });
      return;
    }
    if (link.requireName && !extras.recipientName) {
      setPhase({ name: 'name', token, link });
      return;
    }
    if (link.requestLocation && !link.locationAlreadyShared && extras.locationShared !== true) {
      setPhase({ name: 'location', token, link, recipientName: extras.recipientName });
      return;
    }
    await finish(token, extras);
  };

  const openFile = async (file: File) => {
    setOtp('');
    setOtpMessage('');
    setPhase({ name: 'working', label: 'Reading PINIT file...' });
    const parsed = await readCarrier({
      name: file.name,
      size: file.size,
      text: () => file.text(),
    });
    if (!parsed.ok) {
      setPhase({ name: 'error', message: parsed.message });
      return;
    }

    setPhase({ name: 'working', label: 'Connecting to PINIT Hub...' });
    readerLog('Connecting to Hub...');
    const info = await client.getShareInfo(parsed.document.token, session);
    if (!info.ok) {
      setPhase({ name: 'error', message: info.message });
      return;
    }
    readerLog('Authorization response received');
    await continueAfterInfo(parsed.document.token, info.link, {});
  };

  const submitOtp = async () => {
    if (phase.name !== 'otp') return;
    setOtpMessage('');
    const result = await client.verifyOtp(phase.token, otp.trim());
    if (!result.ok) {
      setOtpMessage(result.message);
      return;
    }
    const info = await client.getShareInfo(phase.token, session);
    if (!info.ok) {
      setPhase({ name: 'error', message: info.message });
      return;
    }
    await continueAfterInfo(phase.token, info.link, {});
  };

  const submitName = async () => {
    if (phase.name !== 'name') return;
    const recipientName = viewerName.trim();
    if (!recipientName) return;
    await continueAfterInfo(phase.token, phase.link, { recipientName });
  };

  const allowLocation = async () => {
    if (phase.name !== 'location') return;
    if (!navigator.geolocation) {
      setPhase({ name: 'error', message: 'Location is needed to open this file.' });
      return;
    }
    const fix = await new Promise<GeolocationPosition | 'denied' | 'timeout'>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos),
        (err) => resolve(err.code === 1 ? 'denied' : 'timeout'),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
      );
    });
    if (fix === 'denied') {
      setPhase({ name: 'error', message: 'Location is needed to open this file.' });
      return;
    }
    const extras: AccessExtras = {
      recipientName: phase.recipientName,
      locationShared: true,
      locationSource: 'ip',
    };
    if (fix !== 'timeout') {
      extras.gpsLat = fix.coords.latitude;
      extras.gpsLng = fix.coords.longitude;
      extras.gpsAccuracy = fix.coords.accuracy;
      extras.gpsTimestamp = new Date(fix.timestamp).toISOString();
      extras.locationSource = fix.coords.accuracy <= 75 ? 'gps' : 'network';
    }
    await finish(phase.token, extras);
  };

  return (
    <main className="reader">
      <header>
        <p className="brand">PINIT Reader</p>
        <h1>Open a .pinit file</h1>
        <p className="lede">The file only points at a share. PINIT Hub decides whether it can be opened.</p>
      </header>

      <label className="choose">
        Choose .pinit file
        <input
          type="file"
          accept=".pinit"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void openFile(file);
          }}
        />
      </label>

      {phase.name === 'working' ? <p className="status">{phase.label}</p> : null}
      {phase.name === 'error' ? <p className="error" role="alert">{phase.message}</p> : null}

      {phase.name === 'otp' ? (
        <form className="gate" onSubmit={(event) => { event.preventDefault(); void submitOtp(); }}>
          <p>{READER_MESSAGES.otp_required}</p>
          <input
            value={otp}
            onChange={(event) => setOtp(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Verification code"
          />
          {otpMessage ? <p className="error">{otpMessage}</p> : null}
          <button type="submit">Continue</button>
        </form>
      ) : null}

      {phase.name === 'name' ? (
        <form className="gate" onSubmit={(event) => { event.preventDefault(); void submitName(); }}>
          <p>The sender asked for your name before this file opens.</p>
          <input
            value={viewerName}
            onChange={(event) => setViewerName(event.target.value)}
            aria-label="Your name"
          />
          <button type="submit">Continue</button>
        </form>
      ) : null}

      {phase.name === 'location' ? (
        <div className="gate">
          <p>This file needs your location to open.</p>
          <button type="button" onClick={() => void allowLocation()}>Share location and open</button>
        </div>
      ) : null}

      {phase.name === 'ready' ? (
        <>
          <p className="status">Authorization successful</p>
          {import.meta.env.DEV ? (
            <p className="dev-token">Development token: {phase.token}</p>
          ) : null}
          <AssetView
            token={phase.token}
            blob={phase.blob}
            mimeType={phase.mimeType || phase.link.mimeType}
            filename={phase.link.filename}
            allowDownload={phase.link.allowDownload}
            downloadNote={READER_MESSAGES.download_off}
          />
        </>
      ) : null}
    </main>
  );
}
