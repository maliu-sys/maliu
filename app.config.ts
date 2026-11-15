import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'MaLiu',
  slug: 'maliu',
  version: process.env.APP_VERSION ?? '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  platforms: ['android'],
  icon: './assets/maliu_logo.png',
  android: {
    package: 'maliu.app',
    versionCode: Number(process.env.APP_VERSION_CODE ?? 1),
    softwareKeyboardLayoutMode: 'resize',
    permissions: ['INTERNET'],
  },
  plugins: ['expo-secure-store', 'expo-sqlite', 'expo-status-bar'],
};

export default config;
