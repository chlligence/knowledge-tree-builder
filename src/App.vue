<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { parseMarkdown, countTasks } from './parser.js'
import { useTreeRenderer } from './useTreeRenderer.js'
import { DEFAULT_MARKDOWN } from './defaults.js'

// ─── Constants ───
const STORAGE_KEY = 'task-viz-markdown'
const DEBOUNCE_MS = 300

// ─── State ───
const markdownText = ref('')
const treeData = ref(null)
const canvasRef = ref(null)
const isSaved = ref(true)
const editorPaneWidth = ref(50) // percentage
const isDragging = ref(false)

// ─── Tree Renderer ───
const {
  zoomLevel,
  zoomIn,
  zoomOut,
  resetZoom,
  render: renderTree,
  fitView,
  initSvg,
} = useTreeRenderer(canvasRef, treeData)

// ─── Computed ───
const taskStats = computed(() => {
  if (!treeData.value) return { completed: 0, total: 0 }
  return countTasks(treeData.value)
})

// ─── Debounced Parse ───
let debounceTimer = null

function onTextInput(event) {
  markdownText.value = event.target.value
  scheduleParseAndSave()
}

function scheduleParseAndSave() {
  isSaved.value = false
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    parseAndRender()
    saveToStorage()
  }, DEBOUNCE_MS)
}

/**
 * Programmatically update textarea value & cursor, then trigger parse.
 */
function updateTextarea(el, newValue, cursorPos) {
  markdownText.value = newValue
  // Vue :value binding needs a tick to flush
  nextTick(() => {
    el.value = newValue
    el.selectionStart = cursorPos
    el.selectionEnd = cursorPos
  })
  scheduleParseAndSave()
}

// ─── Smart Keyboard Shortcuts ───
function onKeyDown(event) {
  const el = event.target
  const { value, selectionStart } = el

  // ── Enter: auto-continue checklist ──
  if (event.key === 'Enter') {
    // Find the current line
    const before = value.substring(0, selectionStart)
    const after = value.substring(selectionStart)
    const lastNewline = before.lastIndexOf('\n')
    const currentLine = before.substring(lastNewline + 1)

    // Match checklist pattern: leading spaces + - [ ] or - [x]
    const match = currentLine.match(/^(\s*)- \[[ xX]\]\s*(.*)/)
    if (match) {
      event.preventDefault()
      const [, indent, content] = match

      if (content.trim() === '') {
        // Empty checklist line → clear it (remove the `- [ ] ` part)
        const lineStart = lastNewline + 1
        const newValue = value.substring(0, lineStart) + after
        updateTextarea(el, newValue, lineStart)
      } else {
        // Continue with same indent + new checkbox
        const insertion = `\n${indent}- [ ] `
        const newValue = before + insertion + after
        const newCursor = selectionStart + insertion.length
        updateTextarea(el, newValue, newCursor)
      }
      return
    }
  }

  // ── Tab / Shift+Tab: indent/unindent ──
  if (event.key === 'Tab') {
    event.preventDefault()
    const before = value.substring(0, selectionStart)
    const after = value.substring(selectionStart)
    const lastNewline = before.lastIndexOf('\n')
    const lineStart = lastNewline + 1
    const currentLine = before.substring(lineStart)

    if (event.shiftKey) {
      // Unindent: remove up to 2 leading spaces
      const stripped = currentLine.replace(/^ {1,2}/, '')
      const removed = currentLine.length - stripped.length
      const newValue = value.substring(0, lineStart) + stripped + after
      updateTextarea(el, newValue, Math.max(lineStart, selectionStart - removed))
    } else {
      // Indent: add 2 spaces at line start
      const newValue = value.substring(0, lineStart) + '  ' + currentLine + after
      updateTextarea(el, newValue, selectionStart + 2)
    }
    return
  }
}

function parseAndRender() {
  treeData.value = parseMarkdown(markdownText.value)
}

// ─── LocalStorage ───
function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, markdownText.value)
    isSaved.value = true
  } catch (e) {
    console.warn('Failed to save to localStorage:', e)
  }
}

function loadFromStorage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null && stored.trim().length > 0) {
      return stored
    }
  } catch (e) {
    console.warn('Failed to load from localStorage:', e)
  }
  return null
}

