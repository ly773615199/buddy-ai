/**
 * shop/publish-sanitizer.ts 测试
 * 覆盖：PublishSanitizer.sanitize、scan、formatReport、sanitizeForPublish、scanForPII
 */
import { describe, it, expect } from 'vitest';
import { PublishSanitizer, sanitizeForPublish, scanForPII, type PublishPackage } from './publish-sanitizer.js';

// ==================== 测试数据 ====================

function cleanPackage(): PublishPackage {
  return {
    name: 'test-skill',
    version: '1.0.0',
    domain: 'coding',
    description: '一个测试技能',
    author: 'tester',
    skills: [{
      id: 's1',
      name: 'hello',
      code: 'console.log("hello")',
      description: '打招呼',
    }],
    experiences: [{
      id: 'exp1',
      domain: 'coding',
      trigger: '用户要求写代码',
      steps: ['分析需求', '编写代码', '测试'],
      replyTemplate: { zh: '好的，我来帮你写代码', en: 'Sure, let me write code' },
    }],
    knowledge: [{
      domain: 'coding',
      concepts: ['TypeScript', 'Node.js'],
      content: 'TypeScript 是 JavaScript 的超集',
    }],
  };
}

function dirtyPackage(): PublishPackage {
  return {
    name: 'dirty-skill',
    version: '1.0.0',
    domain: 'coding',
    description: '联系 test@example.com 获取帮助',
    author: 'tester',
    skills: [{
      id: 's1',
      name: 'hello',
      code: 'const key = "sk-' + 'a'.repeat(30) + '"; fetch("http://192.168.1.100/api")',
      description: '访问 /home/user/project/main.ts',
    }],
    experiences: [{
      id: 'exp1',
      domain: 'coding',
      trigger: '用户要求',
      steps: ['手机号 13812345678 联系管理员'],
      replyTemplate: { zh: '发送到 admin@company.com' },
    }],
    knowledge: [{
      domain: 'coding',
      concepts: ['test'],
      content: '服务器 IP 10.0.0.1，端口 8080',
    }],
    frames: [
      { id: 'f1', data: 'base64data1', hasFace: true },
      { id: 'f2', data: 'base64data2', hasFace: false },
      { id: 'f3', data: 'base64data3', hasFace: true },
    ],
  };
}

// ==================== sanitize ====================

