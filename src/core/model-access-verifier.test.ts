/**
 * ModelAccessVerifier 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  classifyHttpError,
  classifyProbeError,
  type ModelAccessStatus,
  type ModelAccessErrorType,
} from './model-access-verifier.js';

describe('ModelAccessVerifier', () => {
  describe('classifyHttpError', () => {
    it('401 → auth (endpoint scope)', () => {
      const r = classifyHttpError(401);
      expect(r.scope).toBe('endpoint');
      expect(r.type).toBe('auth');
    });

    it('403 → permission (model scope)', () => {
      const r = classifyHttpError(403);
      expect(r.scope).toBe('model');
      expect(r.type).toBe('permission');
    });

    it('402 → payment (model scope)', () => {
      const r = classifyHttpError(402);
      expect(r.scope).toBe('model');
      expect(r.type).toBe('payment');
    });

    it('404 → not_found (model scope)', () => {
      const r = classifyHttpError(404);
      expect(r.scope).toBe('model');
      expect(r.type).toBe('not_found');
    });

    it('429 → rate_limited (model scope)', () => {
      const r = classifyHttpError(429);
      expect(r.scope).toBe('model');
      expect(r.type).toBe('rate_limited');
    });

    it('500 → network (model scope)', () => {
      const r = classifyHttpError(500);
      expect(r.scope).toBe('model');
      expect(r.type).toBe('network');
    });

    it('400 → unknown (model scope)', () => {
      const r = classifyHttpError(400, 'Bad request');
      expect(r.scope).toBe('model');
      expect(r.type).toBe('unknown');
      expect(r.message).toContain('Bad request');
    });
  });

  describe('classifyProbeError', () => {
    it('ECONNREFUSED → network', () => {
      const r = classifyProbeError(new Error('connect ECONNREFUSED 127.0.0.1:11434'));
      expect(r.type).toBe('network');
      expect(r.scope).toBe('endpoint');
    });

    it('timeout → timeout', () => {
      const r = classifyProbeError(new Error('The operation was aborted due to timeout'));
      expect(r.type).toBe('timeout');
    });

    it('401 → auth', () => {
      const r = classifyProbeError(new Error('HTTP 401: Unauthorized'));
      expect(r.type).toBe('auth');
      expect(r.scope).toBe('endpoint');
    });

    it('403 → permission', () => {
      const r = classifyProbeError(new Error('HTTP 403: Forbidden'));
      expect(r.type).toBe('permission');
    });

    it('402 → payment', () => {
      const r = classifyProbeError(new Error('Insufficient balance'));
      expect(r.type).toBe('payment');
    });

    it('not found → not_found', () => {
      const r = classifyProbeError(new Error('Model does not exist'));
      expect(r.type).toBe('not_found');
    });

    it('rate limit → rate_limited', () => {
      const r = classifyProbeError(new Error('Rate limit exceeded'));
      expect(r.type).toBe('rate_limited');
    });

    it('unknown error → unknown', () => {
      const r = classifyProbeError(new Error('Something weird happened'));
      expect(r.type).toBe('unknown');
    });
  });
});
