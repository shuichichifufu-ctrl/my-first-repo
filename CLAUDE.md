# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## このリポジトリについて

GitHubとPRの練習用リポジトリです。オーナーは教員で、GitHubを学習中です。

## 基本ルール

- 回答は必ず日本語で行う
- 説明は専門用語を避け、わかりやすく簡潔にする
- Git操作を行う際は、何をしているか一言説明してから実行する

## Git操作

```bash
# 変更をコミットしてプッシュ
git add <ファイル名>
git commit -m "変更内容の説明"
git push origin <ブランチ名>

# 新しいブランチを作成
git checkout -b <ブランチ名>

# PRを作成（GitHub CLI）
gh pr create --title "タイトル" --body "説明"
```

## GitHub CLI

`gh` コマンドのパス: `C:\Program Files\GitHub CLI\gh.exe`

アカウント: `shuichichifufu-ctrl`
