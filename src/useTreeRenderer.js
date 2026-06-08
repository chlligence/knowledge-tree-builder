/**
 * useTreeRenderer.js — D3.js tree rendering composable for Vue 3.
 *
 * Renders a hierarchical JSON tree as an interactive SVG tree graph
 * with zoom/pan, custom node styling based on tags, and smooth transitions.
 */

import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as d3 from 'd3'

// Design tokens mirrored from CSS
const COLORS = {
  accent: '#0071e3',
  accentLight: '#e8f2ff',
  emerald: '#34c759',
  emeraldLight: '#e8faf0',
  amber: '#ff9f0a',
  amberLight: '#fff8e8',
  red: '#ff3b30',
  redLight: '#ffe8e7',
  purple: '#af52de',
  purpleLight: '#f5e8ff',
  textPrimary: '#1d1d1f',
  textSecondary: '#6e6e73',
  textTertiary: '#aeaeb2',
  border: '#e5e7eb',
  bg: '#ffffff',
  nodePending: '#c7c7cc',
}

const STATUS_STYLES = {
  blocked: { color: COLORS.amber, bgColor: COLORS.amberLight, icon: '⚠' },
  active: { color: COLORS.accent, bgColor: COLORS.accentLight, icon: '●' },
  error: { color: COLORS.red, bgColor: COLORS.redLight, icon: '✕' },
}

const TAG_COLORS = {
  DevOps: { bg: '#eef2ff', text: '#4338ca' },
  RL: { bg: '#fdf2f8', text: '#be185d' },
  default: { bg: '#f3f4f6', text: '#4b5563' },
}

function getTagStyle(tagValue) {
  return TAG_COLORS[tagValue] || TAG_COLORS.default
}

/**
 * Count all descendants recursively (used for collapse indicator).
 */
function countDescendants(children) {
  let count = 0
  for (const child of children) {
    count++
    if (child.children) count += countDescendants(child.children)
    if (child._children) count += countDescendants(child._children)
  }
  return count
}

/**
 * Composable to manage D3 tree rendering.
 *
 * @param {import('vue').Ref} containerRef - Template ref of the SVG container div
 * @param {import('vue').Ref} treeData - Reactive parsed tree data
 */