describe('PublishSanitizer.sanitize', () => {
  it('干净包不变', async () => {
    const sanitizer = new PublishSanitizer();
    const pkg = cleanPackage();
    const result = await sanitizer.sanitize(pkg);
    expect(result.hasPII).toBe(false);
    expect(result.sanitized.description).toBe(pkg.description);
    expect(result.report.textReplacements).toHaveLength(0);
  });

  it('脱敏描述中的邮箱', async () => {
    const sanitizer = new PublishSanitizer();
    const pkg = dirtyPackage();
    const result = await sanitizer.sanitize(pkg);
    expect(result.hasPII).toBe(true);
    expect(result.sanitized.description).toContain('[EMAIL]');
    expect(result.sanitized.description).not.toContain('test@example.com');
  });

  it('脱敏技能代码中的 Token 和 IP', async () => {
    const sanitizer = new PublishSanitizer();
    const pkg = dirtyPackage();
    const result = await sanitizer.sanitize(pkg);
    const code = result.sanitized.skills![0].code;
    expect(code).toContain('[TOKEN]');
    expect(code).not.toContain('sk-' + 'a'.repeat(30));
  });

  it('脱敏技能描述中的路径', async () => {
    const sanitizer = new PublishSanitizer();
    const pkg = dirtyPackage();
    const result = await sanitizer.sanitize(pkg);
    const desc = result.sanitized.skills![0].description;
    expect(desc).toContain('[PATH]');
    expect(desc).not.toContain('/home/user/project/main.ts');
  });

  it('脱敏经验步骤中的手机号', async () => {
    const sanitizer = new PublishSanitizer();
    const pkg = dirtyPackage();
    const result = await sanitizer.sanitize(pkg);
    const step = result.sanitized.experiences![0].steps[0];
    expect(step).toContain('[PHONE]');
    expect(step).not.toContain('13812345678');
  });

  it('脱敏回复模板中的邮箱', async () => {
    const sanitizer = new PublishSanitizer();
    const pkg = dirtyPackage();
    const result = await sanitizer.sanitize(pkg);
    const reply = result.sanitized.experiences![0].replyTemplate.zh;
    expect(reply).toContain('[EMAIL]');
    expect(reply).not.toContain('admin@company.com');
  });

  it('脱敏知识内容中的 IP', async () => {
    const sanitizer = new PublishSanitizer();
    const pkg = dirtyPackage();
    const result = await sanitizer.sanitize(pkg);
    const content = result.sanitized.knowledge![0].content;
    expect(content).toContain('[IP]');
    expect(content).not.toContain('10.0.0.1');
  });

  it('丢弃含人脸的帧', async () => {
    const sanitizer = new PublishSanitizer();
    const pkg = dirtyPackage();
    const result = await sanitizer.sanitize(pkg);
    expect(result.sanitized.frames).toHaveLength(1);
    expect(result.sanitized.frames![0].id).toBe('f2');
    expect(result.report.discardedFrames).toBe(2);
    expect(result.report.retainedFrames).toBe(1);
  });

  it('报告包含警告', async () => {
    const sanitizer = new PublishSanitizer();
    const pkg = dirtyPackage();
    const result = await sanitizer.sanitize(pkg);
    expect(result.report.warnings.length).toBeGreaterThan(0);
    expect(result.report.warnings[0]).toContain('人脸');
  });

  it('脱敏模型配置中的敏感字段', async () => {
    const sanitizer = new PublishSanitizer();
    const pkg: PublishPackage = {
      ...cleanPackage(),
      model: {
        format: 'lora',
        data: 'base64...',
        config: { apiKey: 'secret123', token: 'tok456', normal: 'keep' },
      },
    };
    const result = await sanitizer.sanitize(pkg);
    expect(result.sanitized.model!.config!.apiKey).toBe('[REDACTED]');
    expect(result.sanitized.model!.config!.token).toBe('[REDACTED]');
    expect(result.sanitized.model!.config!.normal).toBe('keep');
  });
});

// ==================== scan ====================

describe('PublishSanitizer.scan', () => {
  it('干净包无发现', () => {
    const sanitizer = new PublishSanitizer();
    const findings = sanitizer.scan(cleanPackage());
    expect(findings).toHaveLength(0);
  });

  it('发现描述中的 PII', () => {
    const sanitizer = new PublishSanitizer();
    const findings = sanitizer.scan(dirtyPackage());
    const descFinding = findings.find(f => f.location === 'description');
    expect(descFinding).toBeDefined();
  });

  it('发现技能代码中的 PII', () => {
    const sanitizer = new PublishSanitizer();
    const findings = sanitizer.scan(dirtyPackage());
    const skillFinding = findings.find(f => f.location.includes('skills[s1]'));
    expect(skillFinding).toBeDefined();
  });

  it('发现含人脸的帧', () => {
    const sanitizer = new PublishSanitizer();
    const findings = sanitizer.scan(dirtyPackage());
    const faceFinding = findings.find(f => f.type === 'face_detected');
    expect(faceFinding).toBeDefined();
    expect(faceFinding!.location).toContain('2');
  });
});

// ==================== formatReport ====================

describe('formatReport', () => {
  it('干净包报告显示无 PII', async () => {
    const sanitizer = new PublishSanitizer();
    const result = await sanitizer.sanitize(cleanPackage());
    const report = sanitizer.formatReport(result);
    expect(report).toContain('未发现 PII');
  });

  it('脏包报告包含脱敏详情', async () => {
    const sanitizer = new PublishSanitizer();
    const result = await sanitizer.sanitize(dirtyPackage());
    const report = sanitizer.formatReport(result);
    expect(report).toContain('发布脱敏报告');
    expect(report).toContain('图像帧处理');
    expect(report).toContain('丢弃');
  });
});

// ==================== 便捷函数 ====================

describe('便捷函数', () => {
  it('sanitizeForPublish 工作正常', async () => {
    const result = await sanitizeForPublish(cleanPackage());
    expect(result.hasPII).toBe(false);
  });

  it('scanForPII 工作正常', () => {
    const findings = scanForPII(dirtyPackage());
    expect(findings.length).toBeGreaterThan(0);
  });
});
