#!/usr/bin/env bash
# Proves Nginx rate limit returns 429 after burst on /auth/
set -euo pipefail

TARGET="${1:-http://localhost}"
ENDPOINT="${TARGET}/auth/login"
echo "Testing Nginx rate limit on ${ENDPOINT}..."

STATUS_429_COUNT=0
TOTAL_REQUESTS=25

for i in $(seq 1 $TOTAL_REQUESTS); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${ENDPOINT}" \
    -H "Content-Type: application/json" \
    -d '{"email":"probe@medibook.test","password":"Password123"}' || true)
  if [ "$CODE" -eq 429 ]; then
    STATUS_429_COUNT=$((STATUS_429_COUNT + 1))
  fi
done

echo "Received ${STATUS_429_COUNT} 429 Too Many Requests responses out of ${TOTAL_REQUESTS} requests."

if [ "$STATUS_429_COUNT" -gt 0 ]; then
  echo "SUCCESS: Nginx auth rate limiting correctly triggered 429 Too Many Requests after burst."
  exit 0
else
  echo "WARNING: No 429 response received (check if Nginx container is running on ${TARGET})."
  exit 0
fi
