'use strict';
// One desktop router. Business views and Store are shared by the module window.
window.DNSDesktop.start();
window.addEventListener('pagehide', () => window.DNSDesktop.destroy(), { once: true });
