# 镜像构建（Phase 4）
#
# 多阶段构建：builder 装依赖（含 better-sqlite3 的原生编译工具链），
# 运行阶段只带必要文件。**不含任何密钥**——密钥一律来自环境变量 / K8s Secret。
#
# 构建（在仓库根目录执行）：
#   docker build -f deploy/Dockerfile -t 3libloop:1.0.0 .

FROM node:22-bookworm-slim AS builder
WORKDIR /build
# 先只拷贝依赖清单：依赖未变时这一层可复用（构建缓存的关键）
COPY package.json package-lock.json ./
COPY cli/package.json ./cli/
RUN npm ci --omit=dev --ignore-scripts=false
# 再拷源码
COPY Server ./Server
COPY Web ./Web
COPY cli ./cli

FROM node:22-bookworm-slim AS runtime
# 非 root 运行（安全基线，K8s 的 runAsNonRoot 也要求这一点）
RUN groupadd -r 3lib && useradd -r -g 3lib -d /app -s /sbin/nologin 3lib
WORKDIR /app
COPY --from=builder --chown=3lib:3lib /build ./
# 数据目录（单实例部署时落本地；集群部署时由对象存储/PG 接管）
RUN mkdir -p /app/db && chown -R 3lib:3lib /app/db
USER 3lib
ENV NODE_ENV=production \
    DISTRIBUTED_ENABLED=0 \
    PORT=8080

# 默认启动 gateway；每个服务的实际 command 由 Deployment / compose 覆盖
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "Server/Distributed/bootstrap.js", "gateway-svc"]
