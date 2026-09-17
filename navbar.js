/**
 * Phoenix Club — Core Interactions & UI Behaviors
 * Navrachana University Student Community
 */

// Immediate theme application to eliminate flash
(function () {
  const savedTheme = localStorage.getItem('phoenix-theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
})();

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  /* ==========================================================================
     0. Theme Switcher (White & Dark Mode)
     ========================================================================== */
  function initThemeToggle() {
    let currentTheme = document.documentElement.getAttribute('data-theme') || 'light';

    const sunIconSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
    const moonIconSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

    function updateButtonUI(btn) {
      if (!btn) return;
      if (currentTheme === 'dark') {
        btn.innerHTML = '<span class="theme-icon">' + sunIconSvg + '</span><span class="theme-label">Light</span>';
        btn.setAttribute('title', 'Switch to Light Mode');
        btn.setAttribute('aria-label', 'Switch to Light Mode');
      } else {
        btn.innerHTML = '<span class="theme-icon">' + moonIconSvg + '</span><span class="theme-label">Dark</span>';
        btn.setAttribute('title', 'Switch to Dark Mode');
        btn.setAttribute('aria-label', 'Switch to Dark Mode');
      }
    }

    let toggleBtn = document.getElementById('themeToggleBtn');
    if (!toggleBtn) {
      const navRight = document.querySelector('.navbar-right');
      if (navRight) {
        toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'theme-toggle-btn';
        toggleBtn.id = 'themeToggleBtn';
        const navToggle = navRight.querySelector('.navbar-toggle');
        navRight.insertBefore(toggleBtn, navToggle || navRight.firstChild);
      }
    }

    if (toggleBtn) {
      updateButtonUI(toggleBtn);
      toggleBtn.addEventListener('click', function () {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', currentTheme);
        localStorage.setItem('phoenix-theme', currentTheme);
        updateButtonUI(toggleBtn);
        if (window.showToast) {
          window.showToast(currentTheme === 'dark' ? 'Dark theme enabled' : 'Light theme enabled', 1800);
        }
      });
    }
  }
  initThemeToggle();

  /* ==========================================================================
     1. Navigation & Dropdowns
     ========================================================================== */
  const toggleBtn = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  const dropdowns = document.querySelectorAll('.dropdown');
  const BREAKPOINT = 1100;

  function closeAllDropdowns(except) {
    dropdowns.forEach(function (dd) {
      if (dd !== except) {
        dd.classList.remove('open');
        const trigger = dd.querySelector('.dropdown-toggle');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function closeMobileMenu() {
    if (navLinks) navLinks.classList.remove('active');
    if (toggleBtn) {
      toggleBtn.classList.remove('active');
      toggleBtn.setAttribute('aria-expanded', 'false');
    }
    closeAllDropdowns();
  }

  // Hamburger Toggle
  if (toggleBtn && navLinks) {
    toggleBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      const isActive = navLinks.classList.toggle('active');
      toggleBtn.classList.toggle('active', isActive);
      toggleBtn.setAttribute('aria-expanded', String(isActive));
      if (!isActive) closeAllDropdowns();
    });
  }

  // Dropdown Click Handlers (Touch & Keyboard support)
  dropdowns.forEach(function (dd) {
    const trigger = dd.querySelector('.dropdown-toggle');
    if (trigger) {
      trigger.addEventListener('click', function (e) {
        // Only prevent default on mobile or when expanding dropdown
        if (window.innerWidth <= BREAKPOINT || trigger.getAttribute('href') === '#') {
          e.preventDefault();
        }
        const willOpen = !dd.classList.contains('open');
        closeAllDropdowns(dd);
        dd.classList.toggle('open', willOpen);
        trigger.setAttribute('aria-expanded', String(willOpen));
      });
    }
  });

  // Close menus on outside click
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.navbar')) {
      closeMobileMenu();
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeMobileMenu();
      closeLightbox();
    }
  });

  // Resize listener
  window.addEventListener('resize', function () {
    if (window.innerWidth > BREAKPOINT) {
      closeMobileMenu();
    }
  });

  // Active Link Highlighting based on current file
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  const allNavLinks = document.querySelectorAll('.navbar-links a:not(.dropdown-toggle)');
  allNavLinks.forEach(function (link) {
    const href = link.getAttribute('href');
    if (href && (href === currentPath || (currentPath === '' && href === 'index.html'))) {
      link.classList.add('current');
      // If inside dropdown, also highlight dropdown parent
      const parentDropdown = link.closest('.dropdown');
      if (parentDropdown) {
        const toggle = parentDropdown.querySelector('.dropdown-toggle');
        if (toggle) toggle.classList.add('current');
      }
    }
  });

  // Close mobile drawer when clicking any nav link
  allNavLinks.forEach(function (link) {
    link.addEventListener('click', function () {
      if (window.innerWidth <= BREAKPOINT) {
        closeMobileMenu();
      }
    });
  });

  /* ==========================================================================
     2. Featured Events Carousel
     ========================================================================== */
  const slides = document.querySelectorAll('.carousel-slide');
  const dots = document.querySelectorAll('.carousel-dot');
  const prevBtn = document.querySelector('.carousel-control.prev');
  const nextBtn = document.querySelector('.carousel-control.next');
  const carouselElem = document.querySelector('.events-carousel, .carousel-container');

  if (slides.length > 0) {
    let currentIndex = 0;
    let autoRotateTimer = null;
    let isPaused = false;

    function showSlide(index) {
      currentIndex = (index + slides.length) % slides.length;

      slides.forEach(function (slide, idx) {
        slide.classList.toggle('active', idx === currentIndex);
      });

      dots.forEach(function (dot, idx) {
        dot.classList.toggle('active', idx === currentIndex);
      });
    }

    function startAutoRotate() {
      if (autoRotateTimer) clearInterval(autoRotateTimer);
      autoRotateTimer = setInterval(function () {
        if (!isPaused) {
          showSlide(currentIndex + 1);
        }
      }, 4500);
    }

    function pauseAutoRotate() {
      isPaused = true;
    }

    function resumeAutoRotate() {
      isPaused = false;
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        showSlide(currentIndex - 1);
        startAutoRotate();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        showSlide(currentIndex + 1);
        startAutoRotate();
      });
    }

    dots.forEach(function (dot, idx) {
      dot.addEventListener('click', function () {
        showSlide(idx);
        startAutoRotate();
      });
    });

    if (carouselElem) {
      carouselElem.addEventListener('mouseenter', pauseAutoRotate);
      carouselElem.addEventListener('mouseleave', resumeAutoRotate);

      // Touch swipe support for mobile
      let touchStartX = 0;
      let touchEndX = 0;

      carouselElem.addEventListener('touchstart', function (e) {
        touchStartX = e.changedTouches[0].screenX;
      }, { passive: true });

      carouselElem.addEventListener('touchend', function (e) {
        touchEndX = e.changedTouches[0].screenX;
        const diff = touchStartX - touchEndX;
        if (Math.abs(diff) > 40) {
          if (diff > 0) {
            showSlide(currentIndex + 1); // Swipe left -> Next
          } else {
            showSlide(currentIndex - 1); // Swipe right -> Prev
          }
          startAutoRotate();
        }
      }, { passive: true });
    }

    showSlide(0);
    startAutoRotate();
  }

  /* ==========================================================================
     3. Scroll Reveal Animations (IntersectionObserver)
     ========================================================================== */
  const revealElements = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window && revealElements.length > 0) {
    const revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.12,
      rootMargin: '0px 0px -40px 0px'
    });

    revealElements.forEach(function (el) {
      revealObserver.observe(el);
    });
  } else {
    revealElements.forEach(function (el) {
      el.classList.add('visible');
    });
  }

  /* ==========================================================================
     4. Floating Back to Top Button
     ========================================================================== */
  let backToTopBtn = document.querySelector('.back-to-top');
  if (!backToTopBtn) {
    backToTopBtn = document.createElement('button');
    backToTopBtn.className = 'back-to-top';
    backToTopBtn.setAttribute('aria-label', 'Scroll back to top');
    backToTopBtn.innerHTML = '&#8593;';
    document.body.appendChild(backToTopBtn);
  }

  window.addEventListener('scroll', function () {
    if (window.scrollY > 350) {
      backToTopBtn.classList.add('show');
    } else {
      backToTopBtn.classList.remove('show');
    }
  }, { passive: true });

  backToTopBtn.addEventListener('click', function () {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });

  /* ==========================================================================
     5. Toast Notification System (Copy to Clipboard)
     ========================================================================== */
  let toastElem = document.querySelector('.toast-message');
  if (!toastElem) {
    toastElem = document.createElement('div');
    toastElem.className = 'toast-message';
    toastElem.setAttribute('role', 'status');
    toastElem.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastElem);
  }

  window.showToast = function (message, duration) {
    toastElem.textContent = message;
    toastElem.classList.add('show');
    setTimeout(function () {
      toastElem.classList.remove('show');
    }, duration || 2500);
  };

  // Attach to email/phone links with [data-copy]
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      const textToCopy = this.getAttribute('data-copy');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textToCopy).then(function () {
          window.showToast('Copied to clipboard: ' + textToCopy);
        }).catch(function () {
          window.showToast(textToCopy);
        });
      } else {
        window.showToast(textToCopy);
      }
    });
  });

  /* ==========================================================================
     6. Lightbox for Photo Galleries
     ========================================================================== */
  let lightbox = document.getElementById('phoenixLightbox');
  if (!lightbox) {
    lightbox = document.createElement('div');
    lightbox.id = 'phoenixLightbox';
    lightbox.className = 'phoenix-lightbox';
    lightbox.innerHTML = `
      <div class="lightbox-overlay"></div>
      <div class="lightbox-dialog">
        <button class="lightbox-close" aria-label="Close image preview">&times;</button>
        <img class="lightbox-img" src="" alt="Enlarged view" />
        <p class="lightbox-caption"></p>
      </div>
    `;
    document.body.appendChild(lightbox);

    // Style for lightbox
    const style = document.createElement('style');
    style.textContent = `
      .phoenix-lightbox {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.25s ease, visibility 0.25s;
      }
      .phoenix-lightbox.active {
        opacity: 1;
        visibility: visible;
      }
      .lightbox-overlay {
        position: absolute;
        inset: 0;
        background: rgba(15, 23, 42, 0.88);
        backdrop-filter: blur(8px);
      }
      .lightbox-dialog {
        position: relative;
        z-index: 10;
        max-width: 90vw;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .lightbox-close {
        position: absolute;
        top: -44px;
        right: 0;
        color: #fff;
        font-size: 32px;
        background: none;
        border: none;
        cursor: pointer;
      }
      .lightbox-img {
        max-width: 90vw;
        max-height: 80vh;
        border-radius: 12px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        object-fit: contain;
      }
      .lightbox-caption {
        color: #fff;
        margin-top: 12px;
        font-size: 0.95rem;
        font-weight: 600;
        text-align: center;
      }
    `;
    document.head.appendChild(style);

    const closeBtn = lightbox.querySelector('.lightbox-close');
    const overlay = lightbox.querySelector('.lightbox-overlay');

    function closeLightbox() {
      lightbox.classList.remove('active');
    }

    if (closeBtn) closeBtn.addEventListener('click', closeLightbox);
    if (overlay) overlay.addEventListener('click', closeLightbox);
  }

  function openLightbox(src, caption) {
    const img = lightbox.querySelector('.lightbox-img');
    const cap = lightbox.querySelector('.lightbox-caption');
    if (img) img.src = src;
    if (cap) cap.textContent = caption || '';
    lightbox.classList.add('active');
  }

  // Dynamic Lightbox event delegation (works automatically for any newly added cards or photos!)
  document.addEventListener('click', function (e) {
    const trigger = e.target.closest('.lightbox-trigger, .member-photo img, .slide-image, .event-photo img, .gallery-photo img, [data-lightbox]');
    if (!trigger) return;

    // Prevent default navigation if wrapped in an image link
    const parentLink = trigger.closest('a');
    if (parentLink && (/\.(png|jpe?g|webp|svg)($|\?)/i.test(parentLink.href) || parentLink.href.includes('images/'))) {
      e.preventDefault();
    }

    const imgSrc = trigger.getAttribute('src');
    const caption = trigger.getAttribute('alt') || '';
    if (imgSrc) {
      openLightbox(imgSrc, caption);
    }
  });

  /* ==========================================================================
     7. Image Error Fallback & Resilience
     If a user adds or changes an image path in HTML and the image is missing or
     mistyped, gracefully render a branded Phoenix Member avatar card so the
     layout never breaks or collapses.
     ========================================================================== */
  window.addEventListener('error', function (e) {
    if (e.target && e.target.tagName === 'IMG') {
      const img = e.target;
      if (img.dataset.fallbackApplied) return;
      img.dataset.fallbackApplied = 'true';

      const container = img.closest('.member-photo, .team-card, .small-card, .event-photo, .gallery-photo');
      if (container) {
        container.classList.add('img-fallback-active');
        img.style.display = 'none';

        const alt = img.getAttribute('alt') || 'Phoenix Club';
        const cleanName = alt.split('-')[0].trim() || 'Club Member';
        const initials = cleanName
          .split(' ')
          .filter(Boolean)
          .slice(0, 2)
          .map(function (w) { return w[0]; })
          .join('')
          .toUpperCase() || 'PX';

        const placeholder = document.createElement('div');
        placeholder.className = 'img-placeholder-avatar';
        placeholder.innerHTML = `
          <div class="placeholder-initials">${initials}</div>
          <span class="placeholder-tag">${cleanName}</span>
          <span class="placeholder-sub">Photo updating soon</span>
        `;
        container.insertBefore(placeholder, container.firstChild);
        console.warn('[Phoenix Club] Image failed to load:', img.src, '— Rendered styled avatar for:', cleanName);
      }
    }
  }, true);

  // Current year in footer
  const yearNode = document.getElementById('year');
  if (yearNode) {
    yearNode.textContent = new Date().getFullYear();
  }
});
