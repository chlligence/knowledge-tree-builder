/**
 * parser.js — Markdown Checklist → Hierarchical JSON Tree
 *
 * Parses standard markdown unordered lists with checkboxes and
 * custom #key:value tags into a tree structure for D3 rendering.
 */

/**
 * Color mapping for named colors so users can write #color:red instead of hex.
 */
const COLOR_MAP = {
  red: '#ff3b30',
  green: '#34c759',
  blue: '#0071e3',
  emerald: '#34c759',
  amber: '#ff9f0a',
  orange: '#ff9f0a',
  purple: '#af52de',
  pink: '#ff2d55',
  teal: '#5ac8fa',
  indigo: '#5856d6',
  cyan: '#32d2e2',
  yellow: '#ffcc00',
}

/**
 * Parse a single line into a node object.
 * Returns null for lines that don't match the checklist pattern.
 *
 * @param {string} line - A single line of text
 * @param {number} lineIndex - 0-based line number
 * @returns {object|null} Parsed node or null
 */
function parseLine(line, lineIndex) {
  // Match: leading spaces, then `- [x]` or `- [ ]`, then the rest
  const match = line.match(/^(\s*)- \[([ xX])\]\s+(.+)$/)
  if (!match) return null

  const [, indent, check, rest] = match
  const depth = Math.floor(indent.length / 2) // 2-space indentation
  const completed = check.toLowerCase() === 'x'

  // Extract all #key:value tags
  const tags = {}
  const tagRegex = /#(\w+):(\S+)/g
  let tagMatch
  while ((tagMatch = tagRegex.exec(rest)) !== null) {
    const [, key, value] = tagMatch
    tags[key.toLowerCase()] = value
  }

  // Strip tags from the display text
  const text = rest.replace(/#\w+:\S+/g, '').trim()

  // Resolve named color
  if (tags.color) {
    tags.color = COLOR_MAP[tags.color.toLowerCase()] || tags.color
  }

  return {
    id: `node-${lineIndex}`,
    text,
    completed,
    depth,
    tags,
    children: [],
  }
}

/**
 * Parse the full markdown text into a hierarchical tree object.
 *
 * @param {string} markdown - Raw markdown text
 * @returns {object} Root node of the tree
 */
export function parseMarkdown(markdown) {
  const lines = markdown.split('\n')
  const root = {
    id: 'root',
    text: 'Tasks',
    completed: false,
    depth: -1,
    tags: {},
    children: [],
  }

  // Stack to keep track of parent nodes at each depth
  const stack = [root]

  for (let i = 0; i < lines.length; i++) {
    const node = parseLine(lines[i], i)
    if (!node) continue

    // Pop stack until we find a parent with depth < current node depth
    while (stack.length > 1 && stack[stack.length - 1].depth >= node.depth) {
      stack.pop()
    }

    const parent = stack[stack.length - 1]
    parent.children.push(node)
    stack.push(node)
  }

  return root
}

/**
 * Count completed and total tasks.
 *
 * @param {object} tree - The parsed tree
 * @returns {{ completed: number, total: number }}
 */
export function countTasks(tree) {
  let completed = 0
  let total = 0

  function walk(node) {
    if (node.id !== 'root') {
      total++
      if (node.completed) completed++
    }
    if (node.children) {
      node.children.forEach(walk)
    }
  }

  walk(tree)
  return { completed, total }
}
