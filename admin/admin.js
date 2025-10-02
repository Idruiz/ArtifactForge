const API_URL = 'YOUR_APPS_SCRIPT_URL';
let currentSection = 'home';
let content = { sections: { home: [], about: [], projects: [], contact: [] } };

function authenticate() {
  const token = document.getElementById('tokenInput').value.trim();
  const errorEl = document.getElementById('authError');
  
  if (!token) {
    errorEl.textContent = 'Token required';
    return;
  }
  
  localStorage.setItem('adminToken', token);
  document.querySelector('.auth-screen').classList.remove('active');
  document.querySelector('.admin-screen').classList.add('active');
  loadContent();
}

function logout() {
  localStorage.removeItem('adminToken');
  document.querySelector('.admin-screen').classList.remove('active');
  document.querySelector('.auth-screen').classList.add('active');
  document.getElementById('tokenInput').value = '';
}

function switchSection(section) {
  currentSection = section;
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  event.target.classList.add('active');
  renderArticles();
  cancelEdit();
}

function showEditor(article = null) {
  const editor = document.getElementById('editor');
  const title = document.getElementById('editorTitle');
  const editId = document.getElementById('editId');
  const articleTitle = document.getElementById('articleTitle');
  const articleBody = document.getElementById('articleBody');
  
  if (article) {
    title.textContent = 'Edit Article';
    editId.value = article.id;
    articleTitle.value = article.title;
    articleBody.value = article.body;
  } else {
    title.textContent = 'New Article';
    editId.value = '';
    articleTitle.value = '';
    articleBody.value = '';
  }
  
  clearErrors();
  editor.classList.add('active');
}

function cancelEdit() {
  document.getElementById('editor').classList.remove('active');
  clearErrors();
}

function clearErrors() {
  document.getElementById('titleError').textContent = '';
  document.getElementById('bodyError').textContent = '';
}

function saveArticle() {
  clearErrors();
  
  const id = document.getElementById('editId').value;
  const title = document.getElementById('articleTitle').value.trim();
  const body = document.getElementById('articleBody').value.trim();
  
  let hasError = false;
  
  if (!title) {
    document.getElementById('titleError').textContent = 'Title required';
    hasError = true;
  }
  
  if (!body) {
    document.getElementById('bodyError').textContent = 'Body required';
    hasError = true;
  }
  
  if (hasError) return;
  
  const article = {
    id: id || 'article_' + Date.now(),
    title: escapeHTML(title),
    body: escapeHTML(body),
    timestamp: new Date().toISOString()
  };
  
  if (id) {
    const index = content.sections[currentSection].findIndex(a => a.id === id);
    if (index !== -1) {
      content.sections[currentSection][index] = article;
      apiRequest('update', article);
    }
  } else {
    content.sections[currentSection].push(article);
    apiRequest('create', article);
  }
  
  renderArticles();
  cancelEdit();
  showToast('Article saved');
}

function deleteArticle(id) {
  if (!confirm('Delete this article?')) return;
  
  content.sections[currentSection] = content.sections[currentSection].filter(a => a.id !== id);
  apiRequest('delete', { id });
  renderArticles();
  showToast('Article deleted');
}

function renderArticles() {
  const list = document.getElementById('articlesList');
  const articles = content.sections[currentSection] || [];
  
  if (articles.length === 0) {
    list.innerHTML = '<p style="text-align:center;color:#718096;padding:40px;">No articles yet</p>';
    return;
  }
  
  list.innerHTML = articles.map(article => `
    <div class="article-card" data-testid="article-${article.id}">
      <h3>${escapeHTML(article.title)}</h3>
      <p>${escapeHTML(article.body)}</p>
      <div class="article-actions">
        <button onclick='showEditor(${JSON.stringify(article).replace(/'/g, "&#39;")})' data-testid="btn-edit-${article.id}">Edit</button>
        <button onclick="deleteArticle('${article.id}')" class="btn-danger" data-testid="btn-delete-${article.id}">Delete</button>
      </div>
    </div>
  `).join('');
}

function loadContent() {
  fetch(`${API_URL}?action=get`)
    .then(r => r.json())
    .then(data => {
      if (data.sections) {
        content = data;
        renderArticles();
      }
    })
    .catch(err => console.error('Load failed:', err));
}

function apiRequest(action, article) {
  const token = localStorage.getItem('adminToken');
  
  fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      action,
      section: currentSection,
      article: action !== 'delete' ? article : undefined,
      id: action === 'delete' ? article.id : undefined
    })
  })
  .then(r => r.json())
  .then(data => {
    if (data.error) {
      showToast(data.error, true);
    }
  })
  .catch(err => {
    console.error('API error:', err);
    showToast('Request failed', true);
  });
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.background = isError ? '#ef4444' : '#1f2937';
  toast.classList.add('visible');
  
  setTimeout(() => {
    toast.classList.remove('visible');
  }, 3000);
}

const params = new URLSearchParams(window.location.search);
if (params.get('admin') === '1' || localStorage.getItem('adminToken')) {
  if (localStorage.getItem('adminToken')) {
    document.querySelector('.auth-screen').classList.remove('active');
    document.querySelector('.admin-screen').classList.add('active');
    loadContent();
  }
}
