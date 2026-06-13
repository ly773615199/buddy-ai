/**
 * 权重序列化 / 反序列化 — .bin 格式
 *
 * 格式：[magic(4B) | version(4B) | numTensors(4B) | tensor entries...]
 * 每个 entry：[nameLen(4B) | name(padded 4B) | rank(4B) | shape(rank×4B) | data]
 */

import { Tensor } from './tensor.js';
import type { IntuitionNet } from './model.js';
import { quantizeInt8 } from './quantize.js';
import { writeFileSync, readFileSync } from 'fs';

const MAGIC = 0x42554459; // "BUDY"
const VERSION = 1;

/** 计算 4 字节对齐后的长度 */
function align4(n: number): number {
  return Math.ceil(n / 4) * 4;
}

/**
 * 保存模型权重到文件（float32）
 */
export function saveModel(model: IntuitionNet, path: string): void {
  const params = model.parameters();
  const names = generateNames(model);

  // 计算总大小（含 padding）
  let totalBytes = 12;
  const entries: Array<{ name: string; tensor: Tensor }> = [];
  for (let i = 0; i < params.length; i++) {
    const name = names[i] || `param_${i}`;
    entries.push({ name, tensor: params[i] });
    totalBytes += 4 + align4(name.length) + 4 + params[i].shape.length * 4 + params[i].size * 4 + 4;
  }

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  let offset = 0;

  view.setUint32(offset, MAGIC, true); offset += 4;
  view.setUint32(offset, VERSION, true); offset += 4;
  view.setUint32(offset, entries.length, true); offset += 4;

  for (const { name, tensor } of entries) {
    // name length
    view.setUint32(offset, name.length, true); offset += 4;
    // name bytes
    for (let i = 0; i < name.length; i++) {
      view.setUint8(offset++, name.charCodeAt(i));
    }
    // pad to 4-byte alignment
    while (offset % 4 !== 0) { view.setUint8(offset++, 0); }
    // shape
    view.setUint32(offset, tensor.shape.length, true); offset += 4;
    for (const d of tensor.shape) {
      view.setUint32(offset, d, true); offset += 4;
    }
    // data (float32)
    const floatView = new Float32Array(buffer, offset, tensor.size);
    floatView.set(tensor.data);
    offset += tensor.size * 4;
  }

  writeFileSync(path, Buffer.from(buffer));
}

/**
 * 保存量化模型（int8）
 */
export function saveModelQuantized(model: IntuitionNet, path: string): void {
  const params = model.parameters();
  const names = generateNames(model);
  const quantized = params.map(t => quantizeInt8(t));

  // 预估总大小（含所有 padding）
  let totalBytes = 12;
  for (let i = 0; i < params.length; i++) {
    const q = quantized[i];
    const name = names[i] || `param_${i}`;
    // name header + padded name + shape header + shape data + int8 data + padding + scales
    totalBytes += 4 + align4(name.length) + 4 + q.shape.length * 4 + q.data.length + 4 + q.scale.length * 4;
  }

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  let offset = 0;

  view.setUint32(offset, MAGIC, true); offset += 4;
  view.setUint32(offset, VERSION + 100, true); offset += 4; // 101 = quantized
  view.setUint32(offset, params.length, true); offset += 4;

  for (let i = 0; i < params.length; i++) {
    const q = quantized[i];
    const name = names[i] || `param_${i}`;
    view.setUint32(offset, name.length, true); offset += 4;
    for (let c = 0; c < name.length; c++) {
      view.setUint8(offset++, name.charCodeAt(c));
    }
    while (offset % 4 !== 0) { view.setUint8(offset++, 0); }
    view.setUint32(offset, q.shape.length, true); offset += 4;
    for (const d of q.shape) {
      view.setUint32(offset, d, true); offset += 4;
    }
    // int8 data
    const int8View = new Int8Array(buffer, offset, q.data.length);
    int8View.set(q.data);
    offset += q.data.length;
    // scales (float32, already 4-byte aligned since int8 data might not be)
    // pad offset to 4-byte alignment before scales
    while (offset % 4 !== 0) { view.setUint8(offset++, 0); }
    const floatView = new Float32Array(buffer, offset, q.scale.length);
    floatView.set(q.scale);
    offset += q.scale.length * 4;
  }

  writeFileSync(path, Buffer.from(buffer).subarray(0, offset));
}

/**
 * 加载模型权重
 */
export function loadModel(model: IntuitionNet, path: string): void {
  const buffer = readFileSync(path);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;

  const magic = view.getUint32(offset, true); offset += 4;
  if (magic !== MAGIC) throw new Error(`Invalid model file: magic=${magic.toString(16)}`);
  const version = view.getUint32(offset, true); offset += 4;
  const numTensors = view.getUint32(offset, true); offset += 4;

  const isQuantized = version >= 100;
  const params = model.parameters();

  for (let i = 0; i < numTensors; i++) {
    const nameLen = view.getUint32(offset, true); offset += 4;
    // skip name bytes + padding
    offset += align4(nameLen);

    const rank = view.getUint32(offset, true); offset += 4;
    const shape: number[] = [];
    for (let r = 0; r < rank; r++) {
      shape.push(view.getUint32(offset, true)); offset += 4;
    }

    if (i >= params.length) break;
    const param = params[i];

    if (isQuantized) {
      const size = shape.reduce((a, b) => a * b, 1);
      const lastDim = shape[shape.length - 1];
      const numRows = size / lastDim;

      const int8Data = new Int8Array(buffer.buffer, buffer.byteOffset + offset, size);
      offset += size;
      // pad to 4-byte alignment
      while (offset % 4 !== 0) offset++;
      const scales = new Float32Array(buffer.buffer, buffer.byteOffset + offset, numRows);
      offset += numRows * 4;

      const out = new Float32Array(size);
      for (let row = 0; row < numRows; row++) {
        const off = row * lastDim;
        for (let d = 0; d < lastDim; d++) {
          out[off + d] = int8Data[off + d] * scales[row];
        }
      }
      param.data.set(out);
    } else {
      const size = shape.reduce((a, b) => a * b, 1);
      const floatData = new Float32Array(buffer.buffer, buffer.byteOffset + offset, size);
      param.data.set(floatData);
      offset += size * 4;
    }
  }
}

/** 生成参数名称 */
function generateNames(model: IntuitionNet): string[] {
  const names: string[] = [];
  names.push('embedding.weight');
  for (let i = 0; i < model.encoderBlocks.length; i++) {
    const block = model.encoderBlocks[i];
    names.push(
      `enc.${i}.attn.wq`, `enc.${i}.attn.wk`, `enc.${i}.attn.wv`, `enc.${i}.attn.wo`,
      `enc.${i}.attn.bq`, `enc.${i}.attn.bk`, `enc.${i}.attn.bv`, `enc.${i}.attn.bo`,
      `enc.${i}.attn.ln_w`, `enc.${i}.attn.ln_b`,
    );
    names.push(
      `enc.${i}.ffn.w1`, `enc.${i}.ffn.b1`, `enc.${i}.ffn.w2`, `enc.${i}.ffn.b2`,
      `enc.${i}.ffn.ln_w`, `enc.${i}.ffn.ln_b`,
    );
  }
  for (const prefix of ['intent', 'tool', 'quality']) {
    names.push(`${prefix}.w1`, `${prefix}.b1`, `${prefix}.w2`, `${prefix}.b2`);
  }
  return names;
}
