import * as SecureStore from 'expo-secure-store';
import type { ModelSettings } from '../agent/types';
export const defaultSettings: ModelSettings = {
  baseUrl:
    process.env.EXPO_PUBLIC_MODEL_BASE_URL?.trim() ||
    'https://api.deepseek.com',
  model: process.env.EXPO_PUBLIC_MODEL_NAME?.trim() || 'deepseek-flash',
  // Metro removes this development-only branch from production bundles.
  apiKey: __DEV__ ? process.env.EXPO_PUBLIC_MODEL_API_KEY?.trim() || '' : '',
};

export async function saveSettings(settings: ModelSettings): Promise<void> {
  // Store the endpoint with its key as one secure record to avoid mismatched credentials
  // if a settings write is interrupted.
  await SecureStore.setItemAsync(
    'maliu.model-config',
    JSON.stringify(settings),
  );
}

export async function loadModelSettings(): Promise<ModelSettings> {
  const secure = await SecureStore.getItemAsync('maliu.model-config');
  return secure ? (JSON.parse(secure) as ModelSettings) : defaultSettings;
}
