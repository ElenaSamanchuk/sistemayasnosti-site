// Один наблюдатель на страницу, изображения остаются загруженными после первого появления.
let observer;

function markReady(element) {
  element.setAttribute('data-background-ready', '');
}

export const deferBackground = {
  mounted(element, { value }) {
    if (!value) return;
    if (typeof IntersectionObserver === 'undefined') {
      markReady(element);
      return;
    }
    observer ||= new IntersectionObserver((entries) => {
      for (const { isIntersecting, target } of entries) {
        if (!isIntersecting) continue;
        markReady(target);
        observer.unobserve(target);
      }
    }, { rootMargin: '300px 0px' });
    observer.observe(element);
  },
  unmounted(element) {
    observer?.unobserve(element);
  },
};
