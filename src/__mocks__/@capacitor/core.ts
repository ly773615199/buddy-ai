/**
 * @capacitor/core mock — 用于 vitest 环境（非原生平台）
 */
export const Capacitor = {
  isNativePlatform: () => false,
  getPlatform: () => 'web',
  isPluginAvailable: () => false,
};

export function registerPlugin<T = any>(_name: string): T {
  return {} as T;
}
