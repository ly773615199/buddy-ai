// Mock @capacitor/core for tests that import frontend voice modules
export const Capacitor = {
  getPlatform: () => 'web',
  isNativePlatform: () => false,
  isPluginAvailable: () => false,
  registerPlugin: (_name: string, _options?: any) => ({}),
};

export const registerPlugin = Capacitor.registerPlugin;
export default Capacitor;
