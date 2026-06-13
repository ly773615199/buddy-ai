/**
 * 浏览器实验性 API 类型声明
 * 覆盖 Battery、Network Information、SpeechRecognition、
 * AmbientLightSensor、DeviceMotionEvent.requestPermission 等
 */

export {};

declare global {
  // ==================== Battery API ====================
  interface BatteryManager extends EventTarget {
    charging: boolean;
    chargingTime: number;
    dischargingTime: number;
    level: number;
    onchargingchange: ((this: BatteryManager, ev: Event) => void) | null;
    onchargingtimechange: ((this: BatteryManager, ev: Event) => void) | null;
    ondischargingtimechange: ((this: BatteryManager, ev: Event) => void) | null;
    onlevelchange: ((this: BatteryManager, ev: Event) => void) | null;
  }

  // ==================== Network Information API ====================
  type ConnectionType = 'bluetooth' | 'cellular' | 'ethernet' | 'mixed' | 'none' | 'other' | 'unknown' | 'wifi';
  type EffectiveConnectionType = '2g' | '3g' | '4g' | 'slow-2g';

  interface NetworkInformation extends EventTarget {
    downlink: number;
    effectiveType: EffectiveConnectionType;
    onchange: ((this: NetworkInformation, ev: Event) => void) | null;
    rtt: number;
    saveData: boolean;
    type: ConnectionType;
  }

  // ==================== Web Speech API ====================
  type SpeechRecognitionErrorCode =
    | 'aborted'
    | 'audio-capture'
    | 'bad-grammar'
    | 'language-not-supported'
    | 'no-speech'
    | 'not-allowed'
    | 'service-not-available';

  interface SpeechRecognitionAlternative {
    readonly confidence: number;
    readonly transcript: string;
  }

  interface SpeechRecognitionResult {
    readonly isFinal: boolean;
    readonly length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
  }

  interface SpeechRecognitionResultList {
    readonly length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
  }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
  }

  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: SpeechRecognitionErrorCode;
    readonly message: string;
  }

  interface SpeechRecognitionEventMap {
    audioend: Event;
    audiostart: Event;
    end: Event;
    error: SpeechRecognitionErrorEvent;
    nomatch: SpeechRecognitionEvent;
    result: SpeechRecognitionEvent;
    soundend: Event;
    soundstart: Event;
    speechend: Event;
    speechstart: Event;
    start: Event;
  }

  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    maxAlternatives: number;
    onaudioend: ((this: SpeechRecognition, ev: Event) => void) | null;
    onaudiostart: ((this: SpeechRecognition, ev: Event) => void) | null;
    onend: ((this: SpeechRecognition, ev: Event) => void) | null;
    onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
    onnomatch: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
    onsoundend: ((this: SpeechRecognition, ev: Event) => void) | null;
    onsoundstart: ((this: SpeechRecognition, ev: Event) => void) | null;
    onspeechend: ((this: SpeechRecognition, ev: Event) => void) | null;
    onspeechstart: ((this: SpeechRecognition, ev: Event) => void) | null;
    onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
    abort(): void;
    start(): void;
    stop(): void;
    addEventListener<K extends keyof SpeechRecognitionEventMap>(
      type: K,
      listener: (this: SpeechRecognition, ev: SpeechRecognitionEventMap[K]) => void,
    ): void;
    removeEventListener<K extends keyof SpeechRecognitionEventMap>(
      type: K,
      listener: (this: SpeechRecognition, ev: SpeechRecognitionEventMap[K]) => void,
    ): void;
  }

  // ==================== Ambient Light Sensor ====================
  interface AmbientLightSensorOptions {
    frequency?: number;
  }

  // ==================== Navigator 扩展 ====================
  interface Navigator {
    getBattery?: () => Promise<BatteryManager>;
    connection?: NetworkInformation;
    mozConnection?: NetworkInformation;
    webkitConnection?: NetworkInformation;
  }

  // ==================== Window 扩展 ====================
  interface Window {
    SpeechRecognition?: { new (): SpeechRecognition };
    webkitSpeechRecognition?: { new (): SpeechRecognition };
    AmbientLightSensor?: { new (options?: AmbientLightSensorOptions): Sensor & { readonly illuminance: number } };
    // Sprint 4: Electron 浮窗 API（通过 preload 桥接）
    electronAPI?: {
      openMainWindow?: () => void;
      showContextMenu?: () => void;
      onStateUpdate?: (callback: (state: Record<string, unknown>) => void) => void;
      buddyStateSync?: (state: Record<string, unknown>) => void;
      dragStart?: (offset: { x: number; y: number }) => void;
      dragMove?: (mousePos: { x: number; y: number }) => void;
      dragEnd?: () => void;
      // Sprint 5: 感知事件
      onPerceptionEvent?: (callback: (event: Record<string, unknown>) => void) => void;
      // Sprint 6: 自主行为 + 窗口感知
      onBehaviorEvent?: (callback: (event: Record<string, unknown>) => void) => void;
      onWindowAwareness?: (callback: (event: Record<string, unknown>) => void) => void;
    };
  }

  // ==================== GlobalThis 扩展 ====================
  var SpeechRecognition: { new (): SpeechRecognition } | undefined;
  var webkitSpeechRecognition: { new (): SpeechRecognition } | undefined;

  // ==================== Sensor base (generic sensor API) ====================
  interface Sensor extends EventTarget {
    readonly activated: boolean;
    readonly hasReading: boolean;
    readonly timestamp: DOMHighResTimeStamp | null;
    start(): void;
    stop(): void;
  }
}
