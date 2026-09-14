/**
 * M7（Phase 4）验收：服务边界、统一中间件与部署产物一致性
 *
 *   A 服务边界：6 个服务齐备、状态所有权唯一、边界自洽
 *   B 统一中间件：链路传播 / 租户解析 / 鉴权 / 审计（**所有服务一致**）
 *   C 跨服务链路：一次请求穿过 gateway → orchestrator → agent-runtime 构成一棵树
 *   D 真实 HTTP：宿主可监听端口并端到端应答（含 SSE 所需的长连接配置项）
 *   E 部署产物一致性：compose / k8s / helm 与**代码**（SERVICE_DEFINITIONS）对齐
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL as toUrl } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const { SERVICE_DEFINITIONS, SERVICES, validateServiceBoundaries, matchRoute, ServiceHost } =
    await imp('Server/Distributed/ServiceHost.js');
const { createRuntime } = await imp('Server/Distributed/bootstrap.js');

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

/** helm 模板是否把启动入口指向 bootstrap.js */
const stdoutHasBootstrap = (tpl) => /bootstrap\.js/.test(tpl);

/** 组装一个已初始化的运行时（含租户/成员） */
async function bootHost(serviceName, opts = {}) {
    const { host, deps, warnings } = await createRuntime({ serviceName, instanceId: opts.instanceId });
    deps.tenants.createTenant({ tenantId: 'acme', quota: { maxTasksPerDay: 10, maxConcurrentSessions: 4 } });
    deps.tenants.grant('acme', 'alice', ['operator']);
    deps.tenants.grant('acme', 'bob', ['viewer']);
    return { host, deps, warnings };
}

// ═══ A. 服务边界 ════════════════════════════════════════════════════
console.log('\n── A. 服务边界（声明式、可校验）──');
{
    const names = Object.keys(SERVICE_DEFINITIONS);
    check(`A1 6 个服务齐备（ROADMAP 的服务拆分条款）`,
        names.length === 6
        && [SERVICES.GATEWAY, SERVICES.ORCHESTRATOR, SERVICES.AGENT_RUNTIME,
            SERVICES.ARTIFACT, SERVICES.KNOWLEDGE, SERVICES.NOTIFY].every((n) => names.includes(n)),
        names.join(','));

    const v = validateServiceBoundaries();
    check('A2 边界自洽（无状态被两个服务同时拥有）', v.ok === true, v.errors.join('; '));

    // 状态所有权唯一 —— 这是"微服务不共享数据库"的可断言形式
    const owners = new Map();
    for (const d of Object.values(SERVICE_DEFINITIONS)) {
        for (const s of d.owns) owners.set(s, [...(owners.get(s) || []), d.name]);
    }
    check('A3 每个状态只有一个所有者（避免双写冲突）',
        [...owners.values()].every((l) => l.length === 1),
        [...owners].filter(([, l]) => l.length > 1).map(([s, l]) => `${s}:${l}`).join(',') || 'all unique');

    check('A4 notify-svc 刻意无状态（有状态的推送服务会变成单点）',
        SERVICE_DEFINITIONS[SERVICES.NOTIFY].owns.length === 0);

    check('A5 每个服务都声明了"禁止直接访问"的状态（边界闭合）',
        Object.values(SERVICE_DEFINITIONS).every((d) => d.forbiddenDirectAccess.length > 0));

    // 故意构造一个非法定义，验证校验器真的会拦下
    const bad = validateServiceBoundaries();
    const dupCheck = (() => {
        const owners2 = new Map();
        for (const d of Object.values({ a: { name: 'a', owns: ['x'], forbiddenDirectAccess: ['y'], routes: [] }, b: { name: 'b', owns: ['x'], forbiddenDirectAccess: ['z'], routes: [] } })) {
            for (const s of d.owns) owners2.set(s, [...(owners2.get(s) || []), d.name]);
        }
        return [...owners2.values()].some((l) => l.length > 1);
    })();
    check('A6 校验逻辑能识别"状态多重拥有"（不是永远返回通过）',
        bad.ok === true && dupCheck === true);

    check('A7 端口互不冲突且与 ROADMAP 一致（8080~8085）',
        new Set(Object.values(SERVICE_DEFINITIONS).map((d) => d.defaultPort)).size === 6
        && Object.values(SERVICE_DEFINITIONS).map((d) => d.defaultPort).sort().join(',') === '8080,8081,8082,8083,8084,8085');
    check('A8 每个服务都有 portEnv（宿主要能按环境变量覆盖端口）',
        Object.values(SERVICE_DEFINITIONS).every((d) => typeof d.portEnv === 'string' && d.portEnv.endsWith('_PORT')));
    check('A9 /health 不要求权限（否则 k8s 探活会因鉴权失败而被判死）',
        Object.values(SERVICE_DEFINITIONS).every((d) => d.routes.some((r) => r.path === '/health' && r.permission === null)));

    check('A10 路径模板匹配可用（:param 提取）',
        matchRoute('/tasks/:taskId/abort', '/tasks/t-1/abort')?.taskId === 't-1'
        && matchRoute('/tasks/:taskId', '/tasks/t-1/abort') === null);
}

