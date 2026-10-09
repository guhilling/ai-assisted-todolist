#!/bin/bash
#
# The image's entry point (quarkus.jib.jvm-entrypoint): starts the backend serving TLS with a
# self-signed certificate made here, at every start (#247).
#
# The prod profile serves TLS only, on 8443 -- behind the load balancer in AWS and behind httpd in
# the Compose stacks. Neither validates the backend's certificate, so one nobody signed is enough:
# no CA, no secret to store, and nothing to renew, since each start makes a new one. Dev mode and
# the tests do not use the image, and stay on plain HTTP.
#
# The image is UBI micro with bash and coreutils only, so the key is made by the JRE's keytool and
# the password from /dev/urandom. Quarkus reads both from the environment; the prod profile in
# application.properties sets the port and turns plain HTTP off.
set -euo pipefail

keystore="${TASKFEST_TLS_KEYSTORE:-/tmp/taskfest-tls.p12}"
# 33 random bytes, base64 without its symbols: about 44 letters and digits. head comes first and
# reads to the end of what it asked for, so no stage of the pipe is cut off under pipefail.
password="$(head -c 33 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"

rm -f "$keystore"
keytool -genkeypair -noprompt \
    -alias taskfest-backend -keyalg RSA -keysize 2048 -validity 3650 \
    -dname "CN=taskfest-backend" \
    -storetype PKCS12 -keystore "$keystore" -storepass "$password" -keypass "$password" \
    >/dev/null
# keytool's errors stay on stderr: a start that fails here must say why in the task's log.

export QUARKUS_TLS_KEY_STORE_P12_PATH="$keystore"
export QUARKUS_TLS_KEY_STORE_P12_PASSWORD="$password"

# Exactly the image's own entry point (Jib's, from the Quarkus build): the working directory is
# /home/jboss, where quarkus-run.jar is.
exec java -Djava.util.logging.manager=org.jboss.logmanager.LogManager -jar quarkus-run.jar "$@"
