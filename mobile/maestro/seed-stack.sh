#!/usr/bin/env bash
# Waits for the end-to-end stack, started in the background so it comes up while the emulator
# boots, and puts a task on gunnar's board for the flows to find (#267). With a bearer token, as the app
# sends one (#266): Keycloak's password grant stands in for the browser sign-in the flows do for real.
set -euo pipefail

# The background start first, so two `compose up` never race; then everything healthy.
if [[ -f stack-start.pid ]]; then
  while kill -0 "$(cat stack-start.pid)" 2>/dev/null; do sleep 1; done
  cat stack-start.log
fi
docker compose -f deployment/docker/docker-compose.e2e.yml up -d --wait

token=$(curl -sS --fail http://localhost:8082/realms/taskfest/protocol/openid-connect/token \
  -d grant_type=password -d scope=openid -d client_id=taskfest-backend -d client_secret=taskfest-secret \
  -d username=gunnar -d password=gunnar | jq -r .id_token)
task=$(curl -sS --fail http://localhost:3000/api/tasks -H "Authorization: Bearer $token" \
  -H 'Content-Type: application/json' \
  -d "{\"description\":\"Seeded by CI for the app\",\"dueDate\":\"$(date -u +%F)\",\"importance\":\"HIGH\",\"state\":\"TODO\"}" | jq -r .id)
# Spike: two files on the task.
python3 - <<'PY'
import struct, zlib
w, h = 320, 200
raw = b''.join(b'\x00' + b''.join(bytes([x * 255 // w, y * 255 // h, 160]) for x in range(w)) for y in range(h))
def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
open('/tmp/photo.png', 'wb').write(png)
pdf = b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
open('/tmp/scan.pdf', 'wb').write(pdf)
PY
for file in photo.png:image/png scan.pdf:application/pdf; do
  name=${file%%:*}; type=${file#*:}; size=$(stat -c %s "/tmp/$name")
  upload=$(curl -sS --fail "http://localhost:3000/api/tasks/$task/attachments" -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' -d "{\"fileName\":\"$name\",\"contentType\":\"$type\",\"sizeBytes\":$size}")
  echo "$upload"
  url=$(echo "$upload" | jq -r .url); id=$(echo "$upload" | jq -r .attachment.id)
  headers=(); while IFS= read -r line; do headers+=(-H "$line"); done < <(echo "$upload" | jq -r '.headers | to_entries[] | "\(.key): \(.value)"')
  curl -sS --fail -X PUT "${headers[@]}" --data-binary "@/tmp/$name" "$url"
  curl -sS --fail -X POST "http://localhost:3000/api/tasks/$task/attachments/$id/confirm" -H "Authorization: Bearer $token"
done