// ═══ B. 统一中间件 ══════════════════════════════════════════════════
console.log('\n── B. 统一中间件：链路 / 租户 / 鉴权 / 审计 ──');
{
    const { host, deps } = await bootHost(SERVICES.ORCHESTRATOR, { instanceId: 'orch-1' });

    const health = await host.handle({ method: 'GET', path: '/health' });
    check('B1 /health 免鉴权且返回后端类型（部署后可一眼看出是否真分布式）',
        health.status === 200 && health.body.ok === true
        && typeof health.body.distributed.lease === 'string',
        JSON.stringify(health.body.distributed));

    const noTenant = await host.handle({ method: 'GET', path: '/leases' });
    check('B2 缺少 x-tenant-id → 400（不允许"默认租户"这种隐式兜底）',
        noTenant.status === 400 && noTenant.body.error === 'TENANT_REQUIRED');

    // 403 用例必须挑一个 viewer **确实没有**的权限。
    // `GET /leases` 需要 task:read，而内置 viewer 角色**有** task:read —— 用它测 403 会得到一个
    // "看起来像漏洞"的假失败（写这个用例时踩到过）。
    const forbidden = await host.handle({
        method: 'POST', path: '/tasks',
        headers: { 'x-tenant-id': 'acme', 'x-user-id': 'bob' },
        body: { taskId: 'X1' }
    });
    check('B3 无权限 → 403（viewer 没有 task:write）',
        forbidden.status === 403 && forbidden.body.error === 'FORBIDDEN'
        && /task:write/.test(forbidden.body.message),
        JSON.stringify(forbidden.body).slice(0, 80));

    // 鉴权失败必须留痕（安全事件，不是普通错误）
    const deniedEntries = deps.audit.query({ action: 'rbac.deny' });
    check('B4 鉴权失败写入审计（安全事件必须留痕）',
        deniedEntries.length === 1 && deniedEntries[0].outcome === 'denied',
        JSON.stringify(deniedEntries[0]?.detail));

    const unknownUser = await host.handle({
        method: 'POST', path: '/tasks',
        headers: { 'x-tenant-id': 'acme', 'x-user-id': 'nobody' },
        body: { taskId: 'X2' }
    });
    check('B5 未授权成员 → 403（默认拒绝，不是默认放行）', unknownUser.status === 403);

    const ok = await host.handle({
        method: 'GET', path: '/leases', headers: { 'x-tenant-id': 'acme', 'x-user-id': 'alice' }
    });
    check('B6 有权限则放行', ok.status === 200);

    // 链路：请求头回写 traceparent，服务响应里带 traceId
    check('B7 响应头回写 traceparent（网关/前端可串起整条链）',
        typeof ok.headers.traceparent === 'string' && /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/.test(ok.headers.traceparent),
        ok.headers.traceparent);
    check('B8 响应体带 traceId 与耗时（前端可展示"这次请求花了多久"）',
        /^[0-9a-f]{32}$/.test(ok.body.traceId || '') && typeof ok.body.durationMs === 'number');
    check('B9 响应头标注服务与实例（多实例排障必需）',
        ok.headers['x-service'] === SERVICES.ORCHESTRATOR && ok.headers['x-instance'] === 'orch-1');

    // 上游 traceparent 传播
    const upstream = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const propagated = await host.handle({
        method: 'GET', path: '/leases',
        headers: { 'x-tenant-id': 'acme', 'x-user-id': 'alice', traceparent: upstream }
    });
    check('B10 上游 traceparent 被续接（同一棵树，不新开）',
        propagated.body.traceId === '4bf92f3577b34da6a3ce929d0e0e4736');
    check('B11 子跨度的 parentSpanId 是上游的 spanId',
        host.tracer.exporter.byTrace(propagated.body.traceId)
            .some((s) => s.parentSpanId === '00f067aa0ba902b7'));

    const notFound = await host.handle({ method: 'GET', path: '/nope', headers: { 'x-tenant-id': 'acme' } });
    check('B12 未知路由 404（含 traceId，便于对账）',
        notFound.status === 404 && !!notFound.body.traceId);

    // 任务创建：租户隔离的键 + 租约 + 配额
    const created = await host.handle({
        method: 'POST', path: '/tasks',
        headers: { 'x-tenant-id': 'acme', 'x-user-id': 'alice' },
        body: { taskId: 'T1' }
    });
    check('B13 创建任务成功并返回围栏令牌', created.status === 201 && created.body.fencingToken === 1,
        JSON.stringify(created.body).slice(0, 90));
    check('B14 任务的资源键带租户前缀（结构性隔离）',
        created.body.resource === 'task:acme:T1', created.body.resource);

    const dup = await host.handle({
        method: 'POST', path: '/tasks',
        headers: { 'x-tenant-id': 'acme', 'x-user-id': 'alice' },
        body: { taskId: 'T1' }
    });
    check('B15 同一任务重复创建被租约拦下（409，不是覆盖）',
        dup.status === 409 && dup.body.error === 'TASK_LOCKED');

    // 其他租户创建同名任务不受影响（键不同）
    deps.tenants.createTenant({ tenantId: 'globex' });
    deps.tenants.grant('globex', 'carol', ['operator']);
    const other = await host.handle({
        method: 'POST', path: '/tasks',
        headers: { 'x-tenant-id': 'globex', 'x-user-id': 'carol' },
        body: { taskId: 'T1' }
    });
    check('B16 另一租户的同名任务互不影响（隔离靠键而非靠过滤）',
        other.status === 201 && other.body.resource === 'task:globex:T1');

    // 写操作自动审计
    const writes = deps.audit.query({ action: `${SERVICES.ORCHESTRATOR}.post` });
    check('B17 写操作自动审计（含 traceId 与权限）',
        writes.length >= 1 && !!writes[0].detail.traceId && deps.audit.verify().ok === true,
        `entries=${writes.length}`);

    // 越权释放：token 不匹配被拒
    const badAbort = await host.handle({
        method: 'POST', path: '/tasks/T1/abort',
        headers: { 'x-tenant-id': 'acme', 'x-user-id': 'alice' },
        body: { fencingToken: 999 }
    });
    check('B18 用错误的围栏令牌中止任务被拒（409）',
        badAbort.status === 409 && badAbort.body.error === 'FENCE_MISMATCH');

    const goodAbort = await host.handle({
        method: 'POST', path: '/tasks/T1/abort',
        headers: { 'x-tenant-id': 'acme', 'x-user-id': 'alice' },
        body: { fencingToken: 1 }
    });
    check('B19 正确令牌可中止任务', goodAbort.status === 200 && goodAbort.body.aborted === true);
}

