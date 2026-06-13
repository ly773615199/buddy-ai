import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.buddy.ai',
  appName: 'Buddy',
  webDir: 'dist',
  server: {
    // 开发时可指向 Vite dev server（按需修改 IP）
    // url: 'http://192.168.x.x:5173',
    // cleartext: true,
    androidScheme: 'https',
  },
  plugins: {
    // 自定义插件由 Capacitor 自动发现，无需额外配置
  },
  ios: {
    infoPlist: {
      NSMicrophoneUsageDescription: 'Buddy 需要麦克风来听你说话',
      NSCameraUsageDescription: 'Buddy 需要摄像头来看到你',
      UIBackgroundModes: ['audio'],
    },
    contentInset: 'automatic',
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
