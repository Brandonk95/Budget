FROM alpine:3.22

ARG PB_VERSION=0.40.6
ARG PB_SDK_VERSION=0.28.2
ARG TARGETARCH

RUN apk add --no-cache ca-certificates tzdata unzip wget \
 && case "${TARGETARCH:-amd64}" in \
      amd64) PB_ARCH=amd64 ;; \
      arm64) PB_ARCH=arm64 ;; \
      arm)   PB_ARCH=armv7 ;; \
      *) echo "unsupported arch: ${TARGETARCH}" && exit 1 ;; \
    esac \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip" -O /tmp/pb.zip \
 && unzip /tmp/pb.zip pocketbase -d /pb \
 && rm /tmp/pb.zip \
 && apk del unzip

WORKDIR /pb
COPY pb_migrations ./pb_migrations
COPY pb_hooks ./pb_hooks
COPY pb_public ./pb_public
RUN mkdir -p pb_public/vendor \
 && wget -q "https://cdn.jsdelivr.net/npm/pocketbase@${PB_SDK_VERSION}/dist/pocketbase.umd.js" -O pb_public/vendor/pocketbase.umd.js
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8090
VOLUME /pb/pb_data
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8090/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
