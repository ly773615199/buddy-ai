// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
/**
 * BuddyCanvas — Three.js 3D 渲染的 React 包装
 *
 * 3D 精灵渲染（Three.js）
 * 接收 buddyState，驱动 3D 渲染器
 *
 * Phase 1：光团 + 粒子
 * Phase 3+：人形 mesh + 骨骼
 * Fallback：Canvas2D 光团
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { BuddyRenderer } from '../renderer/BuddyRenderer';
import { Canvas2DFallback } from '../renderer/detect-tier';
import type { RenderTier } from '../renderer/detect-tier';
import type { BuddyState, SpriteState, ActionMeta } from '../types/buddy';
import { computeEmotionParams, lerpEmotionParams } from '../emotion/emotion-particles';
import type { EmotionParticleParams } from '../emotion/emotion-particles';


interface BuddyCanvasProps {
  state: SpriteState;
  buddyState?: BuddyState | null;
  onClick?: () => void;
  width?: number;
  height?: number;
  actionMeta?: ActionMeta;
}

export default function BuddyCanvas({
  state, buddyState, onClick, width = 280, height = 260, actionMeta
}: BuddyCanvasProps) {

  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<BuddyRenderer | null>(null);
  const fallbackRef = useRef<Canvas2DFallback | null>(null);
  const [tier, setTier] = useState<RenderTier>('fallback');
  const [ready, setReady] = useState(false);

  // 初始化渲染器
  useEffect(() => {
    if (!containerRef.current) return;
    if (rendererRef.current || fallbackRef.current) return;

    const visualSeed = buddyState?.visualSeed ?? {
      primaryColor: '#58a6ff',
      texture: 'soft',
      temperament: 'warm',
      seed: 0
    };

    const renderer = new BuddyRenderer({
      container: containerRef.current,
      width,
      height,
      primaryColor: visualSeed.primaryColor,
      secondaryColor: visualSeed.secondaryColor,
      texture: visualSeed.texture,
      temperament: visualSeed.temperament
    });

    renderer.setOnTierDetected((t) => {
      setTier(t);
    });

    renderer.init().then((t) => {
      setTier(t);
      if (t !== 'fallback') {
        renderer.start();
        setReady(true);
      } else {
        // Canvas2D 兜底
        const fallback = new Canvas2DFallback(
          containerRef.current!,
          width,
          height,
          visualSeed.primaryColor,
          visualSeed.secondaryColor || visualSeed.primaryColor,
          visualSeed.temperament
        );
        fallback.start();
        fallbackRef.current = fallback;
        setReady(true);
      }
    });

    rendererRef.current = renderer;

    return () => {
      renderer.dispose();
      rendererRef.current = null;
      fallbackRef.current?.dispose();
      fallbackRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  // 同步 buddyState → 渲染器
  useEffect(() => {
    const renderer = rendererRef.current;
    const fallback = fallbackRef.current;

    if (!ready) return;

    // Canvas2D fallback 模式
    if (fallback) {
      if (buddyState?.formProgress != null) {
        fallback.updateProgress(buddyState.formProgress);
      }
      if (buddyState?.visualSeed) {
        fallback.updateColors(
          buddyState.visualSeed.primaryColor,
          buddyState.visualSeed.secondaryColor
        );
      }
      return;
    }

    if (!renderer) return;

    // 颜色
    if (buddyState?.visualSeed) {
      renderer.updateColors(
        buddyState.visualSeed.primaryColor,
        buddyState.visualSeed.secondaryColor
      );
      // 质感
      renderer.updateTexture(buddyState.visualSeed.texture);
    }

    // formProgress
    if (buddyState?.formProgress != null) {
      renderer.updateProgress(buddyState.formProgress);
    }

    // genome → 人形 mesh + 触发 2D→3D 切换
    if (buddyState?.genome) {
      renderer.updateGenome(buddyState.genome);
      // 3D 就绪后切换
      if (renderer.isChibiMode()) {
        renderer.triggerSwitchTo3D();
      }
    }

    // 情绪 → 粒子参数
    if (buddyState?.emotion) {
      const params = computeEmotionParams(buddyState.emotion);
      renderer.updateEmotion(params);
      renderer.updateMood(buddyState.emotion.mood || 'neutral');
    }
  }, [buddyState, ready]);

  // 窗口大小变化
  useEffect(() => {
    rendererRef.current?.resize(width, height);
    fallbackRef.current?.resize(width, height);
  }, [width, height]);

  // 点击处理
  const handleClick = useCallback(() => {
    onClick?.();
  }, [onClick]);

  // 鼠标追踪
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    rendererRef.current?.onMouseMove(
      e.clientX - rect.left,
      e.clientY - rect.top,
      true
    );
  }, []);

  const handleMouseLeave = useCallback(() => {
    rendererRef.current?.onMouseMove(0, 0, false);
  }, []);

  // 点击坐标
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    rendererRef.current?.onClick(x, y);
    fallbackRef.current?.onClick(x, y);
  }, []);

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onPointerDown={handlePointerDown}
      style={{
        width, height,
        cursor: 'pointer',
        borderRadius: 12,
        background: 'linear-gradient(180deg, rgba(13,17,23,0) 0%, rgba(22,27,34,0.5) 100%)',
        position: 'relative',
        touchAction: 'none',
        overflow: 'hidden',
        imageRendering: 'auto',
      }}>
      
      {/* 渲染器会自动挂载 canvas 到这里 */}
    </div>);

}