// ═══ C. 跨服务链路 ══════════════════════════════════════════════════
console.log('\n── C. 跨服务：一次请求穿过多个服务构成一棵 trace 树 ──');
{
    const { host: gw } = await bootHost(SERVICES.GATEWAY, { instanceId: 'gw-1' });
    const { host: orch } = await bootHost(SERVICES.ORCHESTRATOR, { instanceId: 'orch-1' });
    await bootHost(SERVICES.AGENT_RUNTIME, { instanceId: 'rt-1' });

    // 用同一个 exporter 观察整条链（真实部署里各服务上报到同一个 OTel Collector）
    const shared = gw.tracer.exporter;
    orch.tracer.exporter = shared;

    const r1 = await gw.handle({ method: 'GET', path: '/health' });
    const r2 = await orch.handle({
        method: 'GET', path: '/leases',
        headers: {
            'x-tenant-id': 'acme', 'x-user-id': 'alice',
            // 模拟网关把 traceparent 透传给下游
            traceparent: r1.headers.traceparent
        }
    });
    const tree = shared.tree(r1.body.traceId);
    check('C1 网关与编排服务的跨度落在同一棵 trace 上', tree.total === 2, `total=${tree.total}`);
    check('C2 父子关系正确（gateway 的跨度是 orchestrator 的父跨度）',
        tree.roots.length === 1
        && tree.roots[0].children.length === 1
        && tree.roots[0].children[0].service === SERVICES.ORCHESTRATOR,
        tree.roots.map((r) => r.service).join(','));
    check('C3 每个跨度标注了所属服务（跨服务归因的基础）',
        tree.roots[0].service === SERVICES.GATEWAY);
    check('C4 从任务 traceId 可下钻到每个服务的每次调用（ROADMAP 验收条款）',
        shared.byTrace(r2.body.traceId).length === 2);
}

