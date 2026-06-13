/**
 * ProjectModel — 类型定义
 *
 * 项目大脑：三层激活（无感 / 半显性 / 显性）
 * 给 Buddy 加项目意识，不替代已有模块。
 */

// ==================== 项目 ====================

export interface Project {
  id: string;                    // proj_<uuid>
  name: string;
  description: string;
  category: string;              // 'web' | 'mobile' | 'data' | 'devops' | 'research' | 'design' | 'other'
  tags: string[];
  status: 'planning' | 'active' | 'paused' | 'completed' | 'archived';
  origin: 'implicit' | 'explicit';  // 隐式（Agent自动）| 显式（用户创建）
  requirements: Requirement[];
  currentPlanId?: string;
  stmpRoomId: string;            // 关联 STMP 房间
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  metadata: Record<string, unknown>;
}

export interface Requirement {
  id: string;                    // req_<uuid>
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'proposed' | 'approved' | 'implementing' | 'verified' | 'done';
  acceptanceCriteria: string[];
  createdAt: number;
}

// ==================== 方案 ====================

export interface Plan {
  id: string;                    // plan_<uuid>
  projectId: string;
  title: string;
  description: string;
  version: number;
  parentVersionId?: string;
  status: 'draft' | 'approved' | 'executing' | 'completed' | 'superseded';
  steps: PlanStep[];
  decisions: Decision[];
  estimatedDurationMs?: number;
  actualDurationMs?: number;
  createdAt: number;
  updatedAt: number;
}

export interface PlanStep {
  id: string;                    // step_<uuid>
  title: string;
  description: string;
  tool?: string;
  args?: Record<string, unknown>;
  deps: string[];
  status: 'pending' | 'ready' | 'running' | 'done' | 'failed' | 'skipped';
  output?: string;
  estimatedMs?: number;
  actualMs?: number;
}

export interface Decision {
  id: string;                    // dec_<uuid>
  question: string;
  options: string[];
  chosen: string;
  reasoning: string;
  consequences?: string[];
  timestamp: number;
}

// ==================== 执行管理 ====================

export interface DAGBinding {
  id: string;                    // bind_<uuid>
  projectId: string;
  planId: string;
  dagId: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  pauseReason?: string;
  resumedAt?: number;
  startedAt: number;
  finishedAt?: number;
}

// ==================== 检查点与进度 ====================

export interface Checkpoint {
  id: string;                    // cp_<uuid>
  projectId: string;
  planId: string;
  dagBindingId?: string;
  phase: string;
  snapshot: {
    completedSteps: string[];
    pendingSteps: string[];
    runningSteps: string[];
    outputs: Record<string, string>;
    decisions: Decision[];
  };
  progressPercent: number;
  timestamp: number;
  note?: string;
}

export interface ProgressCounter {
  projectId: string;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  percentComplete: number;
  estimatedRemainingMs: number;
  lastUpdated: number;
}

// ==================== 产出物 ====================

export interface Artifact {
  id: string;                    // art_<uuid>
  projectId: string;
  planId?: string;
  name: string;
  type: 'code' | 'document' | 'config' | 'data' | 'design' | 'test' | 'other';
  path?: string;
  content?: string;
  version: number;
  parentVersionId?: string;
  createdBy: string;
  createdAt: number;
  metadata: Record<string, unknown>;
}

// ==================== 教训 ====================

export interface Lesson {
  id: string;                    // les_<uuid>
  projectId: string;
  category: 'mistake' | 'insight' | 'optimization' | 'pattern' | 'warning';
  title: string;
  description: string;
  context: string;
  correction?: string;
  impact: 'low' | 'medium' | 'high' | 'critical';
  applicableCategories: string[];
  experienceUnitId?: string;
  createdAt: number;
  verified: boolean;
}

// ==================== 跨项目 ====================

export interface SimilarProject {
  project: Project;
  similarity: number;
  matchedBy: 'category' | 'tags' | 'requirements' | 'technology';
  relevantLessons: Lesson[];
}

// ==================== 搜索 ====================

export interface SearchResult {
  entityType: 'project' | 'plan' | 'decision' | 'lesson' | 'artifact';
  entityId: string;
  projectId: string;
  title: string;
  snippet: string;
  rank: number;
}

// ==================== 统计 ====================

export interface ProjectStats {
  projectId: string;
  totalPlans: number;
  totalDecisions: number;
  totalCheckpoints: number;
  totalArtifacts: number;
  totalLessons: number;
  verifiedLessons: number;
  currentProgress: ProgressCounter | null;
}

export interface GlobalProjectStats {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  totalPlans: number;
  totalLessons: number;
  categories: Record<string, number>;
}
