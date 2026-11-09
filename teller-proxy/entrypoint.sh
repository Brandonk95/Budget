#!/bin/sh
# Wait for the client certificate instead of crash-looping when it's missing.
warned=0
until [ -s /certs/certificate.pem ] && [ -s /certs/private_key.pem ]; do
  if [ "$warned" = 0 ]; then
    echo "teller-proxy: idle. Put certificate.pem and private_key.pem in the certs folder to enable Teller (development/production)."
    warned=1
  fi
  sleep 30
done
echo "teller-proxy: certificate found, starting"
exec nginx -g 'daemon off;'