export function useTreeRenderer(containerRef, treeData) {
  const zoomLevel = ref(100)
  let svg = null
  let g = null
  let linksLayer = null
  let nodesLayer = null
  let zoomBehavior = null
  let resizeObserver = null
  let isFirstRender = true
  const collapsedNodes = new Set()  // Track collapsed node IDs

  /**
   * Initialize the SVG and zoom behavior.
   */
  function initSvg() {
    const container = containerRef.value
    if (!container) return

    // Clear previous SVG
    d3.select(container).selectAll('svg').remove()

    const width = container.clientWidth
    const height = container.clientHeight

    svg = d3.select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', `0 0 ${width} ${height}`)

    // Defs for drop shadows and gradients
    const defs = svg.append('defs')

    // Subtle drop shadow for nodes
    const filter = defs.append('filter')
      .attr('id', 'node-shadow')
      .attr('x', '-50%')
      .attr('y', '-50%')
      .attr('width', '200%')
      .attr('height', '200%')
    filter.append('feDropShadow')
      .attr('dx', 0)
      .attr('dy', 1)
      .attr('stdDeviation', 2)
      .attr('flood-color', 'rgba(0,0,0,0.08)')

    // Strong glow for priority:high — vivid colored glow
    const glowFilter = defs.append('filter')
      .attr('id', 'priority-glow')
      .attr('x', '-150%')
      .attr('y', '-150%')
      .attr('width', '400%')
      .attr('height', '400%')
    glowFilter.append('feGaussianBlur')
      .attr('in', 'SourceGraphic')
      .attr('stdDeviation', 6)
      .attr('result', 'blur')
    glowFilter.append('feColorMatrix')
      .attr('in', 'blur')
      .attr('type', 'saturate')
      .attr('values', '3')
      .attr('result', 'saturated')
    glowFilter.append('feMerge')
      .selectAll('feMergeNode')
      .data(['saturated', 'saturated', 'SourceGraphic'])
      .enter()
      .append('feMergeNode')
      .attr('in', d => d)

    // Inject CSS animation for priority pulse (once per init)
    if (!document.getElementById('priority-pulse-style')) {
      const style = document.createElement('style')
      style.id = 'priority-pulse-style'
      style.textContent = `
        @keyframes priority-pulse {
          0%   { r: 14; opacity: 0.5; }
          50%  { r: 19; opacity: 0; }
          100% { r: 14; opacity: 0.5; }
        }
        .priority-pulse-ring {
          animation: priority-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
          transform-origin: center;
          pointer-events: none;
        }
      `
      document.head.appendChild(style)
    }

    g = svg.append('g')
    linksLayer = g.append('g').attr('class', 'links-layer')
    nodesLayer = g.append('g').attr('class', 'nodes-layer')

    zoomBehavior = d3.zoom()
      .scaleExtent([0.2, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
        zoomLevel.value = Math.round(event.transform.k * 100)
      })

    svg.call(zoomBehavior)

    // Disable double-click zoom
    svg.on('dblclick.zoom', null)
  }

  /**
   * Render (or re-render) the tree.
   */
  function render() {
    if (!g || !treeData.value) return

    const container = containerRef.value
    if (!container) return

    const width = container.clientWidth
    const height = container.clientHeight

    // Update viewBox
    svg.attr('viewBox', `0 0 ${width} ${height}`)

    // Build D3 hierarchy
    const root = d3.hierarchy(treeData.value)

    // If only root with no children, show empty
    if (!root.children || root.children.length === 0) {
      g.selectAll('*').remove()
      return
    }

    // Get the full max depth BEFORE pruning (for font scaling)
    const fullMaxDepth = root.height

    // Prune collapsed nodes: hide children of collapsed nodes
    root.each(node => {
      if (collapsedNodes.has(node.data.id) && node.children) {
        node._children = node.children  // stash
        node.children = null
      }
    })

    // Calculate dynamic sizing
    const visibleNodes = root.descendants()
    const leafCount = root.leaves().length
    const treeDepth = root.height

    // Dynamic spacing
    const nodeSpacingY = Math.max(38, Math.min(56, 400 / leafCount))
    const nodeSpacingX = Math.max(200, Math.min(300, width / (treeDepth + 2)))

    // Create tree layout (horizontal: x→vertical, y→horizontal)
    const treeLayout = d3.tree()
      .nodeSize([nodeSpacingY, nodeSpacingX])
      .separation((a, b) => a.parent === b.parent ? 1 : 1.2)

    treeLayout(root)

    // Center the tree
    const nodes = root.descendants()
    const minY = d3.min(nodes, d => d.x)
    const maxY = d3.max(nodes, d => d.x)
    const treeHeight = maxY - minY
    const offsetX = 80
    const offsetY = height / 2 - (minY + treeHeight / 2)

    // Transition duration
    const t = d3.transition().duration(500).ease(d3.easeCubicOut)

    // ─── Links ───
    const linkGenerator = d3.linkHorizontal()
      .x(d => d.y + offsetX)
      .y(d => d.x + offsetY)

    const links = linksLayer.selectAll('.tree-link')
      .data(root.links(), d => `${d.source.data.id}-${d.target.data.id}`)

    links.exit()
      .transition(t)
      .attr('opacity', 0)
      .remove()

    const linksEnter = links.enter()
      .append('path')
      .attr('class', 'tree-link')
      .attr('d', linkGenerator)
      .attr('opacity', 0)
      .attr('fill', 'none')
      .attr('stroke', COLORS.border)
      .attr('stroke-width', 1.5)

    links.merge(linksEnter)
      .transition(t)
      .attr('d', linkGenerator)
      .attr('opacity', 1)
      .attr('stroke', d => {
        if (d.target.data.completed) return COLORS.emerald + '60'
        return COLORS.border
      })

    // ─── Nodes ───
    const nodeGroups = nodesLayer.selectAll('.tree-node')
      .data(nodes.filter(d => d.data.id !== 'root'), d => d.data.id)

    nodeGroups.exit()
      .transition(t)
      .attr('opacity', 0)
      .remove()

    const nodeEnter = nodeGroups.enter()
      .append('g')
      .attr('class', 'tree-node')
      .attr('transform', d => `translate(${d.y + offsetX},${d.x + offsetY})`)
      .attr('opacity', 0)
      .style('cursor', 'pointer')

    const allNodes = nodeGroups.merge(nodeEnter)

    allNodes.transition(t)
      .attr('transform', d => `translate(${d.y + offsetX},${d.x + offsetY})`)
      .attr('opacity', 1)

    // Clear existing content in entering + updating nodes
    nodeEnter.each(function () { d3.select(this).selectAll('*').remove() })
    nodeGroups.each(function () { d3.select(this).selectAll('*').remove() })

    // Re-draw node contents
    allNodes.each(function (d) {
      const node = d3.select(this)
      const data = d.data
      const tags = data.tags || {}
      const isCompleted = data.completed
      const isPriorityHigh = tags.priority === 'high'
      const statusStyle = tags.status ? STATUS_STYLES[tags.status] : null
      const customColor = tags.color || null
      const isCollapsed = collapsedNodes.has(data.id)
      const hasChildren = !!(d.children || d._children)

      // ── Depth-based font size: larger near root, 12px at leaves ──
      // d.depth: 1 = first visible level (root is 0 but skipped)
      // fullMaxDepth: total tree height
      const depthFromLeaf = Math.max(0, fullMaxDepth - d.depth)
      const fontSize = 12 + depthFromLeaf * 2  // 12px at leaves, +2px per level up
      const fontWeight = d.depth <= 1 ? '700' : d.depth <= 2 ? '600' : '500'

      // Determine node color
      let fillColor = isCompleted ? COLORS.accent : COLORS.bg
      let strokeColor = isCompleted ? COLORS.accent : COLORS.nodePending
      let strokeWidth = 2

      if (customColor) {
        fillColor = isCompleted ? customColor : COLORS.bg
        strokeColor = customColor
      }

      if (statusStyle) {
        strokeColor = statusStyle.color
        if (!isCompleted) fillColor = COLORS.bg
      }

      if (isPriorityHigh) {
        strokeWidth = 3.5
      }

      // Scale radius slightly by depth
      const radius = Math.max(5, 8 - d.depth * 0.5)

      // Glow rings for priority:high — animated pulse + static glow
      if (isPriorityHigh && !isCompleted) {
        // Animated pulsing ring
        node.append('circle')
          .attr('class', 'priority-pulse-ring')
          .attr('r', 14)
          .attr('fill', 'none')
          .attr('stroke', strokeColor)
          .attr('stroke-width', 2)
          .attr('opacity', 0.5)

        // Static inner glow ring
        node.append('circle')
          .attr('r', radius + 5)
          .attr('fill', 'none')
          .attr('stroke', strokeColor)
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.2)
          .attr('filter', 'url(#priority-glow)')
      }

      // Main circle
      const mainCircle = node.append('circle')
        .attr('r', radius)
        .attr('fill', fillColor)
        .attr('stroke', strokeColor)
        .attr('stroke-width', strokeWidth)

      if (!isCompleted) {
        mainCircle.attr('filter', 'url(#node-shadow)')
      }

      // Checkmark for completed
      if (isCompleted) {
        node.append('text')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', COLORS.bg)
          .attr('font-size', '9px')
          .attr('font-weight', '700')
          .text('✓')
      }

      // Status icon
      if (statusStyle) {
        const iconGroup = node.append('g')
          .attr('transform', `translate(${radius + 6}, ${-radius - 2})`)

        iconGroup.append('circle')
          .attr('r', 6)
          .attr('fill', statusStyle.bgColor)
          .attr('stroke', statusStyle.color)
          .attr('stroke-width', 1)

        iconGroup.append('text')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', statusStyle.color)
          .attr('font-size', '7px')
          .attr('font-weight', '700')
          .text(statusStyle.icon)
      }

      // Label
      const labelX = radius + 14
      const labelEl = node.append('text')
        .attr('x', labelX)
        .attr('y', 0)
        .attr('dominant-baseline', 'central')
        .attr('fill', isCompleted ? COLORS.textSecondary : COLORS.textPrimary)
        .attr('font-size', `${fontSize}px`)
        .attr('font-weight', fontWeight)
        .attr('font-family', "'Inter', -apple-system, system-ui, sans-serif")
        .style('text-decoration', isCompleted ? 'line-through' : 'none')
        .text(data.text)

      // Measure label width for badge positioning
      let labelWidth = 0
      try { labelWidth = labelEl.node().getComputedTextLength() } catch (_) { labelWidth = data.text.length * 7 }
      let badgeCursor = labelX + labelWidth + 10

      // Tag badge
      if (tags.tag) {
        const tagStyle = getTagStyle(tags.tag)

        const tagGroup = node.append('g')
          .attr('transform', `translate(${badgeCursor}, 0)`)

        const tagText = tags.tag

        // Render tag text first to measure it
        const tagTextEl = tagGroup.append('text')
          .attr('x', 0)
          .attr('y', 0)
          .attr('text-anchor', 'start')
          .attr('dominant-baseline', 'central')
          .attr('fill', tagStyle.text)
          .attr('font-size', '9px')
          .attr('font-weight', '600')
          .attr('font-family', "'Inter', -apple-system, system-ui, sans-serif")
          .attr('letter-spacing', '0.03em')
          .text(tagText)

        let tagTextWidth = 0
        try { tagTextWidth = tagTextEl.node().getComputedTextLength() } catch (_) { tagTextWidth = tagText.length * 5.5 }
        const tagPadding = 6
        const tagWidth = tagTextWidth + tagPadding * 2

        // Insert rect behind text
        tagGroup.insert('rect', 'text')
          .attr('x', -tagPadding)
          .attr('y', -8)
          .attr('width', tagWidth)
          .attr('height', 16)
          .attr('rx', 4)
          .attr('fill', tagStyle.bg)

        // Center text in the badge
        tagTextEl
          .attr('x', tagTextWidth / 2)
          .attr('text-anchor', 'middle')

        badgeCursor += tagWidth + 6
      }

      // ── Collapse/Expand indicator ──
      if (hasChildren) {
        const childCount = isCollapsed
          ? countDescendants(d._children || [])
          : (d.children ? d.children.length : 0)
        const label = isCollapsed ? `+${childCount}` : `−${childCount}`
        const indicatorColor = isCollapsed ? COLORS.accent : COLORS.textTertiary

        const indGroup = node.append('g')
          .attr('transform', `translate(${badgeCursor}, 0)`)
          .style('cursor', 'pointer')

        const indTextEl = indGroup.append('text')
          .attr('x', 0)
          .attr('y', 0)
          .attr('text-anchor', 'start')
          .attr('dominant-baseline', 'central')
          .attr('fill', indicatorColor)
          .attr('font-size', '9px')
          .attr('font-weight', '700')
          .attr('font-family', "'Inter', -apple-system, system-ui, sans-serif")
          .text(label)

        let indWidth = 0
        try { indWidth = indTextEl.node().getComputedTextLength() } catch (_) { indWidth = label.length * 5.5 }
        const indPad = 5

        indGroup.insert('rect', 'text')
          .attr('x', -indPad)
          .attr('y', -8)
          .attr('width', indWidth + indPad * 2)
          .attr('height', 16)
          .attr('rx', 4)
          .attr('fill', isCollapsed ? COLORS.accentLight : '#f3f4f6')
      }

      // ── Click handler: toggle collapse ──
      if (hasChildren) {
        node.on('click', (event) => {
          event.stopPropagation()
          if (collapsedNodes.has(data.id)) {
            collapsedNodes.delete(data.id)
          } else {
            collapsedNodes.add(data.id)
          }
          render()
        })
      }
    })

    // ─── Root node (invisible connector) ───
    // We skip the root in our nodes, but draw its links.
    // The root links are already drawn above since root's children connect.

    // Auto-fit view only on first render
    if (isFirstRender) {
      isFirstRender = false
      fitView()
    }
  }

  /**
   * Fit the tree in the viewport.
   */
  function fitView() {
    if (!svg || !g) return

    const container = containerRef.value
    if (!container) return

    const width = container.clientWidth
    const height = container.clientHeight

    const bounds = g.node().getBBox()
    if (bounds.width === 0 || bounds.height === 0) return

    const padding = 60
    const scale = Math.min(
      (width - padding * 2) / bounds.width,
      (height - padding * 2) / bounds.height,
      1.2 // Max scale
    )

    const tx = (width - bounds.width * scale) / 2 - bounds.x * scale
    const ty = (height - bounds.height * scale) / 2 - bounds.y * scale

    svg.transition()
      .duration(600)
      .ease(d3.easeCubicOut)
      .call(
        zoomBehavior.transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale)
      )
  }

  function zoomIn() {
    if (!svg || !zoomBehavior) return
    svg.transition().duration(300).call(zoomBehavior.scaleBy, 1.3)
  }

  function zoomOut() {
    if (!svg || !zoomBehavior) return
    svg.transition().duration(300).call(zoomBehavior.scaleBy, 0.7)
  }

  function resetZoom() {
    fitView()
  }

  onMounted(() => {
    initSvg()

    // Observe container resizing
    resizeObserver = new ResizeObserver(() => {
      if (containerRef.value) {
        const w = containerRef.value.clientWidth
        const h = containerRef.value.clientHeight
        if (svg) {
          svg.attr('viewBox', `0 0 ${w} ${h}`)
        }
      }
    })

    if (containerRef.value) {
      resizeObserver.observe(containerRef.value)
    }
  })

  onBeforeUnmount(() => {
    if (resizeObserver) {
      resizeObserver.disconnect()
    }
  })

  // Watch tree data changes
  watch(treeData, () => {
    if (g) {
      render()
    }
  }, { deep: true })

  return {
    zoomLevel,
    zoomIn,
    zoomOut,
    resetZoom,
    render,
    fitView,
    initSvg,
  }
}
