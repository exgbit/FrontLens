import http from 'node:http';

const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? '127.0.0.1';

const users = [
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
      .primary { color: #fff; background: #1677ff; border: 1px solid #1677ff; }
      .danger { color: #b42318; }
      .modal { position: fixed; inset: 20% auto auto 30%; width: 360px; padding: 16px; border: 1px solid #999; background: #fff; box-shadow: 0 12px 40px #0002; }
      .hidden { display: none; }
      .empty { color: #666; padding: 24px; }
    </style>
  </head>
  <body>
    <nav class="breadcrumb"><span>系统管理</span> / <span>用户管理</span></nav>
    <h1>用户管理</h1>

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

    <script>
      const state = { q: '', page: 1, pageSize: 2, sort: '' };
      const tbody = document.querySelector('#tbody');
      const empty = document.querySelector('#empty');

      async function loadUsers() {
        const params = new URLSearchParams({
          q: state.q,
          page: String(state.page),
          pageSize: String(state.pageSize),
          sort: state.sort
        });
        const response = await fetch('/api/users?' + params.toString());
        const data = await response.json();
        tbody.textContent = '';
        for (const user of data.records) {
          const row = document.createElement('tr');
          const selectCell = document.createElement('td');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.setAttribute('aria-label', '选择 ' + user.name);
          selectCell.append(checkbox);
          const nameCell = document.createElement('td');
          nameCell.textContent = user.name;
          const roleCell = document.createElement('td');
          roleCell.textContent = user.role;
          const statusCell = document.createElement('td');
          statusCell.textContent = user.status;
          const actionCell = document.createElement('td');
          const detail = document.createElement('button');
          detail.type = 'button';
          detail.className = 'detail';
          detail.dataset.id = String(user.id);
          detail.textContent = '详情';
          const danger = document.createElement('button');
          danger.type = 'button';
          danger.className = 'danger';
          danger.textContent = '删除';
          actionCell.append(detail, ' ', danger);
          row.append(selectCell, nameCell, roleCell, statusCell, actionCell);
          tbody.append(row);
        }
        empty.classList.toggle('hidden', data.records.length !== 0);
        document.querySelector('#page-text').textContent = data.page + ' / ' + Math.max(1, Math.ceil(data.total / data.pageSize));
      }

      document.querySelector('#search').addEventListener('click', () => {
        state.q = document.querySelector('#keyword').value;
        state.page = 1;
        loadUsers();
      });

      document.querySelector('#reset').addEventListener('click', () => {
        document.querySelector('#keyword').value = '';
        state.q = '';
        state.page = 1;
        loadUsers();
      });

      document.querySelector('#next').addEventListener('click', () => {
        state.page += 1;
        loadUsers();
      });

      document.querySelector('#prev').addEventListener('click', () => {
        state.page = Math.max(1, state.page - 1);
        loadUsers();
      });

      document.querySelector('#sort-name').addEventListener('click', () => {
        state.sort = state.sort === 'name_asc' ? 'name_desc' : 'name_asc';
        document.querySelector('#sort-name').setAttribute('aria-sort', state.sort === 'name_asc' ? 'ascending' : 'descending');
        loadUsers();
      });

      document.querySelector('#refresh').addEventListener('click', () => loadUsers());
      document.querySelector('#export').addEventListener('click', () => {
        window.location.href = '/api/export?q=' + encodeURIComponent(state.q);
      });

      document.querySelector('#avatar').addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const form = new FormData();
        form.append('file', file);
        const response = await fetch('/api/upload', { method: 'POST', body: form });
        const data = await response.json();
        document.querySelector('#upload-status').textContent = data.message + ': ' + data.filename;
      });

      document.body.addEventListener('click', async (event) => {
        const target = event.target;
        if (target.matches('.detail')) {
          const response = await fetch('/api/users/' + target.dataset.id);
          const data = await response.json();
          document.querySelector('#detail-content').textContent = data.name + ' / ' + data.role;
          document.querySelector('#detail-modal').classList.remove('hidden');
        }
      });
      document.querySelector('#close-detail').addEventListener('click', () => document.querySelector('#detail-modal').classList.add('hidden'));
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') document.querySelector('#detail-modal').classList.add('hidden');
      });

      loadUsers();
    </script>
  </body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
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
    json(res, user ?? { message: 'not found' }, user ? 200 : 404);
    return;
  }
  if (url.pathname === '/api/export') {
    const body = 'id,name,role,status\\n' + users.map((user) => `${user.id},${user.name},${user.role},${user.status}`).join('\\n');
    res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="users.csv"',
      'content-length': Buffer.byteLength(body)
    });
    res.end(body);
    return;
  }
  if (url.pathname === '/api/upload' && req.method === 'POST') {
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
    });
    req.on('end', () => {
      json(res, { ok: true, filename: 'frontlens-upload.txt', size, message: '上传成功' });
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
