import * as DocumentPicker from 'expo-document-picker';
import * as Linking from 'expo-linking';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { HubClient } from '../api/hub-client';
import { loadProtectedAsset } from '../asset/asset-loader';
import { decideNextStep } from '../asset/open-flow';
import { writeCarrierFile, writePreviewFile } from '../asset/preview-file';
import { hubApiBase } from '../config';
import { buildPinitCarrier } from '../core/pinit-parser';
import type { AccessExtras, PinitParseResult, ReaderSession, ShareLinkView } from '../core/types';
import { READER_MESSAGES } from '../core/validation';
import { isPinitLaunchUrl } from '../files/launch-url';
import { readDevicePinit } from '../files/read-device-file';
import { captureRequiredLocation } from '../location/location-service';
import { offlineMessage } from '../network/connectivity';
import { loadReaderSession } from '../session/reader-session';
import { AssetView } from '../components/AssetView';

type Phase =
  | { name: 'home' }
  | { name: 'working'; label: string }
  | { name: 'otp'; token: string; link: ShareLinkView }
  | { name: 'name'; token: string; link: ShareLinkView }
  | { name: 'location'; token: string; link: ShareLinkView; recipientName?: string }
  | { name: 'ready'; token: string; link: ShareLinkView; uri: string; mimeType: string; text: string | null }
  | { name: 'error'; message: string };

