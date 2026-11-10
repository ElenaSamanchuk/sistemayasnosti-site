import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
const seed = document.getElementById('site-page');
const layoutSeed = document.getElementById('site-layout');
createApp(App, { initialPage: seed ? JSON.parse(seed.textContent) : undefined, initialLayout: layoutSeed ? JSON.parse(layoutSeed.textContent) : undefined }).mount('#app');
