import { getDeviceInfo } from '../../modules/device-info/src/index';
import type { Tool } from '../agent/types';

export const deviceInfo: Tool = {
  name: 'get_device_info',
  description: `Read this Android device manufacturer, model, Android version,
API level and supported CPU architectures.`,
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async execute() {
    return getDeviceInfo();
  },
};