export function ReaderScreen() {
  const [session, setSession] = useState<ReaderSession | null>(null);
  const [client] = useState(() => new HubClient(hubApiBase()));
  const [phase, setPhase] = useState<Phase>({ name: 'home' });
  const [otp, setOtp] = useState('');
  const [viewerName, setViewerName] = useState('');
  const [otpMessage, setOtpMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadReaderSession().then((next) => {
      if (!cancelled) setSession(next);
    }).catch(() => {
      if (!cancelled) setPhase({ name: 'error', message: READER_MESSAGES.network });
    });
    return () => { cancelled = true; };
  }, []);

  const finish = useCallback(async (token: string, extras: AccessExtras) => {
    if (!session) return;
    setPhase({ name: 'working', label: 'Loading protected content...' });
    const opened = await loadProtectedAsset(client, token, session, extras, { quiet: true });
    if (!opened.ok) {
      setPhase({ name: 'error', message: opened.message });
      return;
    }
    const mimeType = opened.mimeType || opened.link.mimeType;
    const uri = writePreviewFile(opened.bytes, mimeType);
    let text: string | null = null;
    if (mimeType.startsWith('text/') && mimeType !== 'text/html') {
      text = new TextDecoder().decode(opened.bytes);
    }
    setPhase({ name: 'ready', token, link: opened.link, uri, mimeType, text });
  }, [client, session]);

  const continueAfterInfo = useCallback(async (token: string, link: ShareLinkView, extras: AccessExtras) => {
    const step = decideNextStep(link, extras);
    if (step.name === 'otp') {
      setPhase({ name: 'otp', token, link });
      return;
    }
    if (step.name === 'name') {
      setPhase({ name: 'name', token, link });
      return;
    }
    if (step.name === 'location') {
      setPhase({ name: 'location', token, link, recipientName: extras.recipientName });
      return;
    }
    await finish(token, extras);
  }, [finish]);

  const openParsed = useCallback(async (parsed: PinitParseResult) => {
    if (!session) return;
    if (!parsed.ok) {
      setPhase({ name: 'error', message: parsed.message });
      return;
    }
    const offline = await offlineMessage();
    if (offline) {
      setPhase({ name: 'error', message: offline });
      return;
    }
    setPhase({ name: 'working', label: 'Checking share...' });
    const info = await client.getShareInfo(parsed.document.token, session);
    if (!info.ok) {
      setPhase({ name: 'error', message: info.message });
      return;
    }
    await continueAfterInfo(parsed.document.token, info.link, {});
  }, [client, continueAfterInfo, session]);

  const openUri = useCallback(async (uri: string, name?: string | null) => {
    if (!isPinitLaunchUrl(uri) && !(name && name.toLowerCase().endsWith('.pinit'))) return;
    setOtp('');
    setOtpMessage('');
    setPhase({ name: 'working', label: 'Opening PINIT file...' });
    const parsed = await readDevicePinit(uri, name);
    await openParsed(parsed);
  }, [openParsed]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    Linking.getInitialURL().then((url) => {
      if (active && url) void openUri(url);
    }).catch(() => undefined);
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void openUri(url);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [openUri, session]);

  const chooseFile = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: ['*/*'],
    });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    if (!asset) return;
    await openUri(asset.uri, asset.name);
  };

  const submitOtp = async () => {
    if (phase.name !== 'otp' || !session) return;
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
    const captured = await captureRequiredLocation();
    if (!captured.ok) {
      setPhase({ name: 'error', message: captured.message });
      return;
    }
    await finish(phase.token, { ...captured.extras, recipientName: phase.recipientName });
  };

  const saveCopy = async () => {
    if (phase.name !== 'ready' || !phase.link.allowDownload) return;
    const carrier = buildPinitCarrier(phase.token, phase.link.filename);
    if (!carrier) return;
    const uri = writeCarrierFile(carrier.filename, carrier.body);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: carrier.filename });
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.brand}>PINIT READER</Text>
      <Text style={styles.heading}>Open a .pinit file</Text>
      <Text style={styles.lede}>The file only points at a share. PINIT Hub decides whether it can be opened.</Text>

      <Pressable style={[styles.button, !session ? styles.buttonDisabled : null]} disabled={!session} onPress={() => { void chooseFile(); }}>
        <Text style={styles.buttonText}>Open a .pinit file</Text>
      </Pressable>

      {phase.name === 'home' ? (
        <Text style={styles.note}>Open a .pinit file to view the protected content.</Text>
      ) : null}

      {phase.name === 'working' ? (
        <View style={styles.row}>
          <ActivityIndicator color="#1e3d34" />
          <Text style={styles.status}>{phase.label}</Text>
        </View>
      ) : null}

      {phase.name === 'error' ? <Text style={styles.error}>{phase.message}</Text> : null}

      {phase.name === 'otp' ? (
        <View style={styles.gate}>
          <Text style={styles.gateText}>{READER_MESSAGES.otp_required}</Text>
          <TextInput
            value={otp}
            onChangeText={setOtp}
            keyboardType="number-pad"
            style={styles.input}
            accessibilityLabel="Verification code"
          />
          {otpMessage ? <Text style={styles.error}>{otpMessage}</Text> : null}
          <Pressable style={styles.button} onPress={() => { void submitOtp(); }}>
            <Text style={styles.buttonText}>Continue</Text>
          </Pressable>
        </View>
      ) : null}

      {phase.name === 'name' ? (
        <View style={styles.gate}>
          <Text style={styles.gateText}>The sender asked for your name before this file opens.</Text>
          <TextInput
            value={viewerName}
            onChangeText={setViewerName}
            style={styles.input}
            accessibilityLabel="Your name"
          />
          <Pressable style={styles.button} onPress={() => { void submitName(); }}>
            <Text style={styles.buttonText}>Continue</Text>
          </Pressable>
        </View>
      ) : null}

      {phase.name === 'location' ? (
        <View style={styles.gate}>
          <Text style={styles.gateText}>Location permission is required to open this share. Your phone will ask you to allow it and to turn location on if it is off.</Text>
          <Pressable style={styles.button} onPress={() => { void allowLocation(); }}>
            <Text style={styles.buttonText}>Allow Location</Text>
          </Pressable>
        </View>
      ) : null}

      {phase.name === 'ready' ? (
        <>
          <Text style={styles.status}>Authorization successful</Text>
          <AssetView
            uri={phase.uri}
            mimeType={phase.mimeType}
            filename={phase.link.filename}
            text={phase.text}
            allowDownload={phase.link.allowDownload}
            onSaveCopy={() => { void saveCopy(); }}
          />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 24,
    paddingTop: 64,
    gap: 12,
    backgroundColor: '#f6f3ec',
    flexGrow: 1,
  },
  brand: {
    letterSpacing: 1.4,
    color: '#5c6570',
    fontSize: 12,
    fontWeight: '700',
  },
  heading: {
    fontSize: 32,
    color: '#1c2430',
    fontWeight: '700',
  },
  lede: {
    color: '#3d4650',
    fontSize: 16,
    lineHeight: 22,
  },
  note: {
    color: '#5c6570',
    fontSize: 15,
  },
  button: {
    alignSelf: 'flex-start',
    backgroundColor: '#1e3d34',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  status: {
    color: '#1e3d34',
    fontSize: 15,
  },
  error: {
    color: '#8c2f2f',
    fontSize: 16,
    lineHeight: 22,
  },
  gate: {
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
  },
  gateText: {
    color: '#1c2430',
    fontSize: 16,
    lineHeight: 22,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d5d0c6',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: '#1c2430',
  },
});
