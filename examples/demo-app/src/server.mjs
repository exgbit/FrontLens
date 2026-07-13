import http from 'node:http';
import { readFileSync } from 'node:fs';

const clientScript = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? '127.0.0.1';

let users = [
  { id: 1, name: 'Alice', role: '管理员', status: '启用' },
  { id: 2, name: 'Bob', role: '运营', status: '启用' },
  { id: 3, name: 'FrontLens', role: '测试', status: '停用' },
  { id: 4, name: 'Carol', role: '财务', status: '启用' }
];

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function html() {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="description" content="FrontLens interactive demo" />
    <title>用户管理 - Interactive</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 24px; }
      .breadcrumb, .toolbar, form, table, .pagination { margin-bottom: 16px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
      th[aria-sort] { cursor: pointer; background: #f8fafc; }
      button { margin-right: 8px; }
      .primary { color: #fff; background: #0958d9; border: 1px solid #0958d9; }
      .danger { color: #b42318; }
      .modal { position: fixed; inset: 20% auto auto 30%; width: 360px; padding: 16px; border: 1px solid #999; background: #fff; box-shadow: 0 12px 40px #0002; }
      .hidden { display: none; }
      .empty { color: #666; padding: 24px; }
    </style>
  </head>
  <body data-role="viewer">
    <nav class="breadcrumb"><span>系统管理</span> / <span>用户管理</span></nav>
    <h1>用户管理</h1>
    <p id="permission-hint">当前角色：普通用户；普通用户无删除权限</p>
    <div id="error" class="hidden" role="alert"></div>
    <button id="retry" type="button" class="hidden">重试</button>

    <form id="filters" class="ant-form">
      <label>用户名 <input id="keyword" name="q" placeholder="请输入用户名" /></label>
      <button type="button" id="search">搜索</button>
      <button type="button" id="reset">重置</button>
    </form>

    <div class="toolbar">
      <button class="primary" type="button">新增用户</button>
      <button type="button" id="refresh">刷新</button>
      <button type="button" id="export">导出</button>
    </div>

    <div class="upload">
      <label>上传头像 <input type="file" id="avatar" accept=".txt,.png,.jpg" /></label>
      <span id="upload-status">支持 txt/png/jpg，最大 1MB</span>
    </div>

    <table class="ant-table">
      <thead>
        <tr>
          <th><input type="checkbox" id="select-all" aria-label="全选" /></th>
          <th id="sort-name" aria-sort="none">用户名 排序</th>
          <th>角色</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody id="tbody"></tbody>
    </table>
    <div id="empty" class="empty hidden">暂无数据</div>

    <div class="pagination">
      <button type="button" id="prev">上一页</button>
      <span id="page-text">1 / 1</span>
      <button type="button" id="next">下一页</button>
    </div>

    <div id="detail-modal" class="modal hidden" role="dialog" aria-label="用户详情">
      <h2>用户详情</h2>
      <div id="detail-content"></div>
      <button type="button" id="close-detail">关闭</button>
    </div>

    <script src="/app.js"></script>
  </body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (url.pathname === '/app.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-length': Buffer.byteLength(clientScript) });
    res.end(clientScript);
    return;
  }
  if (url.pathname === '/') {
    const body = html();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body) });
    res.end(body);
    return;
  }
  if (url.pathname === '/api/users') {
    const q = url.searchParams.get('q')?.toLowerCase() ?? '';
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 2);
    const sort = url.searchParams.get('sort') ?? '';
    let filtered = users.filter((user) => user.name.toLowerCase().includes(q));
    if (sort === 'name_asc') filtered = filtered.toSorted((a, b) => a.name.localeCompare(b.name));
    if (sort === 'name_desc') filtered = filtered.toSorted((a, b) => b.name.localeCompare(a.name));
    const start = (page - 1) * pageSize;
    json(res, { records: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize });
    return;
  }
  if (url.pathname.startsWith('/api/users/')) {
    const id = Number(url.pathname.split('/').pop());
    const user = users.find((item) => item.id === id);
    if (req.method === 'DELETE') {
      if (req.headers['x-role'] !== 'admin') {
        json(res, { message: 'forbidden' }, 403);
        return;
      }
      if (!user) {
        json(res, { message: 'not found' }, 404);
        return;
      }
      users = users.filter((item) => item.id !== id);
      json(res, { ok: true, id });
      return;
    }
    if (req.method !== 'GET') {
      json(res, { message: 'method not allowed' }, 405);
      return;
    }
    json(res, user ?? { message: 'not found' }, user ? 200 : 404);
    return;
  }
  if (url.pathname === '/api/export') {
    const q = url.searchParams.get('q')?.toLowerCase() ?? '';
    const exported = users.filter((user) => user.name.toLowerCase().includes(q));
    const body = 'id,name,role,status\\n' + exported.map((user) => `${user.id},${user.name},${user.role},${user.status}`).join('\\n');
    res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="users.csv"',
      'content-length': Buffer.byteLength(body)
    });
    res.end(body);
    return;
  }
  if (url.pathname === '/api/upload' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const headerEnd = body.indexOf('\r\n\r\n');
      const disposition = body.subarray(0, Math.max(0, headerEnd)).toString('utf8');
      const filename = disposition.match(/filename="([^"]+)"/i)?.[1] ?? '';
      const extension = filename.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase() ?? '';
      const boundary = req.headers['content-type']?.match(/boundary=([^;]+)/i)?.[1];
      const closing = boundary ? body.lastIndexOf(Buffer.from(`\r\n--${boundary}`)) : -1;
      const fileStart = headerEnd >= 0 ? headerEnd + 4 : body.length;
      const fileEnd = closing >= fileStart ? closing : body.length;
      const fileSize = Math.max(0, fileEnd - fileStart);
      if (!['.txt', '.png', '.jpg'].includes(extension)) {
        json(res, { message: '仅支持 txt/png/jpg 文件' }, 400);
        return;
      }
      if (fileSize > 1024 * 1024) {
        json(res, { message: '文件不能超过 1MB' }, 413);
        return;
      }
      json(res, { ok: true, filename, size: fileSize, message: '上传成功' });
    });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.on('error', (error) => {
  console.error(`FrontLens demo server failed to listen on ${host}:${port}: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`FrontLens demo server: http://${host}:${port}/`);
});
