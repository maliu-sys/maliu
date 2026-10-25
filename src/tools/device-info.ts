import { getDeviceInfo } from '../../modules/device-info/src';
import type { Tool } from '../agent/types';
import { throwIfAborted } from '../agent/timeout';

export const deviceInfo: Tool = {
  name: 'get_device_info',
  description:
    'Read this Android device manufacturer, model, Android version, API level and supported CPU architectures.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async execute(args, signal) {
    if (
      !args ||
      typeof args !== 'object' ||
      Array.isArray(args) ||
      Object.keys(args).length
    ) {
      throw new Error('This tool accepts an empty object.');
    }
    throwIfAborted(signal);
    return getDeviceInfo();
  },
};
