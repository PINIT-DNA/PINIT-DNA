import { useAudioPlayer } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { pinitStoredFileName } from '../core/pinit-parser';
import { READER_MESSAGES } from '../core/validation';

interface AssetViewProps {
  uri: string;
  mimeType: string;
  filename: string;
  text: string | null;
  allowDownload: boolean;
  onSaveCopy: () => void;
}

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (next) => {
    next.loop = false;
  });
  return <VideoView player={player} style={styles.video} nativeControls />;
}

function AudioPreview({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  return (
    <Pressable style={styles.secondary} onPress={() => player.play()}>
      <Text style={styles.secondaryText}>Play audio</Text>
    </Pressable>
  );
}

export function AssetView({ uri, mimeType, filename, text, allowDownload, onSaveCopy }: AssetViewProps) {
  const shownName = pinitStoredFileName(filename);
  const mime = mimeType.toLowerCase();
  const isImage = mime.startsWith('image/') && mime !== 'image/svg+xml';
  const isVideo = mime.startsWith('video/');
  const isAudio = mime.startsWith('audio/');
  const isPdf = mime === 'application/pdf';
  const isHtml = mime === 'text/html' || mime === 'application/xhtml+xml' || mime === 'image/svg+xml';
  const isText = text != null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{shownName}</Text>
      {isImage ? <Image source={{ uri }} style={styles.image} resizeMode="contain" accessibilityLabel={shownName} /> : null}
      {isVideo ? <VideoPreview uri={uri} /> : null}
      {isAudio ? <AudioPreview uri={uri} /> : null}
      {isPdf || isHtml ? (
        <WebView
          source={{ uri }}
          style={styles.web}
          originWhitelist={['*']}
          allowFileAccess
          allowingReadAccessToURL={uri}
        />
      ) : null}
      {isText && !isHtml ? (
        <ScrollView style={styles.textWrap}>
          <Text style={styles.body}>{text}</Text>
        </ScrollView>
      ) : null}
      {!isImage && !isVideo && !isAudio && !isPdf && !isHtml && !isText ? (
        <Text style={styles.note}>This file is open, and this Reader cannot preview this format yet.</Text>
      ) : null}
      {allowDownload ? (
        <Pressable style={styles.secondary} onPress={onSaveCopy}>
          <Text style={styles.secondaryText}>Save a .pinit copy</Text>
        </Pressable>
      ) : (
        <Text style={styles.note}>{READER_MESSAGES.download_off}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1c2430',
  },
  image: {
    width: '100%',
    height: 320,
    backgroundColor: '#f3f0e8',
    borderRadius: 8,
  },
  video: {
    width: '100%',
    height: 280,
    backgroundColor: '#111',
    borderRadius: 8,
  },
  web: {
    width: '100%',
    height: 420,
    backgroundColor: '#fff',
  },
  textWrap: {
    maxHeight: 320,
  },
  body: {
    color: '#1c2430',
    fontSize: 15,
    lineHeight: 22,
  },
  note: {
    color: '#5c6570',
    fontSize: 14,
    lineHeight: 20,
  },
  secondary: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#e7f0ec',
  },
  secondaryText: {
    color: '#1e3d34',
    fontWeight: '700',
  },
});
