<script setup>
// Встроенный блок T123: компонент подгружается только в браузере, на сервере места не занимает.
import { defineAsyncComponent, onMounted, shallowRef } from 'vue';
const props = defineProps({ entry: Object, rec: String });
const component = shallowRef(null);
onMounted(() => { component.value = defineAsyncComponent(props.entry.load); });
</script>
<template><div v-if="entry.reserve" class="embed-reserve" hidden></div><component :is="component" v-if="component" v-bind="entry.props || {}" /></template>
