#!/usr/bin/env bash
# Log a Freebuff/Codebuff session to the agentic-os tracker.
# Usage:
#   ./log-codebuff.sh "Set up Deepseek API key" "~/Projects" 12 5 0
#
# Args:
#   $1 = title (required)
#   $2 = project path (optional)
#   $3 = messages count (optional, default 10)
#   $4 = tool calls count (optional, default 3)
#   $5 = cost in USD (optional, default 0)
#
# Or pipe JSON:
#   echo '{"sessionId":"my-session","title":"Fix bug","model":"deepseek-v4-pro"}' | ./log-codebuff.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_URL="${AGENTIC_OS_URL:-http://127.0.0.1:4177}"

if [ -t 0 ]; then
  # Interactive mode: use args
  TITLE="${1:?Usage: $0 <title> [project] [messages] [toolCalls] [costUSD]}"
  PROJECT="${2:-}"
  MESSAGES="${3:-10}"
  TOOL_CALLS="${4:-3}"
  COST="${5:-0}"

  NOW=$(date +%s%3N 2>/dev/null || python3 -c "import time; print(int(time.time()*1000))")

  JSON=$(cat <<EOF
{
  "sessionId": "freebuff-${NOW}",
  "title": "${TITLE}",
  "project": "${PROJECT}",
  "model": "freebuff/mimo-v2.5",
  "messages": ${MESSAGES},
  "toolCalls": ${TOOL_CALLS},
  "inputTokens": 0,
  "outputTokens": 0,
  "costUSD": ${COST},
  "startedAt": ${NOW},
  "endedAt": ${NOW},
  "provider": "freebuff"
}
EOF
)
else
  # Piped mode: read JSON from stdin
  JSON=$(cat)
fi

RESPONSE=$(curl -s -X POST "${API_URL}/api/codebuff/sessions" \
  -H "Content-Type: application/json" \
  -d "${JSON}")

echo "Logged: ${RESPONSE}"
