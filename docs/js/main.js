// Mobilní menu
const navToggle = document.getElementById('navToggle');
const navMenu = document.getElementById('navMenu');
const navLinks = document.querySelectorAll('.nav__link');
const header = document.getElementById('header');

navToggle.addEventListener('click', () => {
  const isOpen = navMenu.classList.toggle('nav__menu--open');
  navToggle.classList.toggle('nav__toggle--active', isOpen);
  navToggle.setAttribute('aria-expanded', isOpen);
});

navLinks.forEach(link => {
  link.addEventListener('click', () => {
    navMenu.classList.remove('nav__menu--open');
    navToggle.classList.remove('nav__toggle--active');
    navToggle.setAttribute('aria-expanded', 'false');
  });
});

// Sticky header efekt
window.addEventListener('scroll', () => {
  header.classList.toggle('header--scrolled', window.scrollY > 20);
}, { passive: true });

// Záložky ceníku
const tabs = document.querySelectorAll('.pricing__tab');
const panels = document.querySelectorAll('.pricing__panel');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;

    tabs.forEach(t => {
      t.classList.remove('pricing__tab--active');
      t.setAttribute('aria-selected', 'false');
    });
    tab.classList.add('pricing__tab--active');
    tab.setAttribute('aria-selected', 'true');

    panels.forEach(panel => {
      const isActive = panel.id === `tab-${target}`;
      panel.classList.toggle('pricing__panel--active', isActive);
      panel.hidden = !isActive;
    });
  });
});

// Plynulý scroll – sekce na střed obrazovky (pod hlavičkou)
function scrollSectionToView(element) {
  const headerHeight = header?.offsetHeight || 72;
  const sectionTop = element.getBoundingClientRect().top + window.scrollY;
  window.scrollTo({ top: Math.max(0, sectionTop - headerHeight), behavior: 'smooth' });
}

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', (e) => {
    const href = anchor.getAttribute('href');
    if (href === '#') return;

    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      scrollSectionToView(target);
    }
  });
});
