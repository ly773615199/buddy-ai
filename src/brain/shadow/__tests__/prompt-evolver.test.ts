/**
 * PromptEvolver 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PromptEvolver } from '../phase10/prompt-evolver.js';

describe('PromptEvolver', () => {
  let pe: PromptEvolver;

  beforeEach(() => {
    pe = new PromptEvolver({ minUsageForEvaluation: 2 });
  });

  it('should load default templates', () => {
    const all = pe.getAllTemplates();
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.some(t => t.scope === 'rule_generation')).toBe(true);
    expect(all.some(t => t.scope === 'param_expansion')).toBe(true);
    expect(all.some(t => t.scope === 'struct_change')).toBe(true);
  });

  it('should get best template by scope', () => {
    const best = pe.getBest('rule_generation');
    expect(best).toBeDefined();
    expect(best!.scope).toBe('rule_generation');
  });

  it('should return undefined for unknown scope', () => {
    const best = pe.getBest('unknown' as any);
    expect(best).toBeUndefined();
  });

  it('should record usage and update stats', () => {
    const best = pe.getBest('rule_generation')!;
    pe.recordUsage(best.id, true, 0.8);
    pe.recordUsage(best.id, false, 0.3);

    const updated = pe.getTemplate(best.id)!;
    expect(updated.usageCount).toBe(2);
    expect(updated.successCount).toBe(1);
    expect(updated.acceptanceRate).toBeCloseTo(0.5);
  });

  it('should select best by acceptance rate after enough usage', () => {
    // Add two templates for same scope
    pe.addTemplate({
      id: 'custom-rule-gen',
      name: 'Custom Rule Gen',
      template: 'Custom template',
      scope: 'rule_generation',
      avgProposalQuality: 0,
      acceptanceRate: 0,
      usageCount: 0,
      successCount: 0,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    });

    // Record usage: default gets low acceptance
    const defaultT = pe.getBest('rule_generation')!;
    for (let i = 0; i < 5; i++) {
      pe.recordUsage(defaultT.id, false, 0.3);
    }

    // Custom gets high acceptance
    for (let i = 0; i < 5; i++) {
      pe.recordUsage('custom-rule-gen', true, 0.9);
    }

    const best = pe.getBest('rule_generation');
    expect(best!.id).toBe('custom-rule-gen');
  });

  it('should render template with variables', () => {
    const rendered = pe.render('rule-gen-v1', {
      gapDescription: 'test gap',
      failureCount: 5,
      avgConfidence: '0.2',
      existingRules: '- rule1\n- rule2',
    });

    expect(rendered).toContain('test gap');
    expect(rendered).toContain('5');
    expect(rendered).toContain('0.2');
    expect(rendered).toContain('rule1');
  });

  it('should return empty for unknown template', () => {
    const rendered = pe.render('nonexistent', {});
    expect(rendered).toBe('');
  });

  it('should analyze templates', () => {
    const best = pe.getBest('rule_generation')!;
    for (let i = 0; i < 5; i++) {
      pe.recordUsage(best.id, i < 3, 0.6);
    }

    const analyses = pe.analyze([]);
    expect(analyses.length).toBeGreaterThan(0);
    expect(analyses[0].templateId).toBe(best.id);
  });

  it('should identify templates needing improvement', () => {
    const best = pe.getBest('rule_generation')!;
    // Low acceptance rate
    for (let i = 0; i < 5; i++) {
      pe.recordUsage(best.id, false, 0.2);
    }

    const summary = pe.getSummary();
    expect(summary.needsImprovement.length).toBeGreaterThan(0);
    expect(summary.needsImprovement[0].id).toBe(best.id);
  });

  it('should improve template with LLM', async () => {
    const improvedPe = new PromptEvolver({
      minUsageForEvaluation: 1,
      llm: { call: async () => 'Improved prompt template content' },
    });

    const best = improvedPe.getBest('rule_generation')!;
    improvedPe.recordUsage(best.id, false, 0.2);

    const analyses = improvedPe.analyze([]);
    const improved = await improvedPe.improve(best.id, analyses[0]);
    expect(improved).not.toBeNull();
    expect(improved!.template).toContain('Improved');
    expect(improved!.scope).toBe('rule_generation');
  });

  it('should return null when improving without LLM', async () => {
    const best = pe.getBest('rule_generation')!;
    pe.recordUsage(best.id, false, 0.2);
    const analyses = pe.analyze([]);
    const result = await pe.improve(best.id, analyses[0]);
    expect(result).toBeNull();
  });

  it('should add custom template', () => {
    pe.addTemplate({
      id: 'custom-1',
      name: 'Custom',
      template: 'Custom template',
      scope: 'rule_generation',
      avgProposalQuality: 0,
      acceptanceRate: 0,
      usageCount: 0,
      successCount: 0,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    });

    expect(pe.getTemplate('custom-1')).toBeDefined();
  });

  it('should return correct summary', () => {
    const summary = pe.getSummary();
    expect(summary.totalTemplates).toBeGreaterThanOrEqual(3);
    expect(summary.byScope).toHaveProperty('rule_generation');
  });
});
