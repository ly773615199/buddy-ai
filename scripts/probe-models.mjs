#!/usr/bin/env node
/**
 * 批量探测 SiliconFlow 模型的 HuggingFace 元数据
 * 数据源: SiliconFlow API + hf-mirror.com
 */

const SF_KEY = process.env.SF_API_KEY || '';
const HF_BASE = 'https://hf-mirror.com/api/models';
const CONCURRENCY = 5;
const DELAY_MS = 300; // 每批间隔，避免被限流

// SiliconFlow ID → HuggingFace repo 路径的候选列表
function getHFCandidates(sfId) {
  const candidates = [];

  // 原始 ID 直接用
  candidates.push(sfId);

  // 去掉 Pro/ LoRA/ 前缀
  const prefixes = ['Pro/', 'LoRA/'];
  for (const p of prefixes) {
    if (sfId.startsWith(p)) {
      candidates.push(sfId.slice(p.length));
    }
  }

  // 已知的特殊映射
  const KNOWN_MAP = {
    'MiniMaxAI/MiniMax-M2.5': 'MiniMaxAI/MiniMax-M2.5',
    'zai-org/GLM-5.1': 'THUDM/glm-4-9b-chat',       // GLM 系列用 THUDM
    'zai-org/GLM-5': 'THUDM/glm-4-9b-chat',
    'zai-org/GLM-4.7': 'THUDM/glm-4-9b-chat',
    'zai-org/GLM-4.6V': 'THUDM/glm-4v-9b',
    'zai-org/GLM-4.6': 'THUDM/glm-4-9b-chat',
    'zai-org/GLM-4.5V': 'THUDM/glm-4v-9b',
    'zai-org/GLM-4.5-Air': 'THUDM/glm-4-9b-chat',
    'stepfun-ai/Step-3.5-Flash': 'stepfun-ai/step-2-16k',
    'inclusionAI/Ring-flash-2.0': 'inclusionAI/Ring-flash-2.0',
    'inclusionAI/Ling-flash-2.0': 'inclusionAI/Ling-flash-2.0',
    'inclusionAI/Ling-mini-2.0': 'inclusionAI/Ling-mini-2.0',
    'tencent/Hunyuan-MT-7B': 'Tencent/Hunyuan-MT-7B',
    'tencent/Hunyuan-A13B-Instruct': 'Tencent/Hunyuan-A13B-Instruct',
    'ByteDance-Seed/Seed-OSS-36B-Instruct': 'ByteDance-Seed/Seed-OSS-36B-Instruct',
    'TeleAI/TeleSpeechASR': 'TeleAI/TeleSpeechASR',
    'fnlp/MOSS-TTSD-v0.5': 'fnlp/MOSS-TTSD-v0.5',
    'PaddlePaddle/PaddleOCR-VL-1.5': 'PaddlePaddle/PaddleOCR-VL-1.5',
  };

  if (KNOWN_MAP[sfId]) {
    candidates.push(KNOWN_MAP[sfId]);
  }

  // GLM 系列: zai-org → THUDM
  if (sfId.includes('zai-org/GLM')) {
    const modelPart = sfId.split('/').pop();
    candidates.push(`THUDM/${modelPart.toLowerCase()}`);
    candidates.push(`THUDM/${modelPart}`);
  }

  // 去重
  return [...new Set(candidates)];
}

// 延迟
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 带重试的 fetch
async function fetchJSON(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.status === 404) return null;
      if (res.status === 429) {
        await sleep(2000 * (i + 1));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      if (i === retries) return null;
      await sleep(1000);
    }
  }
  return null;
}

