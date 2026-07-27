# CLAUDE.md

作業規約は [AGENTS.md](AGENTS.md) に一本化してある。**まず AGENTS.md を読むこと。**

Claude Code は `CLAUDE.md` を、Codex は `AGENTS.md` を自動で読み込むため、
このファイルはポインタのみを置き、規約の実体は `AGENTS.md` にしか書かない。
両者が同じ資料・同じ規約を参照できるようにするための構成である。

## 要点だけ再掲

- 現段階は**資料整備フェーズ**。サイト本体はまだ実装しない。
- 論文情報・URL・DOI・理論保証・ライセンスを**記憶や推測で書かない**。
  一次情報で確認してから `docs/sources/*.yaml` へ書く。
- マニフェストを触ったら `node scripts/validate-sources.mjs` を走らせる（`errors=0` であること）。
- 禁止: `git reset --hard` / `git clean -fd` / force push / remote URL 変更 /
  ユーザ作成ファイルの削除 / ライセンス不明コードのコピー / 情報の捏造。
- `.references/` は第三者コードの参照用。コミットしない。削除しない。

詳細・根拠・コマンド例はすべて [AGENTS.md](AGENTS.md) と
[SOURCE_POLICY.md](SOURCE_POLICY.md) にある。
