const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

const server = http.createServer((req, res) => {
  // URL 디코딩
  let filePath = decodeURIComponent(req.url);

  // 기본 경로 처리
  if (filePath === '/') {
    filePath = '/admin_dashboard.html';
  }

  // 파일 경로 생성
  const fullPath = path.join(__dirname, filePath);

  // 파일 존재 확인
  fs.access(fullPath, fs.constants.F_OK, (err) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`파일을 찾을 수 없습니다: ${filePath}`);
      return;
    }

    // MIME 타입 결정
    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };

    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    // 파일 읽기 및 응답
    fs.readFile(fullPath, (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`서버 오류: ${err.message}`);
        return;
      }

      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(content);
    });
  });
});

server.listen(PORT, () => {
  console.log(`🚀 정적 파일 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  console.log(`📋 관리자 대시보드: http://localhost:${PORT}/admin_dashboard.html`);
});