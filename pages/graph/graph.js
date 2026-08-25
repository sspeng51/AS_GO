// 使用自定义精简版 echarts（仅含 graph 图表，468KB）
var echarts = require('../../components/ec-canvas/echarts')

const app = getApp()

// ===== 分类样式映射（Neo4j 返回的分类名 → 颜色和图标） =====
// 已知分类使用预设样式，未知分类使用默认调色板
const CATEGORY_STYLE_MAP = {
  '原料来源': { color: '#3b82f6', icon: '⛏' },
  '技术路线': { color: '#10b981', icon: '⚙' },
  '产品方向': { color: '#f59e0b', icon: '📦' },
  '标准法规': { color: '#8b5cf6', icon: '📋' },
  '核心概念': { color: '#0A3D62', icon: '🎯' }
}

// 未知分类的默认调色板（循环使用）
const DEFAULT_CATEGORY_STYLES = [
  { color: '#3b82f6', icon: '📍' },
  { color: '#10b981', icon: '📍' },
  { color: '#f59e0b', icon: '📍' },
  { color: '#8b5cf6', icon: '📍' },
  { color: '#ec4899', icon: '📍' },
  { color: '#06b6d4', icon: '📍' },
  { color: '#84cc16', icon: '📍' },
  { color: '#f97316', icon: '📍' }
]

// ===== 当前图谱数据（初始为空，从 Neo4j 异步加载） =====
let GRAPH_DATA = { categories: [], nodes: [], links: [] }
let NODE_DETAIL_MAP = {}
let CATEGORY_STATS = []

/**
 * 为分类列表补充颜色和图标
 */
function _applyCategoryStyles(categories) {
  return categories.map((cat, idx) => {
    if (cat.color && cat.icon) return cat
    const style = CATEGORY_STYLE_MAP[cat.name] || DEFAULT_CATEGORY_STYLES[idx % DEFAULT_CATEGORY_STYLES.length]
    return { name: cat.name, color: style.color, icon: style.icon }
  })
}

/**
 * 从图谱数据构建索引（节点详情字典 + 分类统计）
 */
function _buildIndexes(graphData) {
  // 补充分类样式
  const styledCategories = _applyCategoryStyles(graphData.categories)

  // 构建节点详情字典
  const nodeDetailMap = {}
  graphData.nodes.forEach((node, idx) => {
    const cat = node.category >= 0 ? styledCategories[node.category] : null

    nodeDetailMap[node.name] = {
      ...node,
      idx,
      categoryName: cat ? cat.name : '核心概念',
      categoryColor: cat ? cat.color : '#0A3D62',
      categoryIcon: cat ? cat.icon : '🎯',
      links: []
    }
  })

  // 构建关联关系（双向，携带关系类型）
  graphData.links.forEach(link => {
    const relType = link.relType || '相关'

    // 正向：source → target
    if (nodeDetailMap[link.source]) {
      const existing = nodeDetailMap[link.source].links.find(l => l.name === link.target)
      if (existing) {
        if (!existing.relType.includes(relType)) {
          existing.relType += ' / ' + relType
        }
      } else {
        nodeDetailMap[link.source].links.push({ name: link.target, relType })
      }
    }
    // 反向：target → source
    if (nodeDetailMap[link.target]) {
      const existing = nodeDetailMap[link.target].links.find(l => l.name === link.source)
      if (existing) {
        if (!existing.relType.includes(relType)) {
          existing.relType += ' / ' + relType
        }
      } else {
        nodeDetailMap[link.target].links.push({ name: link.source, relType })
      }
    }
  })

  // 统计各分类节点数
  const categoryStats = styledCategories.map((cat, idx) => {
    const count = graphData.nodes.filter(n => n.category === idx).length
    return { name: cat.name, color: cat.color, icon: cat.icon, count }
  })

  return { categories: styledCategories, nodeDetailMap, categoryStats }
}

