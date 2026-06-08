# 知识树构建器
使用Claude Opus 4.6thinking模式 vibevoding的知识树构建树

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

打开浏览器访问 `http://localhost:5173/` 即可使用。

首次打开时，编辑器会自动填充一组示例数据，展示所有解析功能。

## 层级关系

通过 **2 个空格** 缩进表示父子关系：

```markdown
- [ ] 一级任务
  - [ ] 二级子任务
    - [ ] 三级子任务
  - [x] 另一个二级子任务

## 技术架构

```
Vue 3 (Composition API + Script Setup)
├── App.vue             主组件：布局、状态、快捷键
├── parser.js           Markdown 解析器
├── useTreeRenderer.js  D3.js 树渲染组合式函数
├── defaults.js         默认示例数据
└── style.css           设计系统（CSS 自定义属性）

##使用技巧

核心:  #特性
详细请参考文档说明.md