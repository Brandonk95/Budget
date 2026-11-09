# Keel's Teller mTLS proxy: nginx that adds your Teller client certificate.
# Idles until /certs/certificate.pem and /certs/private_key.pem exist, so it's safe
# to run even if you never use Teller.
FROM nginx:1.27-alpine
LABEL org.opencontainers.image.title="Keel Teller proxy" \
      org.opencontainers.image.source="https://github.com/Brandonk95/Budget"
COPY nginx.conf /etc/nginx/nginx.conf
COPY entrypoint.sh /usr/local/bin/teller-proxy-entrypoint
RUN chmod +x /usr/local/bin/teller-proxy-entrypoint
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/teller-proxy-entrypoint"]
