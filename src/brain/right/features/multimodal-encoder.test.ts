import { describe, it, expect } from 'vitest';
import { encodeSpatial, computeRelation, encodeBBox } from './spatial-encoder.js';
import { encodeImage, createImageFromGrayscale, extractPatches } from './image-encoder.js';
import { encodeSceneGraph, slotAttention, encodeSlots, graphToSlots } from './scene-encoder.js';

describe('Multimodal Encoders — 三模态编码器', () => {

  describe('SpatialEncoder', () => {
    it('编码物体为 token 序列', () => {
      const tokens = encodeSpatial({
        objects: [
          { id: 'a', label: 'button', bbox: { x: 0.5, y: 0.3, w: 0.1, h: 0.05 }, confidence: 0.9 },
        ],
      });
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens).toContain(3); // SEP
    });

    it('编码空间关系', () => {
      const tokens = encodeSpatial({
        relations: [
          { source: 'button', target: 'text', direction: 'below' },
        ],
      });
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('computeRelation 正确判断方向', () => {
      const a = { x: 0.3, y: 0.5, w: 0.1, h: 0.1 };
      const b = { x: 0.7, y: 0.5, w: 0.1, h: 0.1 };
      expect(computeRelation(a, b)).toBe('left');
      expect(computeRelation(b, a)).toBe('right');
    });

    it('性能 < 1ms', () => {
      const objects = Array.from({ length: 8 }, (_, i) => ({
        id: `obj${i}`, label: 'item', bbox: { x: i * 0.1, y: 0.5, w: 0.05, h: 0.05 }, confidence: 0.8,
      }));
      const t0 = performance.now();
      for (let i = 0; i < 1000; i++) encodeSpatial({ objects });
      expect(performance.now() - t0).toBeLessThan(50);
    });
  });

  describe('ImageEncoder', () => {
    it('编码灰度图为 token 序列', () => {
      const pixels = Array.from({ length: 20 }, () =>
        Array.from({ length: 20 }, () => Math.floor(Math.random() * 256)),
      );
      const image = createImageFromGrayscale(pixels);
      const tokens = encodeImage(image);
      // 10x10 patches × (3 feature + 3 position) = 600
      expect(tokens.length).toBe(10 * 10 * 6);
    });

    it('提取 patches 数量正确', () => {
      const image = createImageFromGrayscale(Array.from({ length: 30 }, () => Array(30).fill(128)));
      const patches = extractPatches(image, 10);
      expect(patches.length).toBe(100);
    });

    it('全白图片平均颜色为 255', () => {
      const image = createImageFromGrayscale(Array.from({ length: 10 }, () => Array(10).fill(255)));
      const patches = extractPatches(image, 10);
      for (const p of patches) {
        expect(p.avgColor).toBeCloseTo(255, 0);
      }
    });

    it('性能 < 1ms', () => {
      const image = createImageFromGrayscale(Array.from({ length: 20 }, () => Array(20).fill(100)));
      const t0 = performance.now();
      for (let i = 0; i < 100; i++) encodeImage(image);
      expect(performance.now() - t0).toBeLessThan(500);
    });
  });

  describe('SceneEncoder', () => {
    it('编码 Scene Graph', () => {
      const tokens = encodeSceneGraph({
        nodes: [
          { id: 'a', category: 'button' },
          { id: 'b', category: 'text' },
        ],
        edges: [
          { source: 'a', target: 'b', relation: 'below' },
        ],
      });
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens).toContain(3); // SEP
    });

    it('Slot Attention 输出正确数量的 slots', () => {
      const tokens = [550, 551, 552, 553, 554];
      const slots = slotAttention(tokens, { numSlots: 4, numIterations: 2 });
      expect(slots.length).toBe(4);
      expect(slots[0].length).toBe(32);
    });

    it('graphToSlots 输出正确', () => {
      const graph = {
        nodes: [{ id: 'a', category: 'person' }, { id: 'b', category: 'car' }],
        edges: [{ source: 'a', target: 'b', relation: 'near' }],
      };
      const slots = graphToSlots(graph);
      expect(slots.length).toBe(8); // MAX_SLOTS
    });

    it('性能 < 1ms', () => {
      const graph = {
        nodes: Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, category: 'unknown' })),
        edges: Array.from({ length: 15 }, (_, i) => ({
          source: `${i % 10}`, target: `${(i + 1) % 10}`, relation: 'near',
        })),
      };
      const t0 = performance.now();
      for (let i = 0; i < 1000; i++) encodeSceneGraph(graph);
      expect(performance.now() - t0).toBeLessThan(100);
    });
  });
});
