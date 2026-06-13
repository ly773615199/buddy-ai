// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
import { useState, useRef, useCallback, useEffect } from 'react';
import { CameraManager } from '../vision/camera.js';
import { FrameCaptureManager } from '../vision/frame-capture.js';
import { OCRProcessor } from '../vision/ocr.js';
import { SceneAnalyzer } from '../vision/scene-analyze.js';
import { VisionPrivacyManager } from '../vision/privacy.js';
import { useFirstTimeConsent } from '../hooks/useFirstTimeConsent.js';
import SensorConsentNotification from './SensorConsentNotification.js';
import type { CameraDevice } from '../types/device-types.js';


type VisionMode = 'camera' | 'ocr' | 'scene';

interface VisionPanelProps {
  primaryColor?: string;
  onResult?: (result: {type: string;data: unknown;}) => void;
}

export default function VisionPanel({
  primaryColor = '#58a6ff', onResult }: VisionPanelProps) {

  const [mode, setMode] = useState<VisionMode>('camera');
  const [streaming, setStreaming] = useState(false);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [privacyLevel, setPrivacyLevel] = useState<'strict' | 'moderate' | 'open'>('moderate');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<CameraManager | null>(null);
  const captureRef = useRef<FrameCaptureManager | null>(null);
  const ocrRef = useRef<OCRProcessor | null>(null);
  const sceneRef = useRef<SceneAnalyzer | null>(null);
  const privacyRef = useRef<VisionPrivacyManager | null>(null);

  // 首次摄像头告知
  const cameraConsent = useFirstTimeConsent('camera');

  // 初始化
  useEffect(() => {
    cameraRef.current = new CameraManager();
    captureRef.current = new FrameCaptureManager();
    ocrRef.current = new OCRProcessor();
    sceneRef.current = new SceneAnalyzer();
    privacyRef.current = new VisionPrivacyManager({ permissionLevel: privacyLevel as any });

    return () => {
      cameraRef.current?.stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- privacyLevel 通过下方单独 effect 同步
  }, []);

  // 隐私级别变更
  useEffect(() => {
    privacyRef.current = new VisionPrivacyManager({ permissionLevel: privacyLevel as any });
  }, [privacyLevel]);

  // 枚举设备
  const enumerateDevices = useCallback(async () => {
    if (!cameraRef.current) return;
    const devs = await cameraRef.current.enumerateDevices();
    setDevices(devs);
    if (devs.length > 0 && !selectedDevice) {
      setSelectedDevice(devs[0].deviceId);
    }
  }, [selectedDevice]);

  // 开启摄像头（首次需告知同意）
  const startCamera = useCallback(async () => {
    if (!cameraRef.current || !videoRef.current) return;

    // 首次使用需告知
    if (cameraConsent.needsNotification) {
      cameraConsent.grant();
    }

    setError('');
    try {
      await enumerateDevices();
      const stream = await cameraRef.current.startStream(selectedDevice || undefined);
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setStreaming(true);
    } catch (e) {
      setError(`${"\u6444\u50CF\u5934\u542F\u52A8\u5931\u8D25"}: ${(e as Error).message}`);
    }
  }, [selectedDevice, enumerateDevices, cameraConsent]);

  // 关闭摄像头
  const stopCamera = useCallback(() => {
    cameraRef.current?.stopStream();
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreaming(false);
  }, []);

  // 截取当前帧
  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);

    // 隐私处理
    if (privacyLevel === 'strict') {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      const base64 = dataUrl.split(',')[1];
      const anonymized = privacyRef.current?.anonymizeFrame(base64) ?? base64;
      return `data:image/jpeg;base64,${anonymized}`;
    }
    return canvas.toDataURL('image/jpeg', 0.8);
  }, [privacyLevel]);

  // OCR 识别
  const handleOCR = useCallback(async () => {
    const frameData = captureFrame();
    if (!frameData || !ocrRef.current) return;
    setLoading(true);
    setError('');
    try {
      const ocrResult = await ocrRef.current.recognize(frameData);
      const text = ocrResult.segments.map((s) => s.text).join('\n');
      setResult(text || `(${"\u672A\u8BC6\u522B\u5230\u6587\u5B57"})`);
      onResult?.({ type: 'ocr', data: ocrResult });
    } catch (e) {
      setError(`${"OCR \u5931\u8D25"}: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [captureFrame, onResult]);

  // 场景分析
  const handleSceneAnalysis = useCallback(async () => {
    const frameData = captureFrame();
    if (!frameData || !sceneRef.current) return;
    setLoading(true);
    setError('');
    try {
      const sceneResult = await sceneRef.current.analyze(frameData);
      const desc = [
      `${"\u573A\u666F"}: ${sceneResult.description}`,
      sceneResult.objects.length > 0 ?
      `${"\u7269\u4F53"}: ${sceneResult.objects.map((o) => `${o.name}(${Math.round(o.confidence * 100)}%)`).join(', ')}` :
      '',
      sceneResult.objects.length > 0 ? `${"\u7269\u4F53\u6570"}: ${sceneResult.objects.length}` : '',
      sceneResult.text ? `${"\u6587\u5B57"}: ${sceneResult.text}` : ''].
      filter(Boolean).join('\n');
      setResult(desc || `(${"\u672A\u68C0\u6D4B\u5230\u573A\u666F\u4FE1\u606F"})`);
      onResult?.({ type: 'scene', data: sceneResult });
    } catch (e) {
      setError(`${"\u573A\u666F\u5206\u6790\u5931\u8D25"}: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [captureFrame, onResult]);

  // 拍照保存
  const handleSnapshot = useCallback(() => {
    const frameData = captureFrame();
    if (!frameData) return;
    setResult('📸 已截取当前帧');
    onResult?.({ type: 'snapshot', data: frameData });
  }, [captureFrame, onResult]);

  const accentStyle = { color: primaryColor };
  const btnStyle = (active?: boolean): React.CSSProperties => ({
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 模式切换 */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button style={btnStyle(mode === 'camera')} onClick={() => setMode('camera')}>📷 {"\u6444\u50CF\u5934"}</button>
        <button style={btnStyle(mode === 'ocr')} onClick={() => setMode('ocr')}>📝 {"\u6587\u5B57\u8BC6\u522B"}</button>
        <button style={btnStyle(mode === 'scene')} onClick={() => setMode('scene')}>🔍 {"\u573A\u666F\u5206\u6790"}</button>
      </div>

      {/* 首次摄像头告知 */}
      {cameraConsent.showNotification && (
        <SensorConsentNotification
          sensor="camera"
          primaryColor={primaryColor}
          onGrant={() => { cameraConsent.grant(); startCamera(); }}
          onDismiss={cameraConsent.dismiss}
        />
      )}

      {/* 设备选择 */}
      {devices.length > 1 &&
      <select
        value={selectedDevice}
        onChange={(e) => setSelectedDevice(e.target.value)}
        style={{
          padding: '4px 8px',
          borderRadius: 6,
          border: '1px solid #30363d',
          background: '#0d1117',
          color: '#c9d1d9',
          fontSize: 12,
          fontFamily: 'inherit'
        }}>
        
          {devices.map((d) =>
        <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
        )}
        </select>
      }

      {/* 视频预览 */}
      <div style={{
        position: 'relative',
        background: '#000',
        borderRadius: 8,
        overflow: 'hidden',
        aspectRatio: '4/3',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <video
          ref={videoRef}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: streaming ? 'block' : 'none'
          }}
          playsInline
          muted />
        
        {!streaming &&
        <div style={{ color: '#8b949e', fontSize: 13, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📷</div>
            <div>{"\u6444\u50CF\u5934\u672A\u5F00\u542F"}</div>
          </div>
        }
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>

      {/* 控制按钮 */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {!streaming ?
        <button style={btnStyle()} onClick={startCamera}>{"\u25B6 \u5F00\u542F\u6444\u50CF\u5934"}</button> :

        <>
            <button style={btnStyle()} onClick={stopCamera}>{"\u23F9 \u5173\u95ED"}</button>
            <button style={btnStyle()} onClick={handleSnapshot}>{"\uD83D\uDCF8 \u62CD\u7167"}</button>
            {mode === 'ocr' &&
          <button style={btnStyle()} onClick={handleOCR} disabled={loading}>
                {loading ? "\u8BC6\u522B\u4E2D..." : '📝 ' + "OCR \u8BC6\u522B"}
              </button>
          }
            {mode === 'scene' &&
          <button style={btnStyle()} onClick={handleSceneAnalysis} disabled={loading}>
                {loading ? "\u5206\u6790\u4E2D..." : '🔍 ' + "\u5206\u6790\u573A\u666F"}
              </button>
          }
          </>
        }
      </div>

      {/* 隐私控制 */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: '#8b949e', flexWrap: 'wrap' }}>
        <span>{"\uD83D\uDD12 \u9690\u79C1:"}</span>
        {(['strict', 'moderate', 'open'] as const).map((level) =>
        <button
          key={level}
          style={{
            ...btnStyle(privacyLevel === level),
            padding: '2px 8px',
            fontSize: 11
          }}
          onClick={() => setPrivacyLevel(level)}>
          
            {level === 'strict' ? "\u4E25\u683C" : level === 'moderate' ? "\u9002\u4E2D" : "\u5F00\u653E"}
          </button>
        )}
        {/* 摄像头授权撤回 */}
        {cameraConsent.hasConsent && (
          <button
            style={{ ...btnStyle(), padding: '2px 8px', fontSize: 11, color: '#f85149', borderColor: '#f8514944' }}
            onClick={() => { stopCamera(); cameraConsent.revoke(); }}
          >
            撤回摄像头授权
          </button>
        )}
      </div>

      {/* 错误提示 */}
      {error &&
      <div style={{
        padding: '6px 10px',
        borderRadius: 6,
        background: '#f8514922',
        border: '1px solid #f8514944',
        color: '#f85149',
        fontSize: 12
      }}>
          ⚠️ {error}
        </div>
      }

      {/* 结果展示 */}
      {result &&
      <div style={{
        padding: '8px 10px',
        borderRadius: 6,
        background: '#161b22',
        border: '1px solid #30363d',
        fontSize: 12,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        maxHeight: 200,
        overflowY: 'auto'
      }}>
          <span style={accentStyle}>{"\u7ED3\u679C:"}</span> {result}
        </div>
      }
    </div>);

}