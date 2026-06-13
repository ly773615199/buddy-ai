// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
import { useState, useEffect, useCallback, useRef } from 'react';
import { t } from '../i18n/t';


interface SensorData {
  location: {lat: number;lng: number;accuracy: number;} | null;
  motion: {x: number;y: number;z: number;state: string;} | null;
  environment: {light: number;battery: number;online: boolean;} | null;
  permissionStatus: {
    location: 'granted' | 'denied' | 'prompt';
    motion: 'granted' | 'denied' | 'prompt';
  };
}

interface SensorPanelProps {
  primaryColor?: string;
  onSensorUpdate?: (data: SensorData) => void;
}

export default function SensorPanel({
  primaryColor = '#58a6ff', onSensorUpdate }: SensorPanelProps) {

  const [data, setData] = useState<SensorData>({
    location: null,
    motion: null,
    environment: null,
    permissionStatus: { location: 'prompt', motion: 'prompt' }
  });
  const [activeSensors, setActiveSensors] = useState<Set<string>>(new Set());
  const watchIdRef = useRef<number | null>(null);
  const motionHandlerRef = useRef<((e: DeviceMotionEvent) => void) | null>(null);

  // 清理
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation?.clearWatch(watchIdRef.current);
      }
      if (motionHandlerRef.current) {
        window.removeEventListener('devicemotion', motionHandlerRef.current as any);
      }
    };
  }, []);

  // 位置追踪
  const toggleLocation = useCallback(async () => {
    if (activeSensors.has('location')) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setActiveSensors((prev) => {const n = new Set(prev);n.delete('location');return n;});
      setData((prev) => ({ ...prev, location: null }));
      return;
    }

    try {
      // 先检查权限
      const perm = await navigator.permissions?.query({ name: 'geolocation' });
      if (perm?.state === 'denied') {
        setData((prev) => ({ ...prev, permissionStatus: { ...prev.permissionStatus, location: 'denied' } }));
        return;
      }

      const id = navigator.geolocation.watchPosition(
        (pos) => {
          const loc = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          };
          setData((prev) => {
            const next = { ...prev, location: loc, permissionStatus: { ...prev.permissionStatus, location: 'granted' as const } };
            onSensorUpdate?.(next);
            return next;
          });
        },
        () => {
          setData((prev) => ({ ...prev, permissionStatus: { ...prev.permissionStatus, location: 'denied' as const } }));
        },
        { enableHighAccuracy: false, maximumAge: 5000, timeout: 10000 }
      );
      watchIdRef.current = id;
      setActiveSensors((prev) => new Set(prev).add('location'));
    } catch {
      setData((prev) => ({ ...prev, permissionStatus: { ...prev.permissionStatus, location: 'denied' as const } }));
    }
  }, [activeSensors, onSensorUpdate]);

  // 运动追踪
  const toggleMotion = useCallback(async () => {
    if (activeSensors.has('motion')) {
      if (motionHandlerRef.current) {
        window.removeEventListener('devicemotion', motionHandlerRef.current as any);
        motionHandlerRef.current = null;
      }
      setActiveSensors((prev) => {const n = new Set(prev);n.delete('motion');return n;});
      setData((prev) => ({ ...prev, motion: null }));
      return;
    }

    try {
      // iOS 13+ 需要请求权限
      if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
        const perm = await (DeviceMotionEvent as any).requestPermission();
        if (perm !== 'granted') {
          setData((prev) => ({ ...prev, permissionStatus: { ...prev.permissionStatus, motion: 'denied' as const } }));
          return;
        }
      }

      const handler = (e: DeviceMotionEvent) => {
        const acc = e.accelerationIncludingGravity;
        if (!acc) return;
        const x = acc.x ?? 0;
        const y = acc.y ?? 0;
        const z = acc.z ?? 0;
        const magnitude = Math.sqrt(x * x + y * y + z * z);

        let state = 'still';
        if (magnitude > 20) state = 'shaking';else
        if (magnitude > 15) state = 'walking';else
        if (magnitude > 12) state = 'tilted';

        const motion = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, z: Math.round(z * 10) / 10, state };
        setData((prev) => {
          const next = { ...prev, motion, permissionStatus: { ...prev.permissionStatus, motion: 'granted' as const } };
          onSensorUpdate?.(next);
          return next;
        });
      };

      window.addEventListener('devicemotion', handler as any);
      motionHandlerRef.current = handler;
      setActiveSensors((prev) => new Set(prev).add('motion'));
      setData((prev) => ({ ...prev, permissionStatus: { ...prev.permissionStatus, motion: 'granted' as const } }));
    } catch {
      setData((prev) => ({ ...prev, permissionStatus: { ...prev.permissionStatus, motion: 'denied' as const } }));
    }
  }, [activeSensors, onSensorUpdate]);

  // 环境信息（网络 + 电池）
  const toggleEnvironment = useCallback(async () => {
    if (activeSensors.has('environment')) {
      setActiveSensors((prev) => {const n = new Set(prev);n.delete('environment');return n;});
      setData((prev) => ({ ...prev, environment: null }));
      return;
    }

    const env: {light: number;battery: number;online: boolean;} = {
      light: -1,
      battery: -1,
      online: navigator.onLine
    };

    // 环境光
    try {
      if ('AmbientLightSensor' in window) {
        const sensor = new (window as any).AmbientLightSensor();
        sensor.addEventListener('reading', () => {
          setData((prev) => ({
            ...prev,
            environment: { ...(prev.environment ?? env), light: Math.round(sensor.illuminance) }
          }));
        });
        sensor.start();
      }
    } catch {/* not supported */}

    // 电池
    try {
      if ('getBattery' in navigator) {
        const battery = await (navigator as any).getBattery();
        env.battery = Math.round(battery.level * 100);
      }
    } catch {/* not supported */}

    setData((prev) => {
      const next = { ...prev, environment: env };
      onSensorUpdate?.(next);
      return next;
    });
    setActiveSensors((prev) => new Set(prev).add('environment'));
  }, [activeSensors, onSensorUpdate]);

  const accentStyle = { color: primaryColor };
  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    border: `1px solid ${active ? primaryColor : '#30363d'}`,
    background: active ? `${primaryColor}22` : '#21262d',
    color: active ? primaryColor : '#c9d1d9',
    fontFamily: 'inherit',
    transition: 'all 0.15s'
  });

  const statusDot = (active: boolean) =>
  <span style={{
    display: 'inline-block',
    width: 6, height: 6, borderRadius: '50%',
    background: active ? '#3fb950' : '#484f58',
    boxShadow: active ? '0 0 6px #3fb95066' : 'none',
    marginRight: 4
  }} />;


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#c9d1d9' }}>{"\uD83D\uDCE1 \u4F20\u611F\u5668\u9762\u677F"}</div>

      {/* 传感器控制 */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button style={btnStyle(activeSensors.has('location'))} onClick={toggleLocation}>
          {statusDot(activeSensors.has('location'))} 📍 位置
        </button>
        <button style={btnStyle(activeSensors.has('motion'))} onClick={toggleMotion}>
          {statusDot(activeSensors.has('motion'))} 🏃 运动
        </button>
        <button style={btnStyle(activeSensors.has('environment'))} onClick={toggleEnvironment}>
          {statusDot(activeSensors.has('environment'))} 🌡️ 环境
        </button>
      </div>

      {/* 位置数据 */}
      {data.location &&
      <div style={cardStyle}>
          <div style={{ ...accentStyle, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{"\uD83D\uDCCD \u4F4D\u7F6E"}</div>
          <div style={dataStyle}>
            <span>{t("\u7EAC\u5EA6: {{lat}}", { lat: data.location.lat })}</span>
            <span>{t("\u7ECF\u5EA6: {{lng}}", { lng: data.location.lng })}</span>
            <span>{t("\u7CBE\u5EA6: \xB1{{accuracy}}m", { accuracy: data.location.accuracy })}</span>
          </div>
        </div>
      }

      {/* 运动数据 */}
      {data.motion &&
      <div style={cardStyle}>
          <div style={{ ...accentStyle, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{"\uD83C\uDFC3 \u8FD0\u52A8"}</div>
          <div style={dataStyle}>
            <span>{"\u72B6\u6001: {motionStateEmoji(data.motion.state)} {data.motion.state}"}</span>
            <span>X: {data.motion.x} Y: {data.motion.y} Z: {data.motion.z}</span>
          </div>
        </div>
      }

      {/* 环境数据 */}
      {data.environment &&
      <div style={cardStyle}>
          <div style={{ ...accentStyle, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{"\uD83C\uDF21\uFE0F \u73AF\u5883"}</div>
          <div style={dataStyle}>
            {data.environment.light >= 0 && <span>💡 {data.environment.light} lux</span>}
            {data.environment.battery >= 0 && <span>🔋 {data.environment.battery}%</span>}
            <span>{data.environment.online ? "\uD83C\uDF10 \u5728\u7EBF" : "\uD83D\uDCF4 \u79BB\u7EBF"}</span>
          </div>
        </div>
      }

      {/* 权限状态 */}
      {(data.permissionStatus.location === 'denied' || data.permissionStatus.motion === 'denied') &&
      <div style={{
        padding: '6px 10px',
        borderRadius: 6,
        background: '#d2992222',
        border: '1px solid #d2992244',
        color: '#d29922',
        fontSize: 12
      }}>{"\u26A0\uFE0F \u90E8\u5206\u4F20\u611F\u5668\u6743\u9650\u88AB\u62D2\u7EDD\uFF0C\u8BF7\u5728\u6D4F\u89C8\u5668\u8BBE\u7F6E\u4E2D\u5F00\u542F"}</div>
      }

      {/* 无数据提示 */}
      {activeSensors.size === 0 &&
      <div style={{ color: '#8b949e', fontSize: 12, textAlign: 'center', padding: 20 }}>{"\u70B9\u51FB\u4E0A\u65B9\u6309\u94AE\u5F00\u542F\u4F20\u611F\u5668"}</div>
      }
    </div>);

}

const cardStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 6,
  background: '#161b22',
  border: '1px solid #30363d'
};

const dataStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 12,
  color: '#c9d1d9'
};

function motionStateEmoji(state: string): string {
  const map: Record<string, string> = {
    still: '🧍',
    walking: '🚶',
    shaking: '📳',
    tilted: '📐'
  };
  return map[state] ?? '❓';
}