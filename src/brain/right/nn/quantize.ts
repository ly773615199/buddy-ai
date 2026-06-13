/**
 * int8 量化 / 反量化
 *
 * 将 Float32 权重量化为 int8，减少 4 倍内存
 * 推理时反量化回 float
 */

import { Tensor, zeros } from './tensor.js';

export interface QuantizedData {
  data: Int8Array;
  scale: Float32Array;
  zeroPoint: Float32Array;
  shape: number[];
}

/** 对称量化：每行独立量化 */
export function quantizeInt8(tensor: Tensor): QuantizedData {
  const { data, shape } = tensor;
  const size = tensor.size;

  // 按行量化（最后一维作为量化单元）
  const lastDim = shape[shape.length - 1];
  const numRows = size / lastDim;

  const qData = new Int8Array(size);
  const scales = new Float32Array(numRows);
  const zeroPoints = new Float32Array(numRows);

  for (let row = 0; row < numRows; row++) {
    const off = row * lastDim;
    let maxAbs = 0;
    for (let i = 0; i < lastDim; i++) {
      const abs = Math.abs(data[off + i]);
      if (abs > maxAbs) maxAbs = abs;
    }

    const scale = maxAbs > 0 ? maxAbs / 127 : 1;
    scales[row] = scale;
    zeroPoints[row] = 0;

    for (let i = 0; i < lastDim; i++) {
      const q = Math.round(data[off + i] / scale);
      qData[off + i] = Math.max(-128, Math.min(127, q));
    }
  }

  return { data: qData, scale: scales, zeroPoint: zeroPoints, shape: [...shape] };
}

/** 反量化：int8 → float32 */
export function dequantizeInt8(q: QuantizedData): Tensor {
  const { data, scale, shape } = q;
  const lastDim = shape[shape.length - 1];
  const numRows = data.length / lastDim;
  const out = new Float32Array(data.length);

  for (let row = 0; row < numRows; row++) {
    const off = row * lastDim;
    const s = scale[row];
    for (let i = 0; i < lastDim; i++) {
      out[off + i] = data[off + i] * s;
    }
  }

  return new Tensor(out, shape);
}
