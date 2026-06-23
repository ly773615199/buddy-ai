/**
 * useAvatarGeneration — 3D 角色生成 Hook
 *
 * 监听 buddyState.genome → 检查缓存 → 触发生成 → 轮询状态 → 通知渲染器切换
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { BuddyGenome } from '../types/buddy';

interface AvatarState {
  status: 'idle' | 'checking' | 'generating' | 'ready' | 'failed';
  modelUrl: string | null;
  hash: string | null;
  error: string | null;
}

const POLL_INTERVAL = 3000;
const MAX_POLLS = 60;

export function useAvatarGeneration(genome: BuddyGenome | null | undefined) {
  const [avatar, setAvatar] = useState<AvatarState>({
    status: 'idle', modelUrl: null, hash: null, error: null,
  });
  const pollRef = useRef<number | null>(null);
  const generatedRef = useRef<Set<string>>(new Set());

  // 生成
  const generate = useCallback(async (g: BuddyGenome) => {
    try {
      setAvatar(prev => ({ ...prev, status: 'checking' }));

      const res = await fetch('/api/avatar/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(g),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();

      if (data.status === 'cached') {
        setAvatar({ status: 'ready', modelUrl: data.modelUrl, hash: null, error: null });
        return;
      }

      if (data.status === 'generating') {
        setAvatar(prev => ({ ...prev, status: 'generating', hash: data.hash }));
        // 开始轮询
        startPolling(data.hash);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      setAvatar(prev => ({ ...prev, status: 'failed', error }));
    }
  }, []);

  // 轮询状态
  const startPolling = useCallback((hash: string) => {
    let polls = 0;
    const poll = async () => {
      polls++;
      if (polls > MAX_POLLS) {
        setAvatar(prev => ({ ...prev, status: 'failed', error: 'Generation timed out' }));
        return;
      }

      try {
        const res = await fetch(`/api/avatar/status/${hash}`);
        const data = await res.json();

        if (data.status === 'ready') {
          setAvatar({ status: 'ready', modelUrl: data.modelUrl, hash, error: null });
          return;
        }
      } catch {
        // 忽略轮询错误，继续重试
      }

      pollRef.current = window.setTimeout(poll, POLL_INTERVAL);
    };
    poll();
  }, []);

  // 监听 genome 变化
  useEffect(() => {
    if (!genome) return;

    // 简单 hash 检查，避免重复生成
    const key = JSON.stringify(genome);
    if (generatedRef.current.has(key)) return;
    generatedRef.current.add(key);

    generate(genome);

    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [genome, generate]);

  return avatar;
}
