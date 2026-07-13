const state = { q: '', page: 1, pageSize: 2, sort: '', totalPages: 1, loading: false };
const tbody = document.querySelector('#tbody');
const empty = document.querySelector('#empty');
const errorBox = document.querySelector('#error');
const retry = document.querySelector('#retry');
const currentRole = document.body.dataset.role ?? 'viewer';
let lastSearchAt = 0;

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
  retry.classList.remove('hidden');
}

function clearError() {
  errorBox.textContent = '';
  errorBox.classList.add('hidden');
  retry.classList.add('hidden');
}

async function loadUsers() {
  if (state.loading) return;
  state.loading = true;
  document.querySelector('#search').disabled = true;
  const params = new URLSearchParams({
    q: state.q,
    page: String(state.page),
    pageSize: String(state.pageSize),
    sort: state.sort
  });
  try {
    clearError();
    const response = await fetch('/api/users?' + params.toString());
    if (!response.ok) throw new Error(`加载失败（HTTP ${response.status}）`);
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
    actionCell.append(detail);
    if (currentRole === 'admin') {
      const danger = document.createElement('button');
      danger.type = 'button';
      danger.className = 'danger';
      danger.dataset.id = String(user.id);
      danger.textContent = '删除';
      actionCell.append(' ', danger);
    }
    row.append(selectCell, nameCell, roleCell, statusCell, actionCell);
    tbody.append(row);
    }
    empty.classList.toggle('hidden', data.records.length !== 0);
    state.totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    document.querySelector('#page-text').textContent = data.page + ' / ' + state.totalPages;
  } catch (error) {
    tbody.textContent = '';
    empty.classList.add('hidden');
    showError(error instanceof Error ? error.message : '加载失败，请重试');
  } finally {
    state.loading = false;
    document.querySelector('#search').disabled = false;
  }
}

document.querySelector('#search').addEventListener('click', () => {
  const now = Date.now();
  if (now - lastSearchAt < 400) return;
  lastSearchAt = now;
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
  state.page = Math.min(state.totalPages, state.page + 1);
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
  const extension = file.name.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase();
  if (!['.txt', '.png', '.jpg'].includes(extension) || file.size > 1024 * 1024) {
    document.querySelector('#upload-status').textContent = '文件类型或大小不符合要求';
    return;
  }
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/upload', { method: 'POST', body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? '上传失败');
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
  if (target.matches('.danger') && currentRole === 'admin') {
    const response = await fetch('/api/users/' + target.dataset.id, { method: 'DELETE', headers: { 'x-role': currentRole } });
    if (!response.ok) throw new Error(`删除失败（HTTP ${response.status}）`);
    await loadUsers();
  }
});
retry.addEventListener('click', () => loadUsers());
document.querySelector('#close-detail').addEventListener('click', () => document.querySelector('#detail-modal').classList.add('hidden'));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') document.querySelector('#detail-modal').classList.add('hidden');
});

loadUsers();