// 查询单个模型的 HF 元数据
async function lookupHF(sfId) {
  const candidates = getHFCandidates(sfId);

  for (const hfId of candidates) {
    const data = await fetchJSON(`${HF_BASE}/${hfId}`);
    if (data && data.pipeline_tag) {
      return {
        sfId,
        hfId,
        found: true,
        pipeline_tag: data.pipeline_tag,
        tags: (data.tags || []).slice(0, 15),
        library_name: data.library_name || '',
        model_type: data.config?.model_type || '',
        likes: data.likes || 0,
        downloads: data.downloads || 0,
      };
    }
  }

  return { sfId, hfId: null, found: false };
}

// 分批执行
async function batchRun(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    process.stderr.write(`  进度: ${results.length}/${items.length}\r`);
    if (i + concurrency < items.length) await sleep(DELAY_MS);
  }
  return results;
}

async function main() {
  console.error('📡 正在获取 SiliconFlow 模型列表...');
  const sfRes = await fetchJSON(
    'https://api.siliconflow.cn/v1/models',
    { headers: { Authorization: `Bearer ${SF_KEY}` } }
  );
  // 重新实现带 header 的 fetch
  let sfData;
  try {
    const res = await fetch('https://api.siliconflow.cn/v1/models', {
      headers: { Authorization: `Bearer ${SF_KEY}` },
      signal: AbortSignal.timeout(10000),
    });
    sfData = await res.json();
  } catch (e) {
    console.error('❌ 获取 SiliconFlow 模型失败:', e.message);
    process.exit(1);
  }

  const sfModels = sfData.data.map(m => m.id);
  console.error(`✅ SiliconFlow 模型: ${sfModels.length} 个`);
  console.error(`🔍 开始查询 HuggingFace 元数据 (${CONCURRENCY} 并发)...\n`);

  const results = await batchRun(sfModels, lookupHF, CONCURRENCY);

  // 统计
  const found = results.filter(r => r.found);
  const notFound = results.filter(r => !r.found);

  // 按 pipeline_tag 分组
  const byTag = {};
  for (const r of found) {
    const tag = r.pipeline_tag;
    if (!byTag[tag]) byTag[tag] = [];
    byTag[tag].push(r);
  }

  // 输出结果
  console.log('\n' + '='.repeat(80));
  console.log(`📊 结果汇总`);
  console.log('='.repeat(80));
  console.log(`总模型数: ${sfModels.length}`);
  console.log(`HF 匹配: ${found.length} (${(found.length/sfModels.length*100).toFixed(0)}%)`);
  console.log(`未匹配: ${notFound.length}`);
  console.log('');

  // 按用途分类
  console.log('='.repeat(80));
  console.log('📋 按用途分类 (pipeline_tag)');
  console.log('='.repeat(80));
  for (const [tag, models] of Object.entries(byTag).sort((a,b) => b[1].length - a[1].length)) {
    console.log(`\n🏷️  ${tag} (${models.length} 个):`);
    for (const m of models) {
      const meta = [];
      if (m.model_type) meta.push(`type:${m.model_type}`);
      if (m.tags?.includes('chat') || m.tags?.includes('conversational')) meta.push('✅ chat');
      if (m.tags?.includes('conversational')) meta.push('conversational');
      console.log(`  ${m.sfId} → ${m.hfId}  [${meta.join(', ')}]`);
    }
  }

  if (notFound.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('❌ 未匹配模型');
    console.log('='.repeat(80));
    for (const m of notFound) {
      console.log(`  ${m.sfId}`);
    }
  }

  // 输出完整 JSON 到文件
  const output = {
    timestamp: new Date().toISOString(),
    summary: {
      total: sfModels.length,
      matched: found.length,
      notFound: notFound.length,
      byPipelineTag: Object.fromEntries(
        Object.entries(byTag).map(([k, v]) => [k, v.length])
      ),
    },
    results,
  };

  const fs = await import('fs');
  fs.writeFileSync(
    '/root/.openclaw/workspace/buddy/model-discovery-result.json',
    JSON.stringify(output, null, 2)
  );
  console.log('\n💾 完整结果已保存到 model-discovery-result.json');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
