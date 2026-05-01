// Loading States and Client-side Validation Utilities

class LoadingManager {
  constructor() {
    this.loadingElements = new Map();
    this.globalLoading = false;
  }

  // Show loading state for a specific element
  showElementLoading(element, options = {}) {
    const {
      text = 'Loading...',
      spinnerSize = 'small',
      overlay = false
    } = options;

    const loadingId = this.generateLoadingId();
    const originalContent = element.innerHTML;
    
    this.loadingElements.set(loadingId, {
      element,
      originalContent
    });

    if (overlay) {
      element.classList.add('form-loading');
    } else {
      const spinnerHTML = `
        <span class="loading-spinner ${spinnerSize}"></span>
        <span class="loading-text">${text}</span>
      `;
      element.innerHTML = spinnerHTML;
      element.classList.add('loading');
    }

    return loadingId;
  }

  // Hide loading state for a specific element
  hideElementLoading(loadingId) {
    const loadingData = this.loadingElements.get(loadingId);
    if (loadingData) {
      const { element, originalContent } = loadingData;
      element.innerHTML = originalContent;
      element.classList.remove('loading', 'form-loading');
      this.loadingElements.delete(loadingId);
    }
  }

  // Show global loading overlay
  showGlobalLoading(text = 'Loading...') {
    if (this.globalLoading) return;
    
    this.globalLoading = true;
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.id = 'global-loading-overlay';
    overlay.innerHTML = `
      <div class="spinner-container">
        <div class="loading-spinner large"></div>
        <div class="loading-text">${text}</div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
  }

  // Hide global loading overlay
  hideGlobalLoading() {
    const overlay = document.getElementById('global-loading-overlay');
    if (overlay) {
      overlay.remove();
      document.body.style.overflow = '';
    }
    this.globalLoading = false;
  }

  // Show button loading state
  showButtonLoading(button, originalText) {
    button.classList.add('loading');
    button.disabled = true;
    button.innerHTML = `
      <span class="loading-spinner small"></span>
      <span class="btn-text">${originalText}</span>
    `;
  }

  // Hide button loading state
  hideButtonLoading(button, originalText) {
    button.classList.remove('loading');
    button.disabled = false;
    button.innerHTML = originalText;
  }

  generateLoadingId() {
    return 'loading_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
}

class FormValidator {
  constructor() {
    this.rules = new Map();
    this.errors = new Map();
  }

  // Add validation rule
  addRule(fieldName, rule) {
    if (!this.rules.has(fieldName)) {
      this.rules.set(fieldName, []);
    }
    this.rules.get(fieldName).push(rule);
  }

  // Validate a single field
  validateField(fieldName, value) {
    const fieldRules = this.rules.get(fieldName) || [];
    const errors = [];

    for (const rule of fieldRules) {
      const result = rule(value);
      if (result !== true) {
        errors.push(result);
      }
    }

    if (errors.length > 0) {
      this.errors.set(fieldName, errors);
      return false;
    } else {
      this.errors.delete(fieldName);
      return true;
    }
  }

  // Validate entire form
  validateForm(formData) {
    let isValid = true;
    this.errors.clear();

    for (const [fieldName, rules] of this.rules) {
      const value = formData.get(fieldName) || formData[fieldName] || '';
      if (!this.validateField(fieldName, value)) {
        isValid = false;
      }
    }

    return isValid;
  }

  // Get all errors
  getErrors() {
    return Object.fromEntries(this.errors);
  }

  // Get field errors
  getFieldErrors(fieldName) {
    return this.errors.get(fieldName) || [];
  }

  // Clear all errors
  clearErrors() {
    this.errors.clear();
  }

  // Clear field errors
  clearFieldErrors(fieldName) {
    this.errors.delete(fieldName);
  }

  // Common validation rules
  static rules = {
    required: (message = 'This field is required') => {
      return (value) => {
        if (!value || value.toString().trim() === '') {
          return message;
        }
        return true;
      };
    },

    email: (message = 'Please enter a valid email address') => {
      return (value) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (value && !emailRegex.test(value)) {
          return message;
        }
        return true;
      };
    },

    minLength: (min, message) => {
      return (value) => {
        if (value && value.length < min) {
          return message || `Minimum ${min} characters required`;
        }
        return true;
      };
    },

    maxLength: (max, message) => {
      return (value) => {
        if (value && value.length > max) {
          return message || `Maximum ${max} characters allowed`;
        }
        return true;
      };
    },

    phone: (message = 'Please enter a valid phone number') => {
      return (value) => {
        const phoneRegex = /^[0-9]{10}$/;
        if (value && !phoneRegex.test(value.replace(/\D/g, ''))) {
          return message;
        }
        return true;
      };
    },

    numeric: (message = 'Please enter a valid number') => {
      return (value) => {
        if (value && isNaN(value)) {
          return message;
        }
        return true;
      };
    },

    positive: (message = 'Please enter a positive number') => {
      return (value) => {
        if (value && (isNaN(value) || parseFloat(value) <= 0)) {
          return message;
        }
        return true;
      };
    },

    zipCode: (message = 'Please enter a valid ZIP code') => {
      return (value) => {
        const zipRegex = /^[0-9]{6}$/;
        if (value && !zipRegex.test(value)) {
          return message;
        }
        return true;
      };
    }
  };
}

class ToastManager {
  constructor() {
    this.container = null;
    this.toasts = new Map();
    this.init();
  }

  init() {
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    document.body.appendChild(this.container);
  }

  show(message, type = 'info', duration = 5000) {
    const toastId = this.generateToastId();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div class="toast-content">
        <div class="toast-message">${message}</div>
        <button class="toast-close" onclick="toastManager.hide('${toastId}')">&times;</button>
      </div>
    `;

    this.container.appendChild(toast);
    this.toasts.set(toastId, toast);

    // Auto-hide after duration
    setTimeout(() => {
      this.hide(toastId);
    }, duration);

    return toastId;
  }