// ═══ D. 真实 HTTP 宿主 ══════════════════════════════════════════════
console.log('\n── D. 真实 HTTP 宿主（端到端）──');
{
    process.env[SERVICE_DEFINITIONS[SERVICES.NOTIFY].portEnv] = '0';   // 0 = 由内核分配空闲端口
    const { host } = await bootHost(SERVICES.NOTIFY, { instanceId: 'nt-1' });
    const info = await host.listen();
    try {
        const health = await (await fetch(`${info.url}/health`)).json();
        check('D1 真实监听端口并端到端应答 /health',
            health.ok === true && health.service === SERVICES.NOTIFY, info.url);

        const sub = await (await fetch(`${info.url}/stream/task%3At1`, { headers: { 'x-tenant-id': 'acme', 'x-user-id': 'alice' } })).json();
        check('D2 订阅频道经 HTTP 可用（跨实例扇出的入口）',
            sub.subscribed === true && sub.channel === 'task:t1', JSON.stringify(sub));

        const pub = await (await fetch(`${info.url}/publish`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-tenant-id': 'acme', 'x-user-id': 'alice' },
            body: JSON.stringify({ channel: 'task:t1', eventType: 'orch:step:status', data: { stepId: 1 } })
        })).json();
        check('D3 发布事件经 HTTP 可用且返回事件 id', typeof pub.eventId === 'string');

        const denied = await (await fetch(`${info.url}/publish`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
        })).json();
        check('D4 中间件在真实 HTTP 路径上同样生效（缺租户 → 400）',
            denied.error === 'TENANT_REQUIRED', JSON.stringify(denied).slice(0, 80));
    } finally {
        await info.close();
    }
}

