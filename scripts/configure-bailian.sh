#!/bin/bash
set +x
set -euo pipefail
umask 077

if [[ ! -t 0 ]]; then
  printf '%s\n' '请在 macOS「终端」里运行，以便隐藏 API Key 输入。' >&2
  exit 2
fi

config_dir="$HOME/.config/short-film-workbench"
config_file="$config_dir/bailian.env"
key_only=false
case "${1:-}" in
  '') ;;
  --key-only)
    if [[ ! -f "$config_file" || ! -r "$config_file" ]]; then
      printf '%s\n' '请先运行不带参数的配置命令，保存地域、业务空间和音色。' >&2
      exit 2
    fi
    key_only=true
    ;;
  *) printf '%s\n' '用法：bash scripts/configure-bailian.sh [--key-only]' >&2; exit 2 ;;
esac

if ! $key_only; then
  while true; do
    read -r -p '百炼地域 [1 北京（回车默认） / 2 新加坡]：' region
    case "$region" in
      ''|1|北京|华北2|华北2（北京）|cn-beijing)
        region='cn-beijing'
        default_zh='anmingyuan_v3.1'
        break
        ;;
      2|新加坡|ap-southeast-1)
        region='ap-southeast-1'
        default_zh='longanhuan_v3.1'
        break
        ;;
      *) printf '%s\n' '请输入 1 选北京、2 选新加坡，或直接回车选北京。' >&2 ;;
    esac
  done
  while true; do
    read -r -p '同地域的业务空间 ID 或 API Host（在业务空间管理页复制）：' workspace
    workspace=${workspace#https://}
    workspace=${workspace%/}
    workspace=${workspace%/compatible-mode/v1}
    workspace=${workspace%/api/v1}
    workspace=${workspace%."$region".maas.aliyuncs.com}
    if [[ "$workspace" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]]; then
      break
    fi
    printf '%s\n' '业务空间 ID 格式不正确，请核对后重新输入。' >&2
  done
  read -r -p "中文 voice ID [默认 $default_zh]：" voice_zh
  read -r -p '英文 voice ID [默认 Eric_v3.1]：' voice_en
  if [[ "$region" == cn-beijing ]]; then
    read -r -p '泰语 voice ID [留空使用百炼 Sambert Waan]：' voice_th
  else
    read -r -p '泰语 voice ID [可留空，使用逐句上传的泰语配音]：' voice_th
  fi
  voice_zh=${voice_zh:-$default_zh}
  voice_en=${voice_en:-Eric_v3.1}
  for voice in "$voice_zh" "$voice_en" "$voice_th"; do
    if [[ -n "$voice" && ! "$voice" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$ ]]; then
      printf '%s\n' '音色 ID 格式不正确，请填写 voice 参数值。' >&2
      exit 2
    fi
  done
fi

while true; do
  read -r -s -p '现在粘贴新建的百炼 API Key（输入隐藏），然后按回车：' api_key
  printf '\n'
  if [[ "$api_key" =~ ^sk-[A-Za-z0-9_.-]+$ ]]; then
    break
  fi
  unset api_key
  printf '%s\n' 'API Key 格式不正确，请重新复制完整的百炼 API Key。' >&2
done

mkdir -p "$config_dir"
chmod 700 "$config_dir"
temp_file=$(mktemp "$config_dir/.bailian.XXXXXX")
trap 'rm -f "$temp_file"' EXIT
{
  if $key_only; then
    while IFS= read -r setting || [[ -n "$setting" ]]; do
      case "$setting" in
        DASHSCOPE_API_KEY=*) ;;
        *) printf '%s\n' "$setting" ;;
      esac
    done < "$config_file"
  else
    printf '%s\n' \
      "DASHSCOPE_WORKSPACE_ID=$workspace" \
      "DASHSCOPE_REGION=$region" \
      'DASHSCOPE_SPEECH_MODEL=qwen-audio-3.1-tts-flash' \
      "DASHSCOPE_VOICE_ZH=$voice_zh" \
      "DASHSCOPE_VOICE_EN=$voice_en" \
      "DASHSCOPE_VOICE_TH=$voice_th"
  fi
  printf '%s\n' "DASHSCOPE_API_KEY=$api_key"
} > "$temp_file"
unset api_key
chmod 600 "$temp_file"
mv -f "$temp_file" "$config_file"
printf '配置已保存（权限 600）\n%s\n' "$config_file"
