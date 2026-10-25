import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'MaLiu',
  slug: 'maliu',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  platforms: ['android'],
  icon: './assets/maliu_logo.png',
  android: {
    package: 'maliu.app',
    versionCode: 1,
    softwareKeyboardLayoutMode: 'resize',
    permissions: ['INTERNET'],
  },
  plugins: ['expo-secure-store', 'expo-sqlite', 'expo-status-bar'],
};

export default config;
