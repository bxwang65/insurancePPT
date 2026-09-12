#!/bin/bash
# 查 ECS server.log
# 用法:
#   bash scripts/ecs-tail.sh                 # 默认 tail 50
#   bash scripts/ecs-tail.sh -n 200          # tail 200
#   bash scripts/ecs-tail.sh -s <sessionId>  # 按 sessionId 过滤
#   bash scripts/ecs-tail.sh -f plan.pdf     # 按文件名过滤
#   bash scripts/ecs-tail.sh -g orchestrator # 按关键字 grep
#   bash scripts/ecs-tail.sh -F              # follow 实时
#   bash scripts/ecs-tail.sh -e "ERROR|FAIL" # 错误行
set -e

SSH_BASE_OPTS=(
  -i "$HOME/.ssh/id_rsa"
  -o BatchMode=yes
  -o ConnectTimeout=10
  -o StrictHostKeyChecking=no
  -o KexAlgorithms=curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group14-sha1,ecdh-sha2-nistp256
  -o HostKeyAlgorithms=ecdsa-sha2-nistp256,ssh-ed25519,rsa-sha2-512,rsa-sha2-256
  -o PubkeyAcceptedAlgorithms=ecdsa-sha2-nistp256,ssh-ed25519,rsa-sha2-512,rsa-sha2-256
)
LOG=/opt/insurance-ppt/logs/server.log

N=50
SESSION=""
FILE=""
GREP=""
ERR=0
FOLLOW=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n) N="$2"; shift 2 ;;
    -s) SESSION="$2"; shift 2 ;;
    -f) FILE="$2"; shift 2 ;;
    -g) GREP="$2"; shift 2 ;;
    -e) ERR=1; shift ;;
    -F) FOLLOW=1; shift ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done

# 组装远程命令
if [[ -n "$SESSION" ]]; then
  REMOTE="grep -E '$SESSION' $LOG | tail -$N"
elif [[ -n "$FILE" ]]; then
  REMOTE="grep -E '$FILE' $LOG | tail -$N"
elif [[ "$ERR" == "1" ]]; then
  REMOTE="grep -iE 'error|fail|exception|warn' $LOG | tail -$N"
elif [[ -n "$GREP" ]]; then
  REMOTE="grep -E '$GREP' $LOG | tail -$N"
elif [[ "$FOLLOW" == "1" ]]; then
  REMOTE="tail -F $LOG"
else
  REMOTE="tail -$N $LOG"
fi

ssh "${SSH_BASE_OPTS[@]}" root@47.242.58.70 "$REMOTE"