import { useEffect, useRef, useCallback, useState, useSyncExternalStore } from 'react';
import type { BuddyEvent, ChatMessage, SpriteState, BuddyState, VisualSeed, ExpertModel, ToolPanelData, MemoryPanelData, KnowledgePanelData, AgentTraceStep, ScheduleEvent, ActionMeta } from '../types/buddy';

interface PerceptionEvent {
  id?: string;
  category: string;
  source: string;
  data?: unknown;
  timestamp: number;
}
import { BuddyLink } from '../comm/link.js';
import { SharedConnection } from '../comm/shared-connection.js';
import { Priority } from '../comm/types.js';

// ==================== 节流工具 ====================
function throttle<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn(...args);
      }, ms - (now - last));
    }
  }) as T;
}

interface UseWebSocketOptions {
  url: string;
  onEvent?: (event: BuddyEvent) => void;
  onStateChange?: (state: SpriteState) => void;
}

let msgCounter = 0;
const nextId = () => `msg-${++msgCounter}-${Date.now()}`;

export function useWebSocket({ url, onEvent, onStateChange }: UseWebSocketOptions) {
  // 提前创建 BuddyLink 实例，确保 useSyncExternalStore 有稳定引用
  const linkRef = useRef<BuddyLink>(new BuddyLink());
  // 多标签页 WS 共享
  const sharedRef = useRef<SharedConnection>(new SharedConnection());
  const [sharedRole, setSharedRole] = useState<'master' | 'slave' | 'unclaimed'>('unclaimed');
  // 用 useSyncExternalStore 零延迟感知连接状态（替代 1s 轮询）
  const connectedTag = useSyncExternalStore(
    linkRef.current.subscribe,
    linkRef.current.getSnapshot,
    () => 'idle', // SSR 兜底
  );
  const connected = connectedTag === 'live' || connectedTag === 'degraded';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [spriteState, setSpriteState] = useState<SpriteState>('idle');
  const [buddyState, setBuddyState] = useState<BuddyState | null>(null);
  const [ternaryExperts, setTernaryExperts] = useState<ExpertModel[]>([]);
  const [trainProgress, setTrainProgress] = useState<Record<string, { step: number; total: number; loss: number }>>({});
  const [toolPanelData, setToolPanelData] = useState<ToolPanelData | null>(null);
  const [memoryPanelData, setMemoryPanelData] = useState<MemoryPanelData | null>(null);
  const [knowledgePanelData, setKnowledgePanelData] = useState<KnowledgePanelData | null>(null);
  const [perceptionEvents, setPerceptionEvents] = useState<PerceptionEvent[]>([]);
  const [agentTrace, setAgentTrace] = useState<AgentTraceStep[]>([]);
  const [dreamLogs, setDreamLogs] = useState<{ journal: string; timestamp: number }[]>([]);
  const [registeredSkills, setRegisteredSkills] = useState<Array<{ name: string; description: string; version: string }>>([]);
  const [scheduleEvents, setScheduleEvents] = useState<ScheduleEvent[]>([]);
  const [sensorData, setSensorData] = useState<{
    location: { lat: number; lng: number; accuracy: number } | null;
    motion: { x: number; y: number; z: number; state: string } | null;
    environment: { light: number; battery: number; online: boolean } | null;
  } | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  // 任务队列状态（供 UI 显示处理中任务数）
  const [activeTaskCount, setActiveTaskCount] = useState(0);
  const [maxConcurrent, setMaxConcurrent] = useState(3);
  // 自主行为状态
  const [actionMeta, setActionMeta] = useState<ActionMeta>({ state: 'none', startTime: 0, duration: 0, intensity: 0 });
  // 内心独白
  const [narration, setNarration] = useState<{ content: string; type: string; timestamp: number } | null>(null);

  // 多专家并行结果
  const [multiExpertResults, setMultiExpertResults] = useState<Array<{ id: string; success: boolean; text: string; latencyMs: number }>>([]);
  const [multiExpertFusion, setMultiExpertFusion] = useState<{ merged: number; contradictions: number; associations: number } | null>(null);

  // 断连恢复：追踪最后收到的 seq
  const lastSeqRef = useRef<number>(0);
  const hasResumedRef = useRef<boolean>(false);

  // 消息幂等去重：最近 200 条消息 id，防止网络抖动重复处理
  const recentMsgIdsRef = useRef<Set<string>>(new Set());

  // 当前活跃任务 ID 追踪（用于消息关联）
  const currentTaskIdRef = useRef<string>('');
  const taskCounterRef = useRef(0);
  // 当前编排组 ID（用于折叠编排中间事件）
  const orchGroupRef = useRef<string>('');

  // ==================== Ref 透传回调 — 连接与回调解耦 ====================
  // 回调存 ref，handleMessage 通过 ref 调用，引用永远稳定
  // 这样 useEffect 只依赖 [url]，回调变化不再触发连接重建
  const onEventRef = useRef(onEvent);
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);

  // 传感器数据节流 — motion 500ms，防止高频更新阻塞 UI
  const setSensorDataThrottled = useRef(
    throttle((data: unknown) => setSensorData(data as typeof sensorData), 500)
  ).current;

  const setSprite = useCallback((state: SpriteState) => {
    setSpriteState(state);
    onStateChangeRef.current?.(state);
  }, []);

  // 移除最近一条 thinking 系统消息（响应开始时调用）
  const removeLastThinking = (msgs: ChatMessage[]): ChatMessage[] => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'system' && msgs[i].subtype === 'thinking') {
        return [...msgs.slice(0, i), ...msgs.slice(i + 1)];
      }
    }
    return msgs;
  };

  // ==================== 消息处理（从 BuddyLink 回调） ====================

  // 消息内容去重：防止重放消息（无 id）重复追加
  const recentContentRef = useRef<Set<string>>(new Set());
  // seq 去重：防止同 seq 消息重复处理
  const seenSeqsRef = useRef<Set<number>>(new Set());

  const handleMessage = useCallback((event: BuddyEvent) => {
    // seq 去重：同一条消息只处理一次
    const eventSeq = typeof (event as Record<string, unknown>)._replaySeq === 'number'
      ? (event as Record<string, unknown>)._replaySeq as number
      : event.seq;
    if (typeof eventSeq === 'number') {
      if (seenSeqsRef.current.has(eventSeq)) {
        return; // 已处理过，跳过
      }
      seenSeqsRef.current.add(eventSeq);
      // 限制集合大小
      if (seenSeqsRef.current.size > 500) {
        const seqs = [...seenSeqsRef.current];
        seenSeqsRef.current = new Set(seqs.slice(-250));
      }
    }

    // 追踪消息序列号（用于断连恢复）
    if (typeof event.seq === 'number' && event.seq > lastSeqRef.current) {
      lastSeqRef.current = event.seq;
    }
    // 重放消息也追踪 seq（通过 _replaySeq 标记）
    if (typeof (event as Record<string, unknown>)._replaySeq === 'number') {
      const replaySeq = (event as Record<string, unknown>)._replaySeq as number;
      if (replaySeq > lastSeqRef.current) {
        lastSeqRef.current = replaySeq;
      }
    }

    // 消息幂等去重：有 id 的消息检查是否重复
    if (event.id) {
      if (recentMsgIdsRef.current.has(event.id)) {
        return; // 重复消息，跳过
      }
      recentMsgIdsRef.current.add(event.id);
      // 限制集合大小
      if (recentMsgIdsRef.current.size > 200) {
        const ids = [...recentMsgIdsRef.current];
        recentMsgIdsRef.current = new Set(ids.slice(-100));
      }
    }

    // 内容去重：重放消息通常无 id，用 type+content 指纹防重复
    if (!event.id && typeof (event as Record<string, unknown>)._replaySeq === 'number') {
      const contentKey = `${event.type}:${String((event as Record<string, unknown>).content ?? (event as Record<string, unknown>).text ?? '').slice(0, 100)}`;
      if (recentContentRef.current.has(contentKey)) {
        return; // 重放重复，跳过
      }
      recentContentRef.current.add(contentKey);
      // 限制集合大小
      if (recentContentRef.current.size > 200) {
        const keys = [...recentContentRef.current];
        recentContentRef.current = new Set(keys.slice(-100));
      }
    }

    onEventRef.current?.(event);

    switch (event.type) {
      // ==================== 养成 v2 状态 ====================
      case 'status':
        if (event.data) {
          setBuddyState(event.data as BuddyState);
        }
        break;

      // ==================== 对话响应 ====================
      case 'llm_response': {
        const respContent = String((event as Record<string, unknown>).content ?? '');
        if (event.streaming) {
          setMessages(prev => {
            // 移除最近的 thinking 消息（响应已开始）
            const filtered = removeLastThinking(prev);
            const last = filtered[filtered.length - 1];
            if (last?.role === 'assistant' && last.streaming) {
              return [...filtered.slice(0, -1), { ...last, content: last.content + respContent }];
            }
            return [...filtered, {
              id: nextId(),
              role: 'assistant',
              content: respContent,
              timestamp: Date.now(),
              streaming: true,
              taskId: currentTaskIdRef.current,
            }];
          });
        } else {
          setMessages(prev => {
            // 移除最近的 thinking 消息
            const filtered = removeLastThinking(prev);
            const last = filtered[filtered.length - 1];
            if (last?.role === 'assistant' && last.streaming) {
              return [...filtered.slice(0, -1), { ...last, content: respContent || last.content, streaming: false }];
            }
            return [...filtered, {
              id: nextId(),
              role: 'assistant',
              content: respContent,
              timestamp: Date.now(),
              taskId: currentTaskIdRef.current,
            }];
          });
          setSprite('speaking');
          setTimeout(() => setSprite('idle'), 3000);
        }
        break;
      }

      // ==================== 流式片段（增量拼接） ====================
      case 'stream_chunk': {
        const chunkContent = String((event as Record<string, unknown>).content ?? '');
        setMessages(prev => {
          const filtered = removeLastThinking(prev);
          const last = filtered[filtered.length - 1];
          if (last?.role === 'assistant' && last.streaming) {
            return [...filtered.slice(0, -1), { ...last, content: last.content + chunkContent }];
          }
          // 没有流式消息则新建
          return [...filtered, {
            id: nextId(),
            role: 'assistant',
            content: chunkContent,
            timestamp: Date.now(),
            streaming: true,
            taskId: currentTaskIdRef.current,
          }];
        });
        break;
      }

      // ==================== 响应结束（清除 streaming 标记） ====================
      case 'response_end': {
        const endContent = String((event as Record<string, unknown>).content ?? '');
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming) {
            return [...prev.slice(0, -1), { ...last, content: endContent || last.content, streaming: false }];
          }
          return prev;
        });
        // 减少活跃任务计数
        setActiveTaskCount(c => Math.max(0, c - 1));
        break;
      }

      // ==================== 思考中 ====================
      case 'thinking':
        setSprite('thinking');
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: event.message || '🤔 让我看看...',
          timestamp: Date.now(),
          subtype: 'thinking',
        }]);
        break;

      // ==================== 工具调用 ====================
      case 'tool_call': {
        setSprite('executing');
        const toolCallId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        setMessages(prev => [...prev, {
          id: toolCallId,
          role: 'tool',
          content: `调用 ${event.tool}`,
          toolName: event.tool,
          toolPreview: event.args ? JSON.stringify(event.args, null, 2).slice(0, 200) : '',
          timestamp: Date.now(),
          taskId: currentTaskIdRef.current,
        }]);
        break;
      }

      case 'tool_result':
        setMessages(prev => {
          // 从后向前找到同名且未完成的工具卡片（支持并行工具调用）
          for (let i = prev.length - 1; i >= 0; i--) {
            const msg = prev[i];
            if (msg.role === 'tool' && msg.toolName === event.tool && msg.content.startsWith('调用')) {
              const updated = [...prev];
              updated[i] = {
                ...msg,
                toolPreview: event.preview?.slice(0, 500) || event.result?.slice(0, 500) || msg.toolPreview,
                content: `${msg.toolName} → ${event.success ? '✅' : '❌'}`,
              };
              return updated;
            }
          }
          return prev;
        });
        if (event.success) setSprite('executing');
        else { setSprite('error'); setTimeout(() => setSprite('idle'), 2000); }
        break;

      // ==================== 引导气泡 ====================
      case 'bubble':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'bubble',
          content: event.text || event.message || '',
          timestamp: Date.now(),
        }]);
        break;

      // ==================== 用户消息确认 ====================
      case 'user_message':
        break;

      // ==================== 情绪/动画状态 ====================
      case 'emotion':
        setBuddyState(prev => prev ? {
          ...prev,
          emotion: {
            mood: event.mood || prev.emotion.mood,
            energy: event.energy ?? prev.emotion.energy,
            satisfaction: event.satisfaction ?? prev.emotion.satisfaction,
          },
        } : null);
        if (event.mood === 'excited' || event.mood === 'happy') {
          setSprite('excited');
          setTimeout(() => setSprite('idle'), 2000);
        }
        break;

      case 'idle':
        setSprite('idle');
        break;

      case 'idle_action': {
        const action = event.action;
        if (action === 'sleep') {
          setSprite('sleeping');
        }
        // 设置自主行为状态（除 sleep 外都通过 actionMeta 驱动视觉）
        if (action && action !== 'sleep') {
          const dur = event.duration ?? 2000;
          const intens = event.intensity ?? 0.6;
          setActionMeta({
            state: action as ActionMeta['state'],
            startTime: Date.now(),
            duration: dur,
            intensity: intens,
          });
          // 行为结束后自动清除
          setTimeout(() => setActionMeta(m => m.state === action ? { state: 'none', startTime: 0, duration: 0, intensity: 0 } : m), dur);
        }
        break;
      }

      case 'dreaming':
        setSprite('sleeping');
        break;

      // ==================== 进化/成就 ====================
      case 'evolution':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: `✨ 进化了！${event.from} → ${event.to}`,
          timestamp: Date.now(),
        }]);
        break;

      case 'achievement':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: `🏆 成就解锁：${event.name}`,
          timestamp: Date.now(),
        }]);
        break;

      // ==================== 错误 ====================
      case 'error':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'error',
          content: event.message || '出了点问题...',
          timestamp: Date.now(),
        }]);
        setSprite('error');
        setTimeout(() => setSprite('idle'), 2000);
        // 错误也意味着一个任务结束
        setActiveTaskCount(c => Math.max(0, c - 1));
        break;

      // ==================== 工具确认请求 ====================
      case 'tool_confirm_request':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: `⚠️ 需要确认：${event.description || event.tool}`,
          timestamp: Date.now(),
        }]);
        break;

      // ==================== 确认请求（通用） ====================
      case 'confirm_required':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: `⚠️ ${event.question || '需要确认操作'}`,
          timestamp: Date.now(),
          confirmId: event.id,
        }]);
        break;

      // ==================== 意图澄清 ====================
      case 'clarify':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: `❓ ${event.question || '需要更多信息'}`,
          timestamp: Date.now(),
        }]);
        break;

      // ==================== 音频（内联小音频） ====================
      case 'audio':
        if (event.data) {
          try {
            const byteChars = atob(event.data);
            const byteArray = new Uint8Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) {
              byteArray[i] = byteChars.charCodeAt(i);
            }
            const format = event.format || 'mp3';
            const blob = new Blob([byteArray], { type: `audio/${format}` });
            const audioUrl = URL.createObjectURL(blob);
            const audio = new Audio(audioUrl);
            audio.play().catch(() => { /* autoplay blocked */ });
            audio.onended = () => URL.revokeObjectURL(audioUrl);
          } catch { /* ignore decode errors */ }
        }
        break;

      // ==================== 音频（大音频走 REST） ====================
      case 'audio_ready':
        if (event.id) {
          const format = event.format || 'mp3';
          fetch(`/api/audio/${encodeURIComponent(event.id)}`)
            .then(res => res.ok ? res.blob() : Promise.reject())
            .then(blob => {
              const audioUrl = URL.createObjectURL(blob);
              const audio = new Audio(audioUrl);
              audio.play().catch(() => { /* autoplay blocked */ });
              audio.onended = () => URL.revokeObjectURL(audioUrl);
            })
            .catch(() => { /* ignore fetch errors */ });
        }
        break;

      // ==================== 编排引擎（折叠显示） ====================
      case 'orch_start': {
        const orchId = `orch-${Date.now()}`;
        orchGroupRef.current = orchId;
        setActiveTaskCount(c => c + 1);
        setMessages(prev => [...prev, {
          id: orchId,
          role: 'system',
          content: `🎯 编排开始：${event.description || ''}（${event.taskCount || 0} 个任务）`,
          timestamp: Date.now(),
          orchGroup: orchId,
          subtype: 'orch',
        }]);
        break;
      }

      case 'orch_task_start':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: `▶️ ${event.taskName || event.taskId || '任务'}`,
          timestamp: Date.now(),
          orchGroup: orchGroupRef.current,
          subtype: 'orch',
        }]);
        break;

      case 'orch_task_done':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: `✅ ${event.taskName || event.taskId || '任务'}`,
          timestamp: Date.now(),
          orchGroup: orchGroupRef.current,
          subtype: 'orch',
        }]);
        break;

      case 'orch_task_fail':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: `❌ ${event.taskName || event.taskId || '任务'}${event.error ? `: ${event.error}` : ''}`,
          timestamp: Date.now(),
          orchGroup: orchGroupRef.current,
          subtype: 'orch',
        }]);
        break;

      case 'orch_task_retry':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: `🔄 ${event.taskId || '任务'} 重试中 (${event.attempt || '?'}/${event.maxRetry || '?'})`,
          timestamp: Date.now(),
          orchGroup: orchGroupRef.current,
          subtype: 'orch',
        }]);
        break;

      case 'orch_progress':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: `📊 ${event.done || 0}/${event.total || 0}`,
          timestamp: Date.now(),
          orchGroup: orchGroupRef.current,
          subtype: 'orch',
        }]);
        break;

      case 'orch_done':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: `🏁 编排完成（${event.totalMs ? `${(event.totalMs / 1000).toFixed(1)}s` : ''}）`,
          timestamp: Date.now(),
          orchGroup: orchGroupRef.current,
          subtype: 'orch',
        }]);
        setActiveTaskCount(c => Math.max(0, c - 1));
        orchGroupRef.current = '';
        break;

      case 'orch_fail':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'error',
          content: `💥 编排失败：${event.error || '未知错误'}`,
          timestamp: Date.now(),
          orchGroup: orchGroupRef.current,
        }]);
        setActiveTaskCount(c => Math.max(0, c - 1));
        orchGroupRef.current = '';
        break;

      // ==================== 多专家并行 ====================
      case 'multi_expert_result': {
        const experts = (event.experts ?? []) as Array<{ id: string; success: boolean; text: string; latencyMs: number }>;
        setMultiExpertResults(experts);
        // 展示每个专家的回答
        for (const exp of experts) {
          if (exp.success && exp.text) {
            setMessages(prev => [...prev, {
              id: nextId(),
              role: 'assistant',
              content: exp.text,
              timestamp: Date.now(),
              expertId: exp.id,
              expertLatency: exp.latencyMs,
            }]);
          }
        }
        break;
      }

      case 'multi_expert_complete': {
        const fusion = event.fusion as { merged: number; contradictions: number; associations: number } | undefined;
        if (fusion) {
          setMultiExpertFusion(fusion);
          setMessages(prev => [...prev, {
            id: nextId(),
            role: 'system',
            content: `🎯 多专家融合完成：${fusion.merged} 条合并，${fusion.contradictions} 处矛盾，${fusion.associations} 条关联`,
            timestamp: Date.now(),
          }]);
        }
        setActiveTaskCount(c => Math.max(0, c - 1));
        break;
      }

      // ==================== Phase 5: 认知可视化 ====================
      case 'dream_complete':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: event.journal
            ? `💭 梦境总结：${event.journal}`
            : `💭 梦境巩固完成`,
          timestamp: Date.now(),
        }]);
        // 收集梦境日志
        if (event.journal) {
          setDreamLogs(prev => [{
            journal: event.journal,
            timestamp: event.timestamp || Date.now(),
          }, ...prev].slice(0, 50));
        }
        break;

      // ==================== 批量梦境日志 ====================
      case 'dream_logs':
        if (Array.isArray(event.logs)) {
          setDreamLogs(event.logs as { journal: string; timestamp: number }[]);
        }
        break;

      // ==================== 调度事件 ====================
      case 'schedule_event':
        if (event.data) {
          setScheduleEvents(prev => [event.data, ...prev].slice(0, 100));
        }
        break;

      case 'cognitive_update':
        setBuddyState(prev => prev ? {
          ...prev,
          cognitive: event.profile as any,
        } : null);
        break;

      case 'experience_matched':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: `🧠 经验匹配: ${event.unitName} (${((event.confidence || 0) * 100).toFixed(0)}%)`,
          timestamp: Date.now(),
        }]);
        break;

      case 'domain_mature':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: `🎯 领域「${event.domain}」已成熟！(${event.knowledgeCount} 条知识)`,
          timestamp: Date.now(),
        }]);
        break;

      case 'skill_registered':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: `🔧 新工具已加载: ${event.name} — ${event.description}`,
          timestamp: Date.now(),
        }]);
        setRegisteredSkills(prev => {
          if (prev.some(s => s.name === event.name)) return prev;
          return [...prev, { name: event.name ?? '', description: event.description ?? '', version: '' }];
        });
        break;

      // ==================== 三进制专家模型 ====================
      case 'ternary_models':
        if (Array.isArray(event.models)) {
          setTernaryExperts(event.models as ExpertModel[]);
        }
        break;

      case 'ternary_train_start':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: `🔬 开始训练三进制专家：「${event.domain}」(${event.steps || '?'} 步)`,
          timestamp: Date.now(),
        }]);
        setTrainProgress(prev => ({ ...prev, [event.domain]: { step: 0, total: event.steps || 0, loss: 0 } }));
        break;

      case 'ternary_train_progress':
        setTrainProgress(prev => ({
          ...prev,
          [event.domain]: { step: event.step || 0, total: event.totalSteps || prev[event.domain]?.total || 0, loss: event.loss || 0 },
        }));
        break;

      case 'ternary_train_complete':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: event.success
            ? `🏆 三进制专家「${event.domain}」训练完成！Loss: ${event.initialLoss?.toFixed(4) ?? '?'} → ${event.finalLoss?.toFixed(4) ?? '?'} (${event.steps} 步)`
            : `❌ 三进制专家「${event.domain}」训练失败`,
          timestamp: Date.now(),
        }]);
        setTrainProgress(prev => {
          const next = { ...prev };
          delete next[event.domain];
          return next;
        });
        break;

      case 'ternary_inference':
        if (event.domain) {
          setMessages(prev => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].role === 'assistant') {
                updated[i] = { ...updated[i], ternarySource: { domain: event.domain, confidence: event.confidence || 0 } };
                break;
              }
            }
            return updated;
          });
        }
        break;

      case 'model_installed':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: `📦 模型安装${event.success ? '成功' : '失败'}：「${event.domain}」`,
          timestamp: Date.now(),
        }]);
        break;

      // ==================== Sprint 2: 工具面板 & 记忆面板 & Agent 轨迹 ====================
      case 'tool_panel_data':
        if (event.data) setToolPanelData(event.data as ToolPanelData);
        break;

      case 'memory_panel_data':
        if (event.data) setMemoryPanelData(event.data as MemoryPanelData);
        break;

      case 'knowledge_panel_data':
        if (event.data) setKnowledgePanelData(event.data as KnowledgePanelData);
        break;

      case 'perception_event':
        setPerceptionEvents(prev => {
          const newEvent: PerceptionEvent = {
            id: event.id as string,
            category: event.category as string,
            source: event.source as string,
            data: event.data,
            timestamp: event.timestamp as number,
          };
          const next = [...prev, newEvent];
          return next.length > 200 ? next.slice(-200) : next;
        });
        break;

      case 'agent_trace':
        if (Array.isArray(event.trace)) setAgentTrace(event.trace as AgentTraceStep[]);
        break;

      case 'model_decision':
        // 将模型决策追加到 agent trace
        setAgentTrace(prev => [...prev, {
          type: 'model_decision' as const,
          content: `🧠 ${event.displayName ?? event.modelId} — ${event.reason ?? ''}`,
          modelId: event.modelId,
          displayName: event.displayName,
          tier: event.tier,
          reason: event.reason,
          layer: event.layer,
          candidateCount: event.candidateCount,
          taskType: event.taskType,
          timestamp: event.timestamp ?? Date.now(),
        }]);
        break;

      case 'brain_trace':
        // 将三脑决策信号追加到 agent trace
        setAgentTrace(prev => [...prev, {
          type: 'brain_trace' as const,
          content: `⚡ [${event.phase}] ${JSON.stringify(event.data ?? {}).slice(0, 200)}`,
          phase: event.phase,
          traceId: event.traceId,
          data: event.data,
          timestamp: event.timestamp ?? Date.now(),
        }]);
        break;

      // ==================== 配置同步 ====================
      case 'config_mismatch':
        // BuddyLink 检测到配置不一致，通知用户
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: `⚙️ 配置同步中...`,
          timestamp: Date.now(),
        }]);
        break;

      // ==================== 传感器数据（节流 500ms） ====================
      case 'sensor_update':
        if (event.data) {
          setSensorDataThrottled(event.data);
        }
        break;

      // ==================== 内心独白（叙事引擎） ====================
      case 'narration':
        setNarration({
          content: (event as Record<string, unknown>).content as string,
          type: (event as Record<string, unknown>).type as string,
          timestamp: (event as Record<string, unknown>).timestamp as number,
        });
        // 8 秒后自动消失
        setTimeout(() => setNarration(null), 8000);
        break;

      // ==================== Phase 5: 诊断事件 ====================
      case 'diagnostic': {
        const diag = (event as Record<string, unknown>).data as Record<string, unknown>;
        if (diag) {
          const category = diag.category as string;
          const message = diag.message as string;
          const mood = diag.mood as string;
          const emoji = mood === 'frustrated' ? '😤' : mood === 'tired' ? '😫' : '😕';
          setMessages(prev => [...prev, {
            id: nextId(),
            role: 'diagnostic',
            content: `${emoji} ${message}`,
            timestamp: Date.now(),
            diagnostic: diag as any,
          }]);
          setSprite('error');
          setTimeout(() => setSprite('idle'), 3000);
        }
        break;
      }

      case 'redecide':
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'system',
          content: `🔄 正在换一种方式尝试...${(event as Record<string, unknown>).reflection ? `（${(event as Record<string, unknown>).reflection}）` : ''}`,
          timestamp: Date.now(),
        }]);
        break;
    }
  }, [setSprite]);

  // ==================== 多标签页共享 ====================

  useEffect(() => {
    const shared = sharedRef.current;
    shared.onRoleChange((role) => {
      setSharedRole(role);
      if (role === 'master') {
        console.log('[SharedConnection] 本标签页为主节点，建立 WS 连接');
      } else if (role === 'slave') {
        console.log('[SharedConnection] 本标签页为从节点，通过主节点收发');
      }
    });
    // 从节点收到主节点转发的 WS 消息
    shared.onMessage((msg) => {
      try {
        handleMessage(msg as BuddyEvent);
      } catch { /* ignore */ }
    });
    shared.init();
    return () => { shared.destroy(); };
  }, []);

  // ==================== 连接管理 ====================

  // 防止 React StrictMode 双重执行导致重复连接
  const connectGuardRef = useRef(false);

  useEffect(() => {
    if (!url) return;
    if (url.includes('token=undefined') || url.includes('token=null')) return;
    // StrictMode 保护：跳过第二次执行
    if (connectGuardRef.current) return;
    connectGuardRef.current = true;

    // 从节点不建立 WS 连接，通过 SharedConnection 收发
    const shared = sharedRef.current;
    if (shared.currentRole === 'slave') {
      console.log('[SharedConnection] 从节点跳过 WS 连接');
      return;
    }

    const link = linkRef.current;

    // Token 自动刷新 — 连接失败时自动获取新 token
    link.setTokenRefresher(async () => {
      const res = await fetch('/api/ws-token');
      if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
      const data = await res.json();
      return data.token as string;
    });

    // 注册管道层
    // 指标层：记录每条消息的延迟
    link.use('metrics', async (ctx, next) => {
      const start = performance.now();
      const result = await next();
      const elapsed = performance.now() - start;
      if (ctx.type === 'send' && elapsed > 100) {
        console.warn(`[Pipeline] send 慢消息: ${ctx.stage} ${elapsed.toFixed(1)}ms`);
      }
      return result;
    });

    // 优先级层：低优先级消息在连接非 live 时跳过
    link.use('priority-guard', async (ctx, next) => {
      if (ctx.type === 'send' && ctx.priority !== undefined && ctx.priority < Priority.NORMAL) {
        const state = link.currentState;
        if (state.tag === 'degraded' || state.tag === 'offline') {
          ctx.skip = true; // 低优先级消息在弱网/离线时跳过
          return;
        }
      }
      return next();
    });

    // 注册消息监听（主节点收到后同时转发给从节点）
    link.onMessage((msg) => {
      handleMessage(msg as BuddyEvent);
      // 主节点广播给从节点
      if (sharedRef.current.isMaster) {
        sharedRef.current.broadcastToSlaves(msg);
      }
    });

    // 连接
    link.connect(url);

    // 断连恢复：监听状态变化，连接建立时发送 resume
    let wasConnected = false;
    const unsubResume = link.subscribe(() => {
      const state = link.currentState;
      const isConnected = state.tag === 'live' || state.tag === 'degraded';
      setSocket(link.getSocket());

      // 连接建立后发送 resume（恢复断连期间的消息）
      if (isConnected && !wasConnected) {
        // 重连时清空去重集合，避免旧指纹干扰重放消息
        recentContentRef.current.clear();
        recentMsgIdsRef.current.clear();

        const lastSeq = lastSeqRef.current;
        if (lastSeq > 0 && !hasResumedRef.current) {
          link.send(JSON.stringify({ type: 'resume', lastSeq }), Priority.HIGH);
          hasResumedRef.current = true;
        }
      }
      if (!isConnected) {
        hasResumedRef.current = false;
      }
      wasConnected = isConnected;
    });

    return () => {
      unsubResume();
      link.disconnect();
      connectGuardRef.current = false;
    };
  }, [url]);

  // ==================== 发送方法（对外接口不变） ====================

  // 统一发送：主节点走 BuddyLink，从节点走 SharedConnection
  const sendRaw = useCallback((payload: string, priority: number = Priority.NORMAL) => {
    const shared = sharedRef.current;
    if (shared.currentRole === 'slave') {
      shared.send(payload);
    } else {
      linkRef.current?.send(payload, priority);
    }
  }, []);

  const send = useCallback((content: string) => {
    // 分配任务 ID
    const taskId = `task-${++taskCounterRef.current}`;
    currentTaskIdRef.current = taskId;
    setActiveTaskCount(c => c + 1);

    // /orch 前缀路由到编排引擎
    if (content.startsWith('/orch ')) {
      const orchContent = content.slice(6).trim();
      if (orchContent) {
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'user',
          content,
          timestamp: Date.now(),
          taskId,
        }]);
        sendRaw(JSON.stringify({ type: 'orchestrate', content: orchContent }), Priority.HIGH);
        setSprite('thinking');
        return;
      }
    }

    // 斜杠命令路由到 command 类型
    const slashMatch = content.match(/^\/([a-zA-Z]+)(?:\s+(.*))?$/);
    if (slashMatch) {
      const cmd = slashMatch[1];
      const args = slashMatch[2]?.trim();
      setMessages(prev => [...prev, {
        id: nextId(),
        role: 'user',
        content,
        timestamp: Date.now(),
        taskId,
      }]);
      sendRaw(JSON.stringify({ type: 'command', command: cmd, args }), Priority.HIGH);
      setSprite('thinking');
      return;
    }

    setMessages(prev => [...prev, {
      id: nextId(),
      role: 'user',
      content,
      timestamp: Date.now(),
      taskId,
    }]);

    setSprite('thinking');
    sendRaw(JSON.stringify({ type: 'chat', content }), Priority.HIGH);
  }, [setSprite, sendRaw]);

  const sendPet = useCallback(() => {
    sendRaw(JSON.stringify({ type: 'pet' }), Priority.NORMAL);
  }, [sendRaw]);

  const sendCommand = useCallback((cmd: string, args?: string) => {
    sendRaw(JSON.stringify({ type: 'command', command: cmd, args }), Priority.NORMAL);
  }, [sendRaw]);

  const sendToolConfirm = useCallback((allowed: boolean, confirmId?: string) => {
    sendRaw(JSON.stringify({ type: 'tool_confirm_response', confirmId, allowed }), Priority.CRITICAL);
  }, [sendRaw]);

  const sendVisualSeed = useCallback((seed: VisualSeed) => {
    sendRaw(JSON.stringify({ type: 'visual_seed', ...seed }), Priority.NORMAL);
  }, [sendRaw]);

  const sendOrchestrate = useCallback((content: string) => {
    sendRaw(JSON.stringify({ type: 'orchestrate', content }), Priority.HIGH);
  }, [sendRaw]);

  const requestToolPanel = useCallback(() => {
    sendRaw(JSON.stringify({ type: 'tool_panel_request' }), Priority.NORMAL);
  }, []);

  const requestMemoryPanel = useCallback(() => {
    sendRaw(JSON.stringify({ type: 'memory_panel_request' }), Priority.NORMAL);
  }, [sendRaw]);

  const requestKnowledgePanel = useCallback(() => {
    sendRaw(JSON.stringify({ type: 'knowledge_panel_request' }), Priority.NORMAL);
  }, [sendRaw]);

  const clearMessages = useCallback(() => setMessages([]), []);
  const clearAgentTrace = useCallback(() => setAgentTrace([]), []);

  /** @deprecated 多专家已改为自动路由，此方法仅保留用于开发者调试 */
  const sendMultiExpert = useCallback((content: string) => {
    const taskId = `mep-${++taskCounterRef.current}`;
    currentTaskIdRef.current = taskId;
    setActiveTaskCount(c => c + 1);
    setMultiExpertResults([]);
    setMultiExpertFusion(null);
    setMessages(prev => [...prev, {
      id: nextId(),
      role: 'user',
      content: `🎯 ${content}`,
      timestamp: Date.now(),
      taskId,
    }]);
    sendRaw(JSON.stringify({ type: 'multi_expert', content }), Priority.HIGH);
    setSprite('thinking');
  }, [setSprite, sendRaw]);

  return {
    connected,
    messages,
    spriteState,
    buddyState,
    ternaryExperts,
    trainProgress,
    toolPanelData,
    memoryPanelData,
    knowledgePanelData,
    perceptionEvents,
    agentTrace,
    dreamLogs,
    registeredSkills,
    scheduleEvents,
    sensorData,
    ws: socket,
    send,
    sendPet,
    sendCommand,
    sendToolConfirm,
    sendVisualSeed,
    sendOrchestrate,
    requestToolPanel,
    requestMemoryPanel,
    requestKnowledgePanel,
    clearMessages,
    clearAgentTrace,
    activeTaskCount,
    maxConcurrent,
    actionMeta,
    narration,
    multiExpertResults,
    multiExpertFusion,
    sendMultiExpert,
  };
}
