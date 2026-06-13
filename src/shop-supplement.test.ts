/**
 * Shop 模块补充测试
 * 覆盖：ModelInstaller、ModelRepository
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ModelInstaller, type InstallerConfig } from './shop/installer.js';
import { ModelRepository, type RepositoryConfig } from './shop/repository.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// ── ModelInstaller 测试 ──

describe('ModelInstaller', () => {
  let installer: ModelInstaller;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `installer-test-${Date.now()}`);
    installer = new ModelInstaller({
      installDir: path.join(tmpDir, 'experts'),
      cacheDir: path.join(tmpDir, 'cache'),
      maxConcurrent: 2,
      verifyChecksum: false,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('默认配置正确', () => {
    const defaultInstaller = new ModelInstaller();
    // 默认使用 ~/.buddy/experts
    expect(defaultInstaller.installedCount).toBe(0);
  });

  it('init 创建目录', async () => {
    await installer.init();
    const expertsDir = path.join(tmpDir, 'experts');
    const cacheDir = path.join(tmpDir, 'cache');
    await expect(fs.access(expertsDir)).resolves.toBeUndefined();
    await expect(fs.access(cacheDir)).resolves.toBeUndefined();
  });

  it('初始状态无已安装模型', async () => {
    await installer.init();
    expect(installer.listInstalled()).toEqual([]);
    expect(installer.installedCount).toBe(0);
  });

  it('getInstalled 不存在返回 null', async () => {
    await installer.init();
    expect(installer.getInstalled('nonexistent')).toBeNull();
  });

  it('isInstalled 不存在返回 false', async () => {
    await installer.init();
    expect(installer.isInstalled('nonexistent')).toBe(false);
  });

  it('setEnabled 不存在的模型返回 false', async () => {
    await installer.init();
    expect(installer.setEnabled('nonexistent', true)).toBe(false);
  });

  it('installFromModel 无 manager 抛异常', async () => {
    await installer.init();
    const fakeModel = {
      weights: new Float32Array([1, 2, 3]),
      meta: {
        domain: 'test',
        version: '1.0.0',
        architecture: 'ternary-v1',
        quantized: false,
        createdAt: Date.now(),
      },
    } as any;

    const result = await installer.installFromModel(fakeModel);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Model manager not set');
  });

  it('uninstall 不存在的模型不崩溃', async () => {
    await installer.init();
    const result = await installer.uninstall('nonexistent');
    // 可能成功（幂等）或失败，但不应崩溃
    expect(typeof result.success).toBe('boolean');
  });
});

// ── ModelRepository 测试 ──

describe('ModelRepository', () => {
  let repo: ModelRepository;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `repo-test-${Date.now()}`);
    repo = new ModelRepository({
      localDir: path.join(tmpDir, 'registry'),
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('init 创建目录和索引', async () => {
    await repo.init();
    const registryDir = path.join(tmpDir, 'registry');
    await expect(fs.access(registryDir)).resolves.toBeUndefined();

    // 索引文件应存在
    const indexContent = await fs.readFile(path.join(registryDir, 'index.json'), 'utf-8');
    const index = JSON.parse(indexContent);
    expect(index.version).toBe('1.0.0');
    expect(index.models).toEqual({});
  });

  it('初始状态 listAll 返回空', async () => {
    await repo.init();
    expect(repo.listAll()).toEqual([]);
  });

  it('初始状态 listLocal 返回空', async () => {
    await repo.init();
    expect(repo.listLocal()).toEqual([]);
  });

  it('register + listAll', async () => {
    await repo.init();
    await repo.register({
      name: 'test-model',
      version: '1.0.0',
      domain: 'testing',
      description: '测试模型',
      author: 'test',
      architecture: 'ternary-v1',
      files: [],
      dependencies: [],
      tags: ['test'],
      minBuddyVersion: '0.1.0',
      license: 'MIT',
      publishedAt: Date.now(),
    });

    const all = repo.listAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('test-model');
    expect(all[0].domain).toBe('testing');
  });

  it('getManifest 本地命中', async () => {
    await repo.init();
    await repo.register({
      name: 'local-model',
      version: '2.0.0',
      domain: 'local',
      description: '本地模型',
      author: 'me',
      architecture: 'ternary-v1',
      files: [],
      dependencies: [],
      tags: [],
      minBuddyVersion: '0.1.0',
      license: 'MIT',
      publishedAt: Date.now(),
    });

    const manifest = await repo.getManifest('local-model');
    expect(manifest).not.toBeNull();
    expect(manifest!.version).toBe('2.0.0');
  });

  it('getManifest 不存在返回 null', async () => {
    await repo.init();
    const manifest = await repo.getManifest('ghost');
    expect(manifest).toBeNull();
  });

  it('search 按名称搜索', async () => {
    await repo.init();
    await repo.register({
      name: 'frontend-expert',
      version: '1.0.0',
      domain: 'frontend',
      description: '前端开发专家',
      author: 'test',
      architecture: 'ternary-v1',
      files: [],
      dependencies: [],
      tags: ['react', 'vue'],
      minBuddyVersion: '0.1.0',
      license: 'MIT',
      publishedAt: Date.now(),
    });
    await repo.register({
      name: 'backend-expert',
      version: '1.0.0',
      domain: 'backend',
      description: '后端开发专家',
      author: 'test',
      architecture: 'ternary-v1',
      files: [],
      dependencies: [],
      tags: ['node', 'python'],
      minBuddyVersion: '0.1.0',
      license: 'MIT',
      publishedAt: Date.now(),
    });

    const results = await repo.search('frontend');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('frontend-expert');
  });

  it('search 按 tag 搜索', async () => {
    await repo.init();
    await repo.register({
      name: 'react-model',
      version: '1.0.0',
      domain: 'frontend',
      description: 'React 专家',
      author: 'test',
      architecture: 'ternary-v1',
      files: [],
      dependencies: [],
      tags: ['react', 'typescript'],
      minBuddyVersion: '0.1.0',
      license: 'MIT',
      publishedAt: Date.now(),
    });

    const results = await repo.search('', { tags: ['react'] });
    expect(results).toHaveLength(1);
  });

  it('search 按 domain 过滤', async () => {
    await repo.init();
    await repo.register({
      name: 'model-a',
      version: '1.0.0',
      domain: 'frontend',
      description: '',
      author: '',
      architecture: 'ternary-v1',
      files: [],
      dependencies: [],
      tags: [],
      minBuddyVersion: '0.1.0',
      license: 'MIT',
      publishedAt: Date.now(),
    });
    await repo.register({
      name: 'model-b',
      version: '1.0.0',
      domain: 'backend',
      description: '',
      author: '',
      architecture: 'ternary-v1',
      files: [],
      dependencies: [],
      tags: [],
      minBuddyVersion: '0.1.0',
      license: 'MIT',
      publishedAt: Date.now(),
    });

    const results = await repo.search('', { domain: 'frontend' });
    expect(results).toHaveLength(1);
    expect(results[0].domain).toBe('frontend');
  });

  it('unregister 删除模型', async () => {
    await repo.init();
    await repo.register({
      name: 'to-delete',
      version: '1.0.0',
      domain: 'temp',
      description: '',
      author: '',
      architecture: 'ternary-v1',
      files: [],
      dependencies: [],
      tags: [],
      minBuddyVersion: '0.1.0',
      license: 'MIT',
      publishedAt: Date.now(),
    });

    expect(repo.listAll()).toHaveLength(1);
    const deleted = await repo.unregister('to-delete');
    expect(deleted).toBe(true);
    expect(repo.listAll()).toHaveLength(0);
  });

  it('unregister 不存在的模型返回 false', async () => {
    await repo.init();
    const deleted = await repo.unregister('ghost');
    expect(deleted).toBe(false);
  });

  it('getDownloadUrl 无远程返回 null', async () => {
    await repo.init();
    const url = await repo.getDownloadUrl('any-model');
    expect(url).toBeNull();
  });

  it('stats 返回统计信息', async () => {
    await repo.init();
    await repo.register({
      name: 'm1',
      version: '1.0.0',
      domain: 'd1',
      description: '',
      author: '',
      architecture: 'ternary-v1',
      files: [],
      dependencies: [],
      tags: [],
      minBuddyVersion: '0.1.0',
      license: 'MIT',
      publishedAt: Date.now(),
    });

    const s = repo.stats();
    expect(s.total).toBe(1);
    expect(s.cached).toBe(0); // 无实际文件
    expect(s.remoteUrl).toBeNull();
  });

  it('索引持久化：重新 init 后数据仍在', async () => {
    await repo.init();
    await repo.register({
      name: 'persist-test',
      version: '1.0.0',
      domain: 'persist',
      description: '持久化测试',
      author: 'test',
      architecture: 'ternary-v1',
      files: [],
      dependencies: [],
      tags: [],
      minBuddyVersion: '0.1.0',
      license: 'MIT',
      publishedAt: Date.now(),
    });

    // 新建 repo 实例指向同一目录
    const repo2 = new ModelRepository({ localDir: path.join(tmpDir, 'registry') });
    await repo2.init();

    const all = repo2.listAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('persist-test');
  });
});