  hide(toastId) {
    const toast = this.toasts.get(toastId);
    if (toast) {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => {
        toast.remove();
        this.toasts.delete(toastId);
      }, 300);
    }
  }

  success(message, duration) {
    return this.show(message, 'success', duration);
  }

  error(message, duration) {
    return this.show(message, 'error', duration);
  }

  warning(message, duration) {
    return this.show(message, 'warning', duration);
  }

  info(message, duration) {
    return this.show(message, 'info', duration);
  }

  generateToastId() {
    return 'toast_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
}

// Form helper utilities
class FormHelper {
  static serializeForm(form) {
    const formData = new FormData(form);
    const data = {};
    for (const [key, value] of formData) {
      data[key] = value;
    }
    return data;
  }

  static clearForm(form) {
    form.reset();
    // Clear any validation errors
    const errorElements = form.querySelectorAll('.error-message');
    errorElements.forEach(el => el.remove());
    
    const invalidInputs = form.querySelectorAll('.is-invalid');
    invalidInputs.forEach(input => input.classList.remove('is-invalid'));
  }

  static showFieldError(field, message) {
    // Remove existing error
    this.clearFieldError(field);
    
    // Add error class
    field.classList.add('is-invalid');
    
    // Create error message
    const errorElement = document.createElement('div');
    errorElement.className = 'error-message text-danger small mt-1';
    errorElement.textContent = message;
    
    // Insert error message after field
    field.parentNode.insertBefore(errorElement, field.nextSibling);
  }

  static clearFieldError(field) {
    field.classList.remove('is-invalid');
    const existingError = field.parentNode.querySelector('.error-message');
    if (existingError) {
      existingError.remove();
    }
  }

  static showFormErrors(errors) {
    for (const [fieldName, messages] of Object.entries(errors)) {
      const field = document.querySelector(`[name="${fieldName}"]`);
      if (field) {
        this.showFieldError(field, messages[0]); // Show first error message
      }
    }
  }

  static clearFormErrors(form) {
    const errorElements = form.querySelectorAll('.error-message');
    errorElements.forEach(el => el.remove());
    
    const invalidInputs = form.querySelectorAll('.is-invalid');
    invalidInputs.forEach(input => input.classList.remove('is-invalid'));
  }
}

// Image loading utilities
class ImageLoader {
  static loadImageWithFallback(img, fallbackUrl = '/images/placeholder-plant.jpg') {
    return new Promise((resolve, reject) => {
      const tempImg = new Image();
      
      tempImg.onload = () => {
        img.src = tempImg.src;
        img.classList.remove('img-loading');
        resolve(img);
      };
      
      tempImg.onerror = () => {
        if (fallbackUrl && img.src !== fallbackUrl) {
          img.src = fallbackUrl;
          resolve(img);
        } else {
          img.classList.add('img-error');
          reject(new Error('Image failed to load'));
        }
      };
      
      img.classList.add('img-loading');
      tempImg.src = img.src;
    });
  }

  static preloadImages(urls) {
    const promises = urls.map(url => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });
    });
    
    return Promise.allSettled(promises);
  }
}

// Theme Management
class ThemeManager {
  constructor() {
    this.theme = localStorage.getItem('theme');
    
    // If no saved theme, check system preference
    if (!this.theme) {
      this.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    
    this.init();
  }

  init() {
    // Apply theme immediately
    this.applyTheme();

    // Bound version of toggleTheme for event listeners
    this.handleToggle = (e) => {
      e.preventDefault();
      this.toggleTheme();
    };

    // Setup event listeners for all toggle buttons (handle multiple if they exist)
    const setupToggles = () => {
      const toggleBtns = document.querySelectorAll('#themeToggle, .theme-toggle-btn');
      toggleBtns.forEach(btn => {
        // Remove old listener if any and add new one
        btn.removeEventListener('click', this.handleToggle);
        btn.addEventListener('click', this.handleToggle);
      });
    };

    // Run once and also on DOMContentLoaded to ensure we catch all buttons
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupToggles);
    } else {
      setupToggles();
    }

    // Watch for system preference changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      if (!localStorage.getItem('theme')) {
        this.theme = e.matches ? 'dark' : 'light';
        this.applyTheme();
      }
    });
  }

  toggleTheme() {
    this.theme = this.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', this.theme);
    this.applyTheme();
    console.log('Theme toggled to:', this.theme);
  }

  applyTheme() {
    document.documentElement.setAttribute('data-theme', this.theme);
    document.body.setAttribute('data-theme', this.theme); // Fallback for some CSS selectors
    
    // Update all toggle buttons on the page
    const toggleBtns = document.querySelectorAll('#themeToggle, .theme-toggle-btn');
    toggleBtns.forEach(btn => {
      const darkIcon = btn.querySelector('.theme-icon-dark');
      const lightIcon = btn.querySelector('.theme-icon-light');
      
      if (darkIcon && lightIcon) {
        if (this.theme === 'dark') {
          darkIcon.classList.add('d-none');
          lightIcon.classList.remove('d-none');
        } else {
          darkIcon.classList.remove('d-none');
          lightIcon.classList.add('d-none');
        }
      }
    });
  }
}

// Initialize global instances
const loadingManager = new LoadingManager();
const formValidator = new FormValidator();
const toastManager = new ToastManager();
const themeManager = new ThemeManager();

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LoadingManager,
    FormValidator,
    ToastManager,
    FormHelper,
    ImageLoader,
    ThemeManager,
    loadingManager,
    formValidator,
    toastManager,
    themeManager
  };
}
