import { requireNativeModule } from 'expo';

type DeviceInfo = {
  manufacturer: string;
  model: string;
  androidVersion: string;
  apiLevel: number;
  supportedAbis: string[];
};

export async function getDeviceInfo(): Promise<DeviceInfo> {
  // Lazy lookup lets the UI explain a missing development build as a tool error.
  const module = requireNativeModule<{ getDeviceInfo(): Promise<DeviceInfo> }>(
    'MaliuDeviceInfo',
  );
  return module.getDeviceInfo();
}
