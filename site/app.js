document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const hasAdminParam = params.get('admin') === '1';
  const hasToken = !!localStorage.getItem('adminToken');
  
  if (hasAdminParam || hasToken) {
    const adminBtn = document.querySelector('.admin-btn');
    if (adminBtn) {
      adminBtn.classList.add('visible');
    }
  }
  
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('nav a').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });
});
