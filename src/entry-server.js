import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import App from './App.vue';
export async function render(page, layout) { return renderToString(createSSRApp(App, { initialPage: page, initialLayout: layout })); }
