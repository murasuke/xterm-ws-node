# xterm-ws — ブラウザ上のシェル（xterm.js + WebSocket）簡易サンプル

このリポジトリは、ブラウザ（xterm.js）とサーバ（node + node-pty + ws）を組み合わせて、WebSocket 経由でローカルシェル（擬似TTY）と対話する最小構成のサンプルです。学習・実験目的のサンプル実装です。実運用での公開は重大なセキュリティリスクがあります — 必ずローカルでのみ利用してください（詳しくは「セキュリティ」セクション参照）。

```mermaid
graph LR
A[xterm.js<br>ブラウザUI]
B[Node.js<br>WebSocketサーバ]
C[/dev/ptmx<br>master]
D[/dev/pts/3<br>slave]
E[bashプロセス]

A --キー入力--> B --write()--> C --> D --> E
E --> D --> C --> B --> A
```

主なファイル
- `server.js` — Express サーバと WebSocket サーバを立て、接続ごとに `node-pty` で擬似TTY（シェル）を生成します。
  - WebSocket のパスは `/term` です。
  - クライアントから送られてきた JSON メッセージでリサイズ（{type:"resize", cols, rows}）を受け付けます。その他はそのままシェルへ書き込みます。
  - 接続終了時に PTY を kill します。
- `public/index.html` — xterm.js と FitAddon を CDN から読み込み、WebSocket 経由で `server.js` の PTY と通信するシンプルなクライアントです。
  - `term.onData` でブラウザ→サーバ（キー入力）を送信
  - サーバ→ブラウザは受信したメッセージを `term.write` で表示
  - ウィンドウリサイズ時に `fitAddon.fit()` を呼び、`{type:'resize', cols, rows}` を送信します
  - 注意: `term._core._renderService.dimensions` などの内部 API を参照しています（将来の xterm.js の変更で動かなくなる可能性があります）。可能なら公式 API の利用を検討してください。

前提（Prerequisites）
- Node.js（推奨は LTS 系）。nvm を使って Node 20.x をインストールするコマンド例を下に記載しています。
- `node-pty` のビルドに必要なビルドツール（特に Windows では Visual Studio Build Tools）や Python、node-gyp の設定が必要になることがあります。

インストール手順（Windows 向けの補足を含む）
1. Node を LTS に切り替える（例: nvm を使用）
   ```
   nvm install 20.19.5
   nvm use 20.19.5
   ```
2. Windows で `node-pty` をビルドする場合、Visual Studio Build Tools が必要です（例: winget を使ったインストール）。
   ```
   winget install -e --id Microsoft.VisualStudio.2022.BuildTools --source winget --override "--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621 --add Microsoft.VisualStudio.Component.VC.CMake.Project --add Microsoft.VisualStudio.Component.VC.CoreBuildTools"
   ```
   node-gyp や Python（2.7 / 3.x）も必要になる場合があります。`node-gyp` は devDependencies に含まれています。
3. パッケージ初期化（まだであれば）
   ```
   npm init -y
   ```
4. 依存パッケージをインストール（`node-pty` をソースからビルドする例）
   ```
   npm i node-pty --build-from-source
   npm i express ws
   ```
   package.json には既に `express`, `ws`, `node-pty` が dependencies に記載されています。

起動方法
- 直接 node で起動できます（プロジェクトルートで実行）:
  ```
  node server.js
  ```
  デフォルトポートは `3000` （環境変数 `PORT` で変更可）。起動すると `http://localhost:3000` がコンソールに表示されます。

クライアント（ブラウザ）の挙動
- `public/index.html` はブラウザで開かれると自動的に xterm を初期化し、同一オリジンで `/term` に WebSocket 接続します。
- キー入力はそのまま WS 経由でサーバに送られ、サーバ側の PTY に書き込まれます。
- ブラウザ側はリサイズ時に JSON で `{type:"resize", cols, rows}` を送ります。サーバはこれを受けて `ptyProcess.resize` を呼びます。
- サーバから送られてくる PTY の出力は文字列のままブラウザに届けられ、`term.write` で描画されます。

メッセージプロトコル（簡易）
- ブラウザ→サーバ
  - テキスト（通常のキー入力、改行など）: そのまま PTY に `write` されます
  - リサイズ通知: JSON 文字列 `{ "type": "resize", "cols": <number>, "rows": <number> }`
- サーバ→ブラウザ
  - PTY 出力の生データ（ANSI エスケープ等を含む文字列）

環境変数
- `PORT` — サーバのリッスンポート（デフォルト 3000）
- `SHELL` — サーバ側で使うシェルを明示する場合に設定します（`server.js` は `process.env.SHELL || 'bash'` を使います）。Windows では `SHELL` が未設定のことが多いため、WSL や Git Bash、PowerShell を使いたい場合は環境に応じて `SHELL` を設定するか、`server.js` の該当箇所を変更してください（例: `const shell = process.env.SHELL || process.env.COMSPEC || 'bash'`）。

セキュリティと運用上の注意
- このサンプルは接続したクライアントに対してサーバ上のシェルを直接与えます。つまり、任意のコマンド実行が可能になります。インターネット上へ公開すると深刻なセキュリティ侵害を招きます。ローカルの開発 / 学習用途に限定してください。
- 実運用する場合は、少なくとも以下を実装してください:
  - 認証・認可
  - 接続先シェルの制限（サンドボックス化）
  - TLS（wss://）を使用する
  - 接続の監査とログ
- 公開サーバにこのままデプロイしないでください。

トラブルシューティング
- node-pty のビルドエラー:
  - Windows では Visual Studio Build Tools、Python、適切な C++ コンパイラが必要です。上の winget コマンドを参考にインストールしてください。
  - node-gyp のエラーが出る場合は、`npm i --global windows-build-tools`（古い方法）や `node-gyp` のドキュメントに従ってツールを整備してください。
- ブラウザで何も表示されない / WS が接続できない:
  - ブラウザの Developer Tools のコンソールと Network タブを確認してください。
  - サーバが実行されているホスト・ポートとブラウザからの接続先が一致しているか（同一オリジン or CORS / プロキシの問題）を確認してください。
- xterm の表示サイズが正しくない:
  - `FitAddon` を利用してサイズ調整していますが、`term._core` の内部 API に依存している部分があります。FitAddon's public API（fit()）を適切に呼ぶことを優先してください。
