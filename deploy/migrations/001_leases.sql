-- ============================================================================
-- 001_leases.sql —— 租约表（Phase 4：跨实例互斥 + fencing token）
--
-- **幂等**：全部使用 IF NOT EXISTS，可重复执行（发布流程会反复跑迁移）。
-- 与 Server/Distributed/Lease.js 的 PostgresLeaseBackend.schema() 保持一致
-- （由 test/m7-phase4 的一致性用例守护）。
-- ============================================================================

CREATE TABLE IF NOT EXISTS leases (
    resource        TEXT PRIMARY KEY,
    owner           TEXT        NOT NULL,
    -- 单调递增的围栏令牌：接管时 +1。
    -- 所有写操作都必须带着自己持有的 token，存储层拒绝 token 小于已见最大值的写入——
    -- 这是唯一能挡住"暂停 30 秒后恢复的旧持有者覆盖新持有者"的手段。
    fencing_token   BIGINT      NOT NULL,
    revision        BIGINT      NOT NULL,
    acquired_at     TIMESTAMPTZ NOT NULL,
    heartbeat_at    TIMESTAMPTZ NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL
);

-- 过期扫描用（"哪些实例死了、哪些任务待接管"）
CREATE INDEX IF NOT EXISTS leases_expires_idx ON leases (expires_at);

-- 按持有者查（实例下线时批量清理）
CREATE INDEX IF NOT EXISTS leases_owner_idx ON leases (owner);

-- ============================================================================
-- 任务与步骤（orchestrator-svc 拥有）
-- ============================================================================

CREATE TABLE IF NOT EXISTS tasks (
    -- 复合主键的第一列是 tenant_id：租户隔离在**主键层面**落地，
    -- 而不是靠每条查询记得写 WHERE。漏写过滤条件时会命中主键约束之外的路径，
    -- 但至少"不同租户的同名任务"在物理上不可能冲突。
    tenant_id       TEXT        NOT NULL,
    task_id         TEXT        NOT NULL,
    status          TEXT        NOT NULL,
    -- 乐观锁：并发更新时 WHERE revision = $n，冲突则重试
    revision        BIGINT      NOT NULL DEFAULT 0,
    definition      JSONB,
    progress        JSONB,
    cost_usd        NUMERIC(14, 6) NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, task_id)
);

CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS task_steps (
    tenant_id       TEXT        NOT NULL,
    task_id         TEXT        NOT NULL,
    step_id         TEXT        NOT NULL,
    -- 序号在**同一事务内**分配（Phase 1 的 F-16 修过跨进程 seq 冲突）
    seq             BIGINT      NOT NULL,
    status          TEXT        NOT NULL,
    attempt         INTEGER     NOT NULL DEFAULT 0,
    role            TEXT,
    session_id      TEXT,
    result_path     TEXT,
    metrics         JSONB,
    error           TEXT,
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, task_id, step_id)
);

CREATE INDEX IF NOT EXISTS task_steps_seq_idx ON task_steps (tenant_id, task_id, seq);
-- 幂等执行：同一 (task, step, attempt) 只能有一条终态记录
CREATE UNIQUE INDEX IF NOT EXISTS task_steps_attempt_uniq
    ON task_steps (tenant_id, task_id, step_id, attempt);

-- ============================================================================
-- 消息幂等消费（至少一次投递 → 效果上一次执行）
-- ============================================================================

CREATE TABLE IF NOT EXISTS consumed_messages (
    message_id      TEXT PRIMARY KEY,
    consumer        TEXT        NOT NULL,
    consumed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 过期清理（去重表必须有界，否则长时间运行就是内存/磁盘泄漏）
CREATE INDEX IF NOT EXISTS consumed_messages_at_idx ON consumed_messages (consumed_at);

-- ============================================================================
-- 审计（哈希链：每条记录带前一条的 hash）
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_log (
    seq             BIGINT      PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    actor           TEXT        NOT NULL,
    action          TEXT        NOT NULL,
    resource        TEXT,
    outcome         TEXT        NOT NULL,
    detail          JSONB,
    prev_hash       TEXT        NOT NULL,
    entry_hash      TEXT        NOT NULL,
    at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_tenant_idx ON audit_log (tenant_id, seq DESC);

-- 链的连续性由应用层 verify() 校验；数据库层面阻止删除（合规要求"不可删"）
CREATE OR REPLACE RULE audit_log_no_delete AS
    ON DELETE TO audit_log DO INSTEAD NOTHING;
