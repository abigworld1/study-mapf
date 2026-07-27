#!/usr/bin/env bash
#
# sync-reference-repos.sh — docs/sources/repositories.yaml に載っている第三者リポジトリを
# .references/<repository-id> へ取得する。
#
# 設計方針（SOURCE_POLICY.md と対応）:
#   * .references/ 配下は参照専用。本リポジトリへは絶対にコミットしない（.gitignore 済み）。
#   * 既存ディレクトリは削除せず fetch のみ。ローカル変更を勝手に捨てない。
#   * pinned_commit があればその commit を checkout する。detached HEAD は正常状態として扱う。
#   * サブモジュールは取得しない。必要性が確認できるまで再帰 clone は行わない。
#   * 1 件の失敗で他の clone を壊さない。ただし失敗は必ず報告し、終了コードへ反映する。
#
# 使い方:
#   scripts/sync-reference-repos.sh                # 全件
#   scripts/sync-reference-repos.sh pibt2 lacam3   # ID 指定
#   DRY_RUN=1 scripts/sync-reference-repos.sh      # 実行せず対象一覧だけ表示
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REFS_DIR="${REPO_ROOT}/.references"
MANIFEST="${REPO_ROOT}/docs/sources/repositories.yaml"

CLONE_TIMEOUT="${CLONE_TIMEOUT:-600}"
DRY_RUN="${DRY_RUN:-0}"

ok_ids=()
fail_ids=()

log()  { printf '%s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*" >&2; }
err()  { printf 'ERROR %s\n' "$*" >&2; }

on_error() {
  local exit_code=$? line=${BASH_LINENO[0]:-?}
  err "予期しない失敗: line ${line} (exit ${exit_code})"
  exit "${exit_code}"
}
trap on_error ERR

require() {
  command -v "$1" >/dev/null 2>&1 || { err "$1 が見つからない"; exit 127; }
}
require git
require node

[[ -f "${MANIFEST}" ]] || { err "マニフェストが無い: ${MANIFEST}"; exit 1; }

# git のサブコマンドをタイムアウト付きで実行する（timeout が無い環境ではそのまま実行）。
run_git() {
  if command -v timeout >/dev/null 2>&1; then
    timeout --signal=TERM "${CLONE_TIMEOUT}" git "$@"
  else
    git "$@"
  fi
}

# ライセンスファイルの有無を確認する。無いこと自体は失敗にしないが、必ず警告する。
check_license_files() {
  local dir="$1" id="$2"
  local found=()
  local name
  for name in LICENSE LICENSE.md LICENSE.txt LICENCE COPYING COPYING.txt NOTICE NOTICE.txt LICENSE-MIT LICENSE-APACHE; do
    [[ -f "${dir}/${name}" ]] && found+=("${name}")
  done
  if ((${#found[@]} == 0)); then
    warn "[${id}] LICENSE / COPYING / NOTICE が見つからない。license_spdx は null、copy_allowed は false のまま扱うこと"
  else
    log "      license files: ${found[*]}"
    local first_line
    first_line="$(head -n 5 "${dir}/${found[0]}" | tr -s ' \n\r' ' ' | cut -c1-120)"
    log "      license head : ${first_line}"
  fi
}

# 1 リポジトリを取得する。失敗しても他へ波及させないため、呼び出し側で戻り値を見る。
sync_one() {
  local id="$1" url="$2" rel_path="$3" branch="$4" pinned="$5"
  local dest="${REPO_ROOT}/${rel_path}"

  log "----------------------------------------------------------------------"
  log "[${id}] ${url}"
  log "      dest=${rel_path} branch=${branch} pinned=${pinned}"

  if [[ "${DRY_RUN}" == "1" ]]; then
    log "      DRY_RUN のため実行しない"
    return 0
  fi

  if [[ -d "${dest}/.git" ]]; then
    log "      既存クローンを fetch（削除はしない）"
    run_git -C "${dest}" fetch --tags --prune origin || return 1
  elif [[ -e "${dest}" ]]; then
    # git 管理下でない何かが既にある。中身を消すのは危険なので触らない。
    err "[${id}] ${rel_path} が存在するが git リポジトリではない。手動で確認すること"
    return 1
  else
    mkdir -p "$(dirname -- "${dest}")"
    log "      新規 clone（--filter=blob:none）"
    if ! run_git clone --filter=blob:none --no-recurse-submodules "${url}" "${dest}"; then
      warn "[${id}] partial clone に失敗。通常 clone で再試行する"
      rm -rf -- "${dest}"
      run_git clone --no-recurse-submodules "${url}" "${dest}" || return 1
    fi
  fi

  if [[ "${pinned}" != "-" ]]; then
    log "      pinned_commit を checkout: ${pinned}"
    # partial clone では pinned commit の blob が未取得のことがあるため明示的に fetch する。
    run_git -C "${dest}" fetch origin "${pinned}" 2>/dev/null || true
    if ! run_git -C "${dest}" checkout --detach "${pinned}"; then
      err "[${id}] pinned_commit ${pinned} を checkout できない"
      return 1
    fi
  elif [[ "${branch}" != "-" ]]; then
    log "      pinned_commit 未設定。default_branch を checkout: ${branch}"
    if ! run_git -C "${dest}" checkout --detach "origin/${branch}" 2>/dev/null; then
      warn "[${id}] origin/${branch} を checkout できない。現在の HEAD のままにする"
    fi
  else
    warn "[${id}] pinned_commit も default_branch も未設定。現在の HEAD のままにする"
  fi

  # detached HEAD は想定内。rev-parse は必ず表示する（マニフェストへ転記するため）。
  local head
  head="$(git -C "${dest}" rev-parse HEAD)"
  log "      HEAD = ${head}"
  log "      ↑ この値を repositories.yaml の pinned_commit へ転記すること"

  check_license_files "${dest}" "${id}"
  return 0
}

mkdir -p "${REFS_DIR}"

targets_file="$(mktemp)"
cleanup() { rm -f -- "${targets_file}"; }
trap 'cleanup' EXIT

if (($# > 0)); then
  ids_csv="$(IFS=,; echo "$*")"
  node "${SCRIPT_DIR}/lib/repo-targets.mjs" --only "${ids_csv}" > "${targets_file}"
else
  node "${SCRIPT_DIR}/lib/repo-targets.mjs" > "${targets_file}"
fi

total="$(wc -l < "${targets_file}" | tr -d ' ')"
log "対象 ${total} 件 / clone 先 ${REFS_DIR}"

# 1 件の失敗で全体を止めないため、ループ内では ERR トラップを無効化して戻り値で判定する。
while IFS=$'\t' read -r id url rel_path branch pinned; do
  [[ -z "${id}" ]] && continue
  set +e
  trap - ERR
  sync_one "${id}" "${url}" "${rel_path}" "${branch}" "${pinned}"
  rc=$?
  set -e
  trap on_error ERR
  if ((rc == 0)); then
    ok_ids+=("${id}")
  else
    fail_ids+=("${id}")
    err "[${id}] 取得に失敗（rc=${rc}）。他のリポジトリは続行する"
  fi
done < "${targets_file}"

log "======================================================================"
log "成功 ${#ok_ids[@]} 件: ${ok_ids[*]:-(なし)}"
log "失敗 ${#fail_ids[@]} 件: ${fail_ids[*]:-(なし)}"

if ((${#fail_ids[@]} > 0)); then
  err "失敗があるため終了コード 1 を返す。repositories.yaml の clone_status を failed にすること"
  exit 1
fi
log "全件成功"
