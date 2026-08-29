#!/usr/bin/env bash
set -euo pipefail

environment_variable="$1"
secret_id="$2"
fallback_environment_variable="${3:-}"
fallback_value=""

if [ -n "${fallback_environment_variable}" ]; then
  if [[ ! "${fallback_environment_variable}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "::error::Fallback environment variable name is invalid."
    exit 1
  fi
  fallback_value="${!fallback_environment_variable:-}"
fi

if [ -z "${GCP_RUNTIME_PROJECT_ID:-}" ]; then
  echo "::error::GCP_RUNTIME_PROJECT_ID is required."
  exit 1
fi
if [ -z "${GITHUB_ENV:-}" ]; then
  echo "::error::GITHUB_ENV is required."
  exit 1
fi

# Versionが存在しない移行中のcontainerと、認証・権限・API障害を区別する。
# access latestの失敗へ無条件にfallbackするとWIFの破損を隠すため、先に
# enabled versionを列挙し、正常に0件と確認できた場合だけfallbackを許可する。
if ! latest_version="$(gcloud secrets versions list "${secret_id}" \
  --project="${GCP_RUNTIME_PROJECT_ID}" \
  --filter='state=ENABLED' \
  --sort-by='~createTime' \
  --limit=1 \
  --format='value(name)')"; then
  echo "::error::Secret Managerで${secret_id}のversion一覧を取得できませんでした。"
  exit 1
fi

if [ -z "${latest_version}" ]; then
  if [ -z "${fallback_value}" ]; then
    echo "::error::Secret Managerの${secret_id}に有効なversionがありません。"
    exit 1
  fi
  echo "::warning::${secret_id}は移行期間中のGitHub Environment Secretを使用します。"
  secret_value="${fallback_value}"
elif ! secret_value="$(gcloud secrets versions access "${latest_version##*/}" \
  --project="${GCP_RUNTIME_PROJECT_ID}" \
  --secret="${secret_id}")"; then
  echo "::error::Secret Managerから${secret_id}のversionを取得できませんでした。"
  exit 1
fi

if [ -z "${secret_value}" ]; then
  echo "::error::Secret Managerの${secret_id}が空です。"
  exit 1
fi
if [[ "${secret_value}" == *$'\n'* || "${secret_value}" == *$'\r'* ]]; then
  echo "::error::Secret Managerの${secret_id}に改行が含まれています。"
  exit 1
fi

echo "::add-mask::${secret_value}"
printf '%s=%s\n' "${environment_variable}" "${secret_value}" >> "${GITHUB_ENV}"
