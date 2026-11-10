FROM alpine:3.22

LABEL org.opencontainers.image.title="Keel"       org.opencontainers.image.description="Self-hosted budgeting with bank sync, built on PocketBase"       org.opencontainers.image.source="https://github.com/Brandonk95/Budget"

ARG PB_VERSION=0.40.6
ARG PB_SDK_VERSION=0.28.2
ARG INTER_VERSION=5.1.0
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
COPY release.json ./release.json
# Stamp the app's asset URLs with a hash of their contents (app.js?v=...), so a browser,
# the service worker or a CDN like Cloudflare can never keep serving code from an old build.
RUN v=$(cat pb_public/app.js pb_public/styles.css | md5sum | cut -c1-10) \
 && sed -i "s|href=\"styles.css\"|href=\"styles.css?v=$v\"|; s|src=\"app.js\"|src=\"app.js?v=$v\"|" pb_public/index.html \
 && grep -q "app.js?v=$v" pb_public/index.html
RUN mkdir -p pb_public/vendor \
 && wget -q "https://cdn.jsdelivr.net/npm/pocketbase@${PB_SDK_VERSION}/dist/pocketbase.umd.js" -O pb_public/vendor/pocketbase.umd.js \
 && wget -q "https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@${INTER_VERSION}/files/inter-latin-wght-normal.woff2" -O pb_public/vendor/inter.woff2
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8090
VOLUME /pb/pb_data
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8090/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