// ─── Split Pane Drag ───
function startDrag(event) {
  event.preventDefault()
  isDragging.value = true

  const startX = event.clientX
  const startWidth = editorPaneWidth.value
  const containerWidth = document.querySelector('.main-content').clientWidth

  function onMouseMove(e) {
    const dx = e.clientX - startX
    const newWidth = startWidth + (dx / containerWidth) * 100
    editorPaneWidth.value = Math.max(20, Math.min(80, newWidth))
  }

  function onMouseUp() {
    isDragging.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    // Re-render tree after resize
    nextTick(() => {
      initSvg()
      renderTree()
    })
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// ─── Lifecycle ───
onMounted(async () => {
  // Load saved data or use default
  const stored = loadFromStorage()
  markdownText.value = stored || DEFAULT_MARKDOWN

  // If first time, save the default
  if (!stored) {
    saveToStorage()
  }

  // Wait for DOM to be fully laid out and sized
  await nextTick()

  // Re-initialize SVG (composable's onMounted may fire before canvas has size)
  initSvg()

  // Parse data into tree
  parseAndRender()

  // Wait again for Vue to process the treeData change
  await nextTick()

  // Explicitly render after everything is ready
  renderTree()
})
</script>

<template>
  <div class="app-container">
    <!-- Header -->
    <header class="app-header">
      <div class="app-logo">
        <div class="app-logo-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3v18M3 12h18M7.5 7.5l9 9M16.5 7.5l-9 9"/>
          </svg>
        </div>
        <span>Task Visualizer</span>
      </div>

      <div class="header-meta">
        <div class="save-indicator">
          <span class="save-dot" v-if="isSaved"></span>
          <span>{{ isSaved ? 'Saved' : 'Unsaved' }}</span>
        </div>
        <span style="opacity: 0.4">|</span>
        <span>{{ taskStats.completed }}/{{ taskStats.total }} tasks</span>
      </div>
    </header>

    <!-- Main Content -->
    <main class="main-content" :class="{ 'is-dragging': isDragging }">
      <!-- Editor Pane -->
      <section
        class="editor-pane"
        :style="{ width: editorPaneWidth + '%' }"
        id="editor-pane"
      >
        <div class="editor-toolbar">
          <span class="editor-toolbar-title">Editor</span>
          <div class="editor-stats">
            <span class="stat-badge">
              <span class="stat-dot completed"></span>
              {{ taskStats.completed }}
            </span>
            <span class="stat-badge">
              <span class="stat-dot pending"></span>
              {{ taskStats.total - taskStats.completed }}
            </span>
          </div>
        </div>

        <textarea
          class="editor-textarea"
          id="markdown-editor"
          :value="markdownText"
          @input="onTextInput"
          @keydown="onKeyDown"
          placeholder="Write your task list here using Markdown checkboxes...

Example:
- [ ] Task name #tag:Label
  - [x] Completed subtask #color:green
  - [ ] Pending subtask #priority:high"
          spellcheck="false"
        ></textarea>
      </section>

      <!-- Divider -->
      <div
        class="split-divider"
        :class="{ active: isDragging }"
        @mousedown="startDrag"
        id="split-divider"
      ></div>

      <!-- Visualizer Pane -->
      <section
        class="visualizer-pane"
        :style="{ width: (100 - editorPaneWidth) + '%' }"
        id="visualizer-pane"
      >
        <div class="visualizer-toolbar">
          <span class="visualizer-toolbar-title">Tree View</span>
          <div class="zoom-controls">
            <button class="zoom-btn" @click="zoomOut" title="Zoom Out" id="zoom-out-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
            <span class="zoom-level">{{ zoomLevel }}%</span>
            <button class="zoom-btn" @click="zoomIn" title="Zoom In" id="zoom-in-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
            <button class="zoom-btn" @click="resetZoom" title="Fit to View" id="fit-view-btn" style="margin-left: 4px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
              </svg>
            </button>
          </div>
        </div>

        <div
          class="visualizer-canvas"
          ref="canvasRef"
          id="tree-canvas"
        >
          <div
            v-if="taskStats.total === 0"
            class="empty-state"
          >
            <div class="empty-state-icon">🌳</div>
            <div class="empty-state-text">
              Type tasks in the editor to see<br/>your task tree here
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.is-dragging {
  user-select: none;
  cursor: col-resize !important;
}

.is-dragging * {
  cursor: col-resize !important;
}
</style>