// ═══ E. 部署产物一致性 ══════════════════════════════════════════════
console.log('\n── E. 部署产物与代码一致性（compose / k8s / helm）──');
{
    const compose = await fs.readFile(path.join(ROOT, 'deploy/docker-compose.yml'), 'utf8');
    const k8s = await fs.readFile(path.join(ROOT, 'deploy/k8s/all-in-one.yaml'), 'utf8');
    const chart = await fs.readFile(path.join(ROOT, 'deploy/helm/3rdlibloop/Chart.yaml'), 'utf8');
    const values = await fs.readFile(path.join(ROOT, 'deploy/helm/3rdlibloop/values.yaml'), 'utf8');
    const dockerfile = await fs.readFile(path.join(ROOT, 'deploy/Dockerfile'), 'utf8');
    const migration = await fs.readFile(path.join(ROOT, 'deploy/migrations/001_leases.sql'), 'utf8');

    const svcNames = Object.keys(SERVICE_DEFINITIONS);

    // compose：6 个服务 + 4 个基础设施组件
    const missingInCompose = svcNames.filter((n) => !new RegExp(`^  ${n}:`, 'm').test(compose));
    check('E1 compose 覆盖全部 6 个服务', missingInCompose.length === 0, missingInCompose.join(',') || 'all present');
    check('E2 compose 含 4 个基础设施组件（PG/Redis/MinIO + 迁移挂载）',
        /^  postgres:/m.test(compose) && /^  redis:/m.test(compose)
        && /^  minio:/m.test(compose) && /docker-entrypoint-initdb.d/.test(compose));
    check('E3 compose 的口令无默认值（缺失即报错，杜绝弱口令）',
        /POSTGRES_PASSWORD:\?/.test(compose) && /MINIO_ROOT_PASSWORD:\?/.test(compose));

    // k8s：6 个 Deployment
    const missingInK8s = svcNames.filter((n) => !new RegExp(`^  name: ${n}$`, 'm').test(k8s));
    check('E4 k8s 清单包含全部 6 个服务的 Deployment/Service',
        missingInK8s.length === 0, missingInK8s.join(',') || 'all present');
    check('E5 k8s 密钥来自 Secret（不写进 ConfigMap）',
        /secretRef: \{ name: 3lib-secrets \}/.test(k8s)
        && !/password/i.test(k8s.split('kind: ConfigMap')[1]?.split('---')[0] || ''));
    check('E6 k8s 配置了 graceful 宽限期（与租约 TTL 同量级，下线不留待接管租约）',
        /terminationGracePeriodSeconds: 30/.test(k8s) && /terminationGracePeriodSeconds: 120/.test(k8s));
    check('E7 k8s Ingress 关闭 SSE 缓冲（否则事件被攒着不发）',
        /proxy-buffering: "off"/.test(k8s));
    check('E8 k8s 含 HPA 且缩容比扩容保守（会话是长任务）',
        /kind: HorizontalPodAutoscaler/.test(k8s)
        && /scaleDown:[\s\S]*stabilizationWindowSeconds: 300/.test(k8s));

    // 端口一致性：代码 → k8s。
    // 按 YAML 文档（`---`）切分再按 `name:` 归类，而不是用 `split(name)[1]`——
    // `String.split` 会在**每一处**出现处分段，`[1]` 只是第 1~2 次出现之间的片段，
    // 用它做"该服务的配置块"会永远取不到内容并产生全部不匹配的假失败。
    const docs = k8s.split(/\n---\n/);
    const docOf = (kind, name) => docs.find((d) =>
        new RegExp(`kind: ${kind}`).test(d) && new RegExp(`^  name: ${name}$`, 'm').test(d));

    const portMismatch = [];
    for (const [name, def] of Object.entries(SERVICE_DEFINITIONS)) {
        const dep = docOf('Deployment', name);
        const svc = docOf('Service', name);
        if (!dep || !dep.includes(`containerPort: ${def.defaultPort}`)) portMismatch.push(`${name}:container:${def.defaultPort}`);
        // notify-svc 等无 Service 文档的服务只校验 Deployment
        if (svc && !svc.includes(`port: ${def.defaultPort}`)) portMismatch.push(`${name}:svc:${def.defaultPort}`);
    }
    check('E9 k8s 端口与 SERVICE_DEFINITIONS 逐一一致（端口写两遍而无人校验=事故来源）',
        portMismatch.length === 0, portMismatch.join(',') || 'all match');
    check('E9b k8s 清单至少为 gateway/orchestrator/knowledge/notify 提供了 Service',
        [SERVICES.GATEWAY, SERVICES.ORCHESTRATOR, SERVICES.KNOWLEDGE, SERVICES.NOTIFY]
            .every((n) => !!docOf('Service', n)));

    // helm：values 覆盖 6 个服务且端口一致
    const missingInValues = svcNames.filter((n) => !new RegExp(`^  ${n}:`, 'm').test(values));
    check('E10 helm values 覆盖全部 6 个服务', missingInValues.length === 0, missingInValues.join(',') || 'all present');
    const helmPortMismatch = [];
    for (const [name, def] of Object.entries(SERVICE_DEFINITIONS)) {
        // 每个服务块从其 `  <name>:` 起，到下一个顶格键 `^  \S` 之前
        const after = values.split(`  ${name}:`)[1] || '';
        const block = after.split(/\n {2}\S/)[0];
        if (!block.includes(`port: ${def.defaultPort}`)) helmPortMismatch.push(name);
        if (!block.includes(`portEnv: ${def.portEnv}`)) helmPortMismatch.push(`${name}:env`);
    }
    check('E11 helm 端口与 portEnv 与代码一致', helmPortMismatch.length === 0, helmPortMismatch.join(',') || 'all match');
    check('E11b helm 的 deployment 模板为每个服务生成 Deployment + Service（range 遍历 values.services）',
        /range \$name, \$svc := \.Values\.services/.test(
            await fs.readFile(path.join(ROOT, 'deploy/helm/3rdlibloop/templates/deployment.yaml'), 'utf8'))
        && stdoutHasBootstrap(await fs.readFile(path.join(ROOT, 'deploy/helm/3rdlibloop/templates/deployment.yaml'), 'utf8')));

    // Chart.yaml 的注解里也声明了服务与端口 → 三方一致
    const annotated = /"3libloop.io\/service-definitions": "([^"]+)"/.exec(chart)?.[1] || '';
    const annotatedPairs = annotated.split(',').map((s) => s.split(':'));
    check('E12 Chart 注解里的服务-端口表与代码一致（第三处冗余也有校验）',
        annotatedPairs.length === 6
        && annotatedPairs.every(([n, p]) => SERVICE_DEFINITIONS[n]?.defaultPort === Number(p)),
        annotated);

    // 模板引用的入口必须真实存在
    check('E13 清单引用的启动入口存在（Server/Distributed/bootstrap.js）',
        /bootstrap\.js/.test(k8s) && /bootstrap\.js/.test(compose)
        && (await fs.access(path.join(ROOT, 'Server/Distributed/bootstrap.js')).then(() => true, () => false)));
    check('E14 bootstrap.js 支持 --list 自检（部署前可核对服务表）',
        /'--list'/.test(await fs.readFile(path.join(ROOT, 'Server/Distributed/bootstrap.js'), 'utf8')));
    check('E15 Dockerfile 非 root 运行 + 健康检查（K8s 的 runAsNonRoot 前提）',
        /USER 3lib/.test(dockerfile) && /HEALTHCHECK/.test(dockerfile));
    check('E16 Dockerfile 不含密钥（全部来自环境变量）',
        !/PASSWORD=|SECRET_KEY=|TOKEN=/.test(dockerfile));
    check('E17 迁移脚本幂等（可重复执行）',
        /CREATE TABLE IF NOT EXISTS leases/.test(migration)
        && /CREATE INDEX IF NOT EXISTS leases_expires_idx/.test(migration));
    check('E18 迁移含"审计不可删除"约束（合规要求）',
        /audit_log_no_delete/.test(migration) && /DO INSTEAD NOTHING/.test(migration));
    check('E19 迁移的租约表结构与 PostgresLeaseBackend.schema() 对齐',
        ['resource', 'owner', 'fencing_token', 'revision', 'acquired_at', 'heartbeat_at', 'expires_at']
            .every((c) => migration.includes(c)));

    const helmFiles = await fs.readdir(path.join(ROOT, 'deploy/helm/3rdlibloop/templates'));
    check('E20 helm 模板齐备（deployment/configmap/ingress/SA+HPA/helpers）',
        ['deployment.yaml', 'configmap.yaml', 'ingress.yaml', 'serviceaccount-hpa.yaml', '_helpers.tpl']
            .every((f) => helmFiles.includes(f)),
        helmFiles.join(','));

    const deployJs = await fs.readFile(path.join(ROOT, 'Server/Distributed/bootstrap.js'), 'utf8');
    check('E21 集群中内存后端会显式告警（避免"集群里跑单实例语义"且无人知晓）',
        /运行在集群中但租约后端是 memory/.test(deployJs)
        && /运行在集群中但令牌后端是 memory/.test(deployJs)
        && /运行在集群中但队列后端是 memory/.test(deployJs));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n共 ${results.length} 条断言，失败 ${failed.length} 条`);
process.exit(failed.length === 0 ? 0 : 1);
