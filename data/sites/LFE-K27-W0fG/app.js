// Active nav highlighting
document.addEventListener('DOMContentLoaded', () => {
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const links = document.querySelectorAll('nav a[href]');
  
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });
  
  // Show admin button if ?admin=1 or localStorage.adminToken exists
  const params = new URLSearchParams(window.location.search);
  const hasAdminParam = params.get('admin') === '1';
  const hasToken = !!localStorage.getItem('adminToken');
  
  if (hasAdminParam || hasToken) {
    const adminBtn = document.querySelector('.admin-btn');
    if (adminBtn) {
      adminBtn.classList.add('visible');
    }
  }
});