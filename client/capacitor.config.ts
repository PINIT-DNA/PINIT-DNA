import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pinit.dna',
  appName: 'PINIT',
  webDir: 'dist',
  // Light WebView background so no black gutter shows behind the web content.
  backgroundColor: '#f6f8fb',
  android: {
    allowMixedContent: false,
    backgroundColor: '#f6f8fb',
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