Page({
  data: {
    ec: {},
    echarts: echarts,
    categories: [],
    categoryStats: [],
    totalNodes: 0,
    totalLinks: 0,
    showDetail: false,
    selectedNode: {},
    darkMode: false,
    searchText: '',
    searchResults: [],
    showSearch: false,
    activeCategory: -1,
    chartReady: false,
    // 数据加载状态
    graphLoading: true,
    graphError: '',
    dataSource: '',        // 'neo4j' | ''
    loadFailed: false
  },

  // 流式输出控制
  _cancelStream: false,
  _streamTimer: null,

  onLoad() {
    this._initDarkMode()
    this._fetchGraphData()
  },

  _initDarkMode() {
    this.setData({ darkMode: app.globalData.darkMode || false })
  },

  onDarkModeChange(enabled) {
    this.setData({ darkMode: enabled })
    if (this.chart) {
      const option = this._buildChartOption()
      this.chart.setOption(option)
    }
  },

  // ===== 从 Neo4j 获取图谱数据 =====
  async _fetchGraphData() {
    this.setData({ graphLoading: true, graphError: '', loadFailed: false })

    try {
      const res = await new Promise((resolve, reject) => {
        wx.cloud.callFunction({
          name: 'processKnowledge',
          data: {
            action: 'kb.graph.fetch',
            data: {
              keyword: '砷',       // 聚焦砷相关子图
              nodeLimit: 50,       // 最多 50 个节点
              linkLimit: 50        // 最多 50 条关系
            }
          },
          success: resolve,
          fail: reject
        })
      })

      const result = res && res.result
      if (result && result.success && result.data) {
        const graphData = result.data

        // 校验数据有效性
        if (!graphData.nodes || graphData.nodes.length === 0) {
          this.setData({
            graphLoading: false,
            graphError: 'Neo4j 中暂无图谱数据，请先在数据库中创建节点',
            loadFailed: true,
            dataSource: 'neo4j'
          })
          return
        }

        // 构建索引
        GRAPH_DATA = graphData
        const indexes = _buildIndexes(GRAPH_DATA)
        NODE_DETAIL_MAP = indexes.nodeDetailMap
        CATEGORY_STATS = indexes.categoryStats

        this.setData({
          categories: indexes.categories,
          categoryStats: indexes.categoryStats,
          totalNodes: graphData.nodes.length,
          totalLinks: graphData.links.length,
          graphLoading: false,
          graphError: '',
          dataSource: 'neo4j'
        })

        // 初始化或刷新图表
        if (this.chart) {
          this.chart.setOption(this._buildChartOption(), true)
        } else {
          this._initChart()
        }

        console.log(`[Graph] Neo4j 数据加载成功: ${graphData.nodes.length} 节点, ${graphData.links.length} 关系, ${indexes.categories.length} 分类`)
      } else {
        const errMsg = (result && result.error) || '图谱数据获取失败'
        const isNotConfigured = result && result.isNotConfigured
        this.setData({
          graphLoading: false,
          graphError: isNotConfigured
            ? 'Neo4j 未配置，请联系管理员设置环境变量'
            : errMsg,
          loadFailed: true
        })
        console.warn('[Graph] Neo4j 数据获取失败:', errMsg)
      }
    } catch (e) {
      const errMsg = (e && e.errMsg) || e.message || '云函数调用失败'
      this.setData({
        graphLoading: false,
        graphError: errMsg,
        loadFailed: true
      })
      console.warn('[Graph] Neo4j 数据获取异常:', errMsg)
    }
  },

  // ===== 重试 =====
  onRetryFetch() {
    this._fetchGraphData()
  },

  // ===== 图表初始化 =====
  _initChart() {
    if (!GRAPH_DATA.nodes.length) return

    // 使用箭头函数确保闭包中的页面引用不会丢失
    const pageInstance = this

    const initCallback = (canvas, width, height, dpr) => {
      const chart = echarts.init(canvas, null, {
        width: width,
        height: height,
        devicePixelRatio: dpr
      })

      canvas.setChart(chart)
      pageInstance.chart = chart

      const option = pageInstance._buildChartOption()
      chart.setOption(option)

      chart.on('click', function (params) {
        if (params.dataType === 'node' && params.name) {
          const detail = NODE_DETAIL_MAP[params.name]
          if (detail) {
            pageInstance.setData({
              showDetail: true,
              selectedNode: detail
            })
          }
        }
      })

      pageInstance.setData({ chartReady: true })

      return chart
    }

    this.setData({
      ec: {
        onInit: initCallback
      }
    })
  },

  _buildChartOption(highlightCategory) {
    const isDark = this.data.darkMode
    const nodeLabelColor = isDark ? '#e2e8f0' : '#1a365d'

    return {
      backgroundColor: 'transparent',

      tooltip: {
        show: true,
        trigger: 'item',
        formatter: (params) => {
          if (params.dataType === 'node') {
            return params.name
          }
          return params.data.source + ' → ' + params.data.target
        },
        backgroundColor: isDark ? 'rgba(30,41,59,0.95)' : 'rgba(255,255,255,0.95)',
        borderColor: isDark ? '#475569' : '#e2e8f0',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: {
          color: isDark ? '#e2e8f0' : '#1a365d',
          fontSize: 13
        }
      },

      series: [{
        type: 'graph',
        layout: 'force',
        animation: false,
        roam: true,
        draggable: true,

        data: GRAPH_DATA.nodes.map(node => {
          const isHighlighted = highlightCategory === undefined ||
            node.category === -1 ||
            node.category === highlightCategory

          return {
            name: node.name,
            category: node.category,
            symbolSize: node.symbolSize,
            itemStyle: {
              color: node.category >= 0
                ? GRAPH_DATA.categories[node.category].color
                : '#0A3D62',
              borderColor: '#fff',
              borderWidth: 2,
              opacity: isHighlighted ? 1 : 0.2
            },
            label: {
              show: true,
              fontSize: node.category === -1 ? 14 : 11,
              fontWeight: node.category === -1 ? 700 : 500,
              color: nodeLabelColor,
              position: 'right',
              distance: 6,
              opacity: isHighlighted ? 1 : 0.3
            }
          }
        }),

        links: GRAPH_DATA.links.map(link => {
          const relType = link.relType || ''
          return {
            source: link.source,
            target: link.target,
            label: {
              show: false,
              formatter: relType,
              fontSize: 10,
              color: isDark ? '#94a3b8' : '#64748b',
              backgroundColor: isDark ? 'rgba(15,23,42,0.75)' : 'rgba(255,255,255,0.75)',
              padding: [2, 6],
              borderRadius: 3
            },
            emphasis: {
              label: {
                show: !!relType,
                fontSize: 12
              },
              lineStyle: {
                width: 3,
                opacity: 1
              }
            },
            lineStyle: {
              color: isDark ? '#475569' : '#cbd5e1',
              width: 1.5,
              curveness: 0.2,
              opacity: 0.6
            }
          }
        }),

        categories: GRAPH_DATA.categories.map(cat => ({
          name: cat.name,
          itemStyle: { color: cat.color }
        })),

        force: {
          repulsion: 200,
          gravity: 0.15,
          edgeLength: [60, 160],
          layoutAnimation: true,
          friction: 0.9
        },

        scaleLimit: {
          min: 0.4,
          max: 3
        },

        emphasis: {
          focus: 'adjacency',
          itemStyle: {
            borderColor: '#fff',
            borderWidth: 4,
            shadowBlur: 20,
            shadowColor: 'rgba(0,0,0,0.25)'
          },
          lineStyle: {
            width: 3,
            opacity: 1
          },
          label: {
            fontSize: 14,
            fontWeight: 700
          }
        }
      }]
    }
  },

  // ===== 搜索 =====
  onSearchInput(e) {
    const text = e.detail.value.trim().toLowerCase()
    this.setData({ searchText: e.detail.value })

    if (!text) {
      this.setData({ searchResults: [] })
      return
    }

    const results = GRAPH_DATA.nodes.filter(node => {
      return node.name.toLowerCase().includes(text) ||
        (node.keywords && node.keywords.toLowerCase().includes(text)) ||
        (node.desc && node.desc.toLowerCase().includes(text))
    }).slice(0, 8)

    this.setData({ searchResults: results })
  },

  onSearchFocus() {
    this.setData({ showSearch: true })
  },

  onSearchBlur() {
    setTimeout(() => {
      this.setData({ showSearch: false })
    }, 200)
  },

  onSearchClear() {
    this.setData({ searchText: '', searchResults: [], showSearch: false })
  },

  onSearchResultTap(e) {
    const name = e.currentTarget.dataset.name
    const detail = NODE_DETAIL_MAP[name]
    if (detail) {
      this.setData({
        showDetail: true,
        selectedNode: detail,
        searchText: '',
        searchResults: [],
        showSearch: false
      })
    }
  },

  // ===== 分类筛选 =====
  onCategoryTap(e) {
    const idx = e.currentTarget.dataset.index
    const current = this.data.activeCategory

    if (current === idx) {
      // 取消筛选
      this.setData({ activeCategory: -1 })
      if (this.chart) {
        this.chart.setOption(this._buildChartOption())
      }
    } else {
      this.setData({ activeCategory: idx })
      if (this.chart) {
        this.chart.setOption(this._buildChartOption(idx))
      }
    }
  },

  // ===== 重置视图 =====
  onResetView() {
    if (this.chart) {
      this.setData({ activeCategory: -1 })
      this.chart.setOption(this._buildChartOption())
      // 重置缩放
      this.chart.dispatchAction({
        type: 'restore'
      })
    }
  },

  // ===== 详情面板 =====
  onCloseDetail() {
    this.setData({ showDetail: false })
  },

  onLinkTap(e) {
    const name = e.currentTarget.dataset.name
    const detail = NODE_DETAIL_MAP[name]
    if (detail) {
      this.setData({ selectedNode: detail })
    }
  },

  onLegendTap(e) {
    const name = e.currentTarget.dataset.name
    const catIdx = GRAPH_DATA.categories.findIndex(c => c.name === name)
    if (catIdx < 0) return

    const node = GRAPH_DATA.nodes.find(n => n.category === catIdx)
    if (node) {
      const detail = NODE_DETAIL_MAP[node.name]
      if (detail) {
        this.setData({
          showDetail: true,
          selectedNode: detail
        })
      }
    }
  }
})
