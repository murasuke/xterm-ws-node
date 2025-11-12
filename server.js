// server.js
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import os from 'os';
import pty from 'node-pty';

const app = express();
app.use(express.static('public')); // public/index.html を配信

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/term' });

wss.on('connection', (ws) => {
  // クライアント1接続につき1つの擬似TTYを生成
  const shell = process.env.SHELL || 'bash';
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env,
  });

  // PTY -> WS（端末出力をブラウザへ）
  ptyProcess.onData((data) => {
    ws.send(data); // 文字列そのまま送る
  });

  // WS -> PTY（キー入力などをシェルへ）
  ws.on('message', (msg) => {
    try {
      // リサイズメッセージに対応（JSONで {type:"resize", cols, rows} を送る）
      const obj = JSON.parse(msg);
      if (obj && obj.type === 'resize' && obj.cols && obj.rows) {
        ptyProcess.resize(obj.cols, obj.rows);
        return;
      }
    } catch (_) {
      // JSONじゃなければテキスト入力として処理
    }
    ptyProcess.write(msg.toString());
  });

  ws.on('close', () => {
    try {
      ptyProcess.kill();
    } catch (_) {}
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
