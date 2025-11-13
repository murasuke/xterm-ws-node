<!--
slides/terminal-architecture.md
タイトル: ブラウザで見る「ターミナルの仕組み」
作成日時: 2025-11-13
ベース: server.js / public/index.html (xterm.js + node-pty のミニマル実装)
-->

# ブラウザでbashを動かして理解する「ターミナルの仕組み」

---
# 1. タイトル
- ブラウザで見る「ターミナルの仕組み」
- xterm.js + node-pty を用いた実装例で全体像を掴む

*発表者メモ:* 目的は「ターミナル」と「シェル」の違いと、その間にある仮想端末（pty）の役割を直感的に理解してもらうこと。

---
# 2. モチベーション
- 多くの利用者は「ターミナル表示」と「シェル」を同一視してしまいがち
- ブラウザ上でターミナルを作ると、各構成要素の境界が明確になる
- 実装を追いながら、入出力の流れを理解する

*発表者メモ:* 「ターミナル = ただの表示装置ではない」ことを語る導入。

---
# 3. 高レベルのアーキテクチャ
- ブラウザ (xterm.js)
  ↔ WebSocket
  ↔ サーバ (Node.js)
  ↔ PTY（擬似端末）
  ↔ シェル（bash, sh 等）

- それぞれの責務
  - ブラウザ: レンダリングとキー入力の収集
  - サーバ: WebSocket 中継と PTY の管理
  - PTY: 入出力の仲介（master/slave）
  - シェル: コマンド解釈とプロセス実行

*発表者メモ:* 図を描けると理解が早い（矢印でデータの流れを可視化）。

---
# 4. 「ターミナル」と「シェル」の違い
- ターミナル (terminal)
  - 文字表示と入力の入れ物
  - ANSI 制御シーケンスを解釈して描画
- シェル (shell)
  - コマンドの解釈、プロセス起動、ジョブ管理
- 仮想端末 (pty)
  - ターミナルとシェルを接続する中継点

*発表者メモ:* 物理ターミナル（VT100）からの歴史的背景を簡単に触れても良い。

---
# 5. UNIX の仮想端末 (tty / pty / pts / ptmx)
- tty: 端末インターフェースの抽象
- pty (pseudo-tty): 仮想端末。master と slave の対で動作
- /dev/ptmx: master 側を作る special device
- /dev/pts/N: スレーブ側のデバイスファイル
- master に書く → slave が読む、slave に書く → master が読む（双方向ストリーム）

*発表者メモ:* マスター/スレーブという観点を強調。データはバイトストリームとして流れる。

---
# 6. 実装の要点（server.js） — 擬似TTY の生成
- node-pty を使って擬似TTY を spawn
- 接続ごとに新しい pty を作る（セッション分離）

コード抜粋:
```js
// server.js (抜粋)
const shell = process.env.SHELL || 'bash';
const ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-color',
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: process.env,
});
```

*発表者メモ:* node-pty の内部で OS の ptmx/pts が使われ、シェルはスレーブ側を「通常の端末」として認識する。

---
# 7. 実装の要点（public/index.html） — 端末表示と入力
- xterm.js が端末表示を担当
- キー入力は term.onData で取得して WebSocket 経由で送信
- サーバから受け取った文字列を term.write で描画

コード抜粋:
```js
// クライアント側（抜粋）
term.onData(data => ws.send(data));
ws.addEventListener('message', ev => term.write(ev.data));
```

*発表者メモ:* xterm.js は ANSI エスケープシーケンス（色、カーソル制御）を解釈して表示する。

---
# 8. データフロー（入力経路）
- ブラウザ: キー押下 → xterm.js がバイト列を生成
- WebSocket: ブラウザ → サーバへ送信
- サーバ: ws.on('message') で受信 → ptyProcess.write(msg)
- シェル: pty のスレーブとしてバイト列を受け取りコマンドとして解釈

コード抜粋（server.js の受信処理）:
```js
ws.on('message', (msg) => {
  try {
    const obj = JSON.parse(msg);
    if (obj && obj.type === 'resize') {
      ptyProcess.resize(obj.cols, obj.rows);
      return;
    }
  } catch (_) {
    // JSON でなければテキスト入力
  }
  ptyProcess.write(msg.toString());
});
```

*発表者メモ:* 入力は通常生のバイト列。特殊メッセージ（リサイズ）は JSON で区別している。

---
# 9. データフロー（出力経路）
- シェル（プロセス）→ stdout / stderr に書き込み
- pty の master が onData で出力を受け取る
- サーバが WebSocket 経由でブラウザへ送信
- ブラウザが受け取り term.write で描画

コード抜粋（server.js の出力処理）:
```js
ptyProcess.onData((data) => {
  ws.send(data); // 文字列そのまま送る
});
```

*発表者メモ:* 出力には ANSI シーケンスが混ざるため、端末エミュレータ側で正しく解釈される必要がある。

---
# 10. リサイズと SIGWINCH
- クライアントがウィンドウリサイズを検知 → JSON メッセージで cols/rows を送る
- サーバで ptyProcess.resize(cols, rows) を呼ぶと、シェル側に SIGWINCH が届く
- これにより ncurses などのアプリがウィンドウサイズ変更に対応する

クライアント側（送信）:
```js
ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
```

*発表者メモ:* 実際に vim/less などを動かしてリサイズを試すと動作が分かりやすい。

---
# 11. セキュリティと運用上の注意
- 認証・認可: 誰でも自由にシェルが使える状態は危険
- サンドボックス: 低権限ユーザー、名前空間、コンテナで実行
- 入出力ログ: 監査とデバッグ用にログを残す (機密情報の取扱注意)
- タイムアウト・接続管理: 放置セッション対策
- プロセス制御: 切断時にプロセスを適切に終了する

*発表者メモ:* デモで公開サーバにそのまま使わない旨を強調する。

---
# 12. まとめと参考
- 要点まとめ
  - ターミナルは表示/入出力の装置、シェルはコマンド実行部
  - PTY が両者をつなぎ、バイトストリームと制御シーケンスを仲介する
  - WebSocket + node-pty + xterm.js の構成は「端末の役割」を分かりやすく見せる
- 参考
  - xterm.js: https://xtermjs.org/
  - node-pty: https://github.com/microsoft/node-pty
  - POSIX PTY の文書や SIGWINCH の解説

*発表者メモ:* デモ（server.js を実行してブラウザで接続）を示して締めると効果的。
