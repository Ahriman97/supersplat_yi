#!/usr/bin/env bash
#
# Smoke-тест для SAM-сервера.
# Проверяет, что сервер жив и корректно сегментирует объект.
#
# Запуск (из папки server_sam/):
#     bash tests/test_smoke.sh
#
# Возвращает:
#     0 — всё ОК
#     1 — что-то не так

set -euo pipefail

# --- Конфигурация ---
HOST="${SAM_HOST:-http://localhost:8000}"
TEST_IMAGE="$(dirname "$0")/test_image.jpg"
X="${SAM_TEST_X:-0.5}"
Y="${SAM_TEST_Y:-0.5}"

# Минимальный приемлемый score
MIN_SCORE="${SAM_MIN_SCORE:-0.7}"

# Максимальное допустимое время (сек)
MAX_TIME="${SAM_MAX_TIME:-10.0}"

# --- Утилиты вывода ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
fail() { echo -e "${RED}  ✗${NC} $1"; }
info() { echo -e "${YELLOW}  •${NC} $1"; }

echo ""
echo "=== SAM Server Smoke Test ==="
echo "  Host:        $HOST"
echo "  Image:       $TEST_IMAGE"
echo "  Click:       ($X, $Y)"
echo "  Min score:   $MIN_SCORE"
echo "  Max time:    ${MAX_TIME}s"
echo ""

# --- Проверка 0: файл картинки существует ---
if [ ! -f "$TEST_IMAGE" ]; then
    fail "Тестовая картинка не найдена: $TEST_IMAGE"
    exit 1
fi
ok "Тестовая картинка найдена"

# --- Проверка 1: /health ---
info "Проверяю $HOST/health ..."
HEALTH_RESPONSE=$(curl -sS -w "\n%{http_code}" "$HOST/health" || true)
HEALTH_CODE=$(echo "$HEALTH_RESPONSE" | tail -n1)
HEALTH_BODY=$(echo "$HEALTH_RESPONSE" | head -n-1)

if [ "$HEALTH_CODE" != "200" ]; then
    fail "/health вернул код $HEALTH_CODE"
    echo "    Ответ: $HEALTH_BODY"
    exit 1
fi

if echo "$HEALTH_BODY" | grep -q '"status":"ok"'; then
    ok "/health: 200, status=ok"
else
    fail "/health: 200, но status не ok"
    echo "    Ответ: $HEALTH_BODY"
    exit 1
fi

if echo "$HEALTH_BODY" | grep -q '"cuda_available":true'; then
    ok "/health: cuda_available=true"
else
    info "/health: cuda_available=false (сервер на CPU, будет медленнее)"
fi

# --- Проверка 2: /segment ---
info "Проверяю $HOST/segment ..."

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

MASK_FILE="$TMP_DIR/mask.png"
HEADERS_FILE="$TMP_DIR/headers.txt"

SEGMENT_CODE=$(curl -sS -o "$MASK_FILE" -D "$HEADERS_FILE" -w "%{http_code}" \
    -X POST "$HOST/segment" \
    -F "image=@$TEST_IMAGE" \
    -F "x=$X" \
    -F "y=$Y" || true)

if [ "$SEGMENT_CODE" != "200" ]; then
    fail "/segment вернул код $SEGMENT_CODE"
    cat "$HEADERS_FILE" 2>/dev/null || true
    exit 1
fi
ok "/segment: 200 OK"

# --- Проверка 3: маска непустая ---
MASK_SIZE=$(stat -c%s "$MASK_FILE" 2>/dev/null || stat -f%z "$MASK_FILE")
if [ "$MASK_SIZE" -lt 100 ]; then
    fail "Маска подозрительно маленькая: $MASK_SIZE байт"
    exit 1
fi
ok "Маска получена: $MASK_SIZE байт"

# --- Проверка 4: score ---
SCORE=$(grep -i '^x-sam-score:' "$HEADERS_FILE" | awk '{print $2}' | tr -d '\r')
if [ -z "$SCORE" ]; then
    fail "Заголовок X-SAM-Score отсутствует"
    exit 1
fi

SCORE_OK=$(awk -v s="$SCORE" -v m="$MIN_SCORE" 'BEGIN { print (s >= m) ? "1" : "0" }')
if [ "$SCORE_OK" = "1" ]; then
    ok "Score: $SCORE (>= $MIN_SCORE)"
else
    fail "Score слишком низкий: $SCORE (< $MIN_SCORE)"
    exit 1
fi

# --- Проверка 5: время ---
SAM_TIME=$(grep -i '^x-sam-time:' "$HEADERS_FILE" | awk '{print $2}' | tr -d '\r')
if [ -z "$SAM_TIME" ]; then
    fail "Заголовок X-SAM-Time отсутствует"
    exit 1
fi

TIME_OK=$(awk -v t="$SAM_TIME" -v m="$MAX_TIME" 'BEGIN { print (t <= m) ? "1" : "0" }')
if [ "$TIME_OK" = "1" ]; then
    ok "Время: ${SAM_TIME}s (<= ${MAX_TIME}s)"
else
    fail "Слишком медленно: ${SAM_TIME}s (> ${MAX_TIME}s)"
    exit 1
fi

# --- Итог ---
echo ""
echo -e "${GREEN}=== ВСЁ ОК ===${NC}"
echo ""
exit 0