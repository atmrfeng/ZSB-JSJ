# 山东专升本计算机刷题站

> 基于「山东专升本《计算机文化基础》考纲」的开源本地刷题站，全部数据存本机，无后端、可静态托管。

## 离线批量构建题库（无浏览器）

当你有**大量 PDF / Word** 资料希望一次性整理成种子题库时，用
`tools/build_seed.py`（纯 Python，无需浏览器）：

```bash
# 一次性安装依赖
pip install pdfplumber pymupdf

# 把 ./input_pdf 文件夹下的所有 PDF / DOCX / TXT / MD / JSON 转成 seed-bank.json
python tools/build_seed.py --input ./input_pdf

# 指定输出位置 + 仅筛选某个子集
python tools/build_seed.py --input ./历年真题 --output app/public/data/seed-bank.json --filter 2026
```

输出位置默认是 `app/public/data/seed-bank.json`，图片落在
`app/public/data/img/<文件名>/` 下。push 到 GitHub → CI 重新构建 → 全员刷新可见。

这个工具与浏览器解析器**共享同一套规则**（考点 / 题型 / 题号 / 答案精析），
不会写入「考点N」「附加题」「XX 操作题」这类无具体名称的占位 tag。

## 一键部署到 GitHub Pages

1. 在 GitHub 上新建一个**公开仓库**（任意名字，本仓库默认 `sdzkb-computer`）
2. 把本目录**除 `dist/` 外**的全部文件 push 到 `main` 分支
3. 仓库 → Settings → Pages → Source 选择 **GitHub Actions**
4. push 一次后会自动运行 `.github/workflows/deploy.yml`，约 1-2 分钟构建完成
5. 站点默认地址：`https://<your-user>.github.io/<repo>/`

> **没有 git 工具？** 看 `GitHub手动上传手册.md`，全程网页端键鼠操作：
> 拖两个准备好的上传包（`github-upload/` 源码 49 个文件、`github-upload-images/` 配图 52 个文件）
> 即可上线，以后换题库也只要替换 `seed-bank.json` 一个文件。

> 如果你部署到自己的域名，删除 `deploy.yml` 里的 `GITHUB_PAGES_BASE: ./` 这一行，
> 把 `app/vite.config.ts` 里 `process.env.GITHUB_PAGES_BASE || './'` 改为 `process.env.GITHUB_PAGES_BASE || '/'` 即可。

## 本地开发

```bash
cd app
npm install          # 首次安装依赖（已锁定 node 22）
npm run dev          # 开发服务器（默认 5173）
npm run build        # 生产构建到 app/dist
```

构建产物 `app/dist/` 是纯静态站，可被任意静态服务托管：
- 本地预览：`cd app/dist && python -m http.server 4173 --bind 127.0.0.1`
- Nginx / Caddy / Cloudflare Pages / Vercel / Netlify：把根目录指向 `app/dist`

## 更新内置种子题库

导入题目到浏览器后，**数据默认只在本机 IndexedDB**。若想把自己整理的题目同步给所有人：

**方式 A（推荐，纯前端）**：网站 → **种子管理** 页
1. 面板 ①「从资料文件生成 seed-bank.json」选 PDF / Word / 文本 / JSON（可多选）
2. 选图片处理方式（默认「精简」，文件最小；需保留图片选「图片分离包」）
3. 下载 `seed-bank.json`，覆盖仓库里的 `app/public/data/seed-bank.json`
4. GitHub Actions 自动重新构建，所有人刷新后即看到新题目

**方式 B（命令行 / 离线）**：

```bash
1. 浏览器 → 设置 → 按种子格式导出（保存 seed-bank_YYYY-MM-DD.json）
2. 把这个 JSON 覆盖仓库里的 app/public/data/seed-bank.json
3. git add . && git commit -m "更新种子题库" && git push
4. GitHub Actions 自动重新构建站点，所有人刷新后即看到新题目
```

**方式 C（离线批量）**：`python tools/build_seed.py --input ./资料目录`（见上文）

导入的图片走 `app/public/data/img/<key>/*.jpg`，随 dist 静态托管（导出题目里
的 `images` 字段保留 `data/img/...` 相对路径即可）。

## 四种导入格式

- **PDF**：pdf.js + Web Worker，文本与内嵌图片一并提取
- **Word（docx）**：mammoth.js 浏览器端转换，识别图片与表格
- **文本 / Markdown**：粘贴题目文本即可，识别「一、单选 / 1.题干 / A.选项」格式
- **JSON**：结构化 schema 校验，支持 `{questions:[...]}` 或顶层数组

## 数据持久化：**本机 IndexedDB**

- 不做用户体系（无注册/登录/付费/社交）
- **每个浏览器 / 设备 / 隐私模式都是独立数据库**，不同人互不影响
- 「设置 → 导出全部数据（JSON）」是 localStorage → 本地文件的备份方式
- 想把自己整理的题目同步给他人：把本地题库按种子格式导出 → 覆盖 `seed-bank.json` → push

## 山东特色判分

- 多选题「多选或未选均无分，**少选一个扣 1 分**」（2026 真题规则）
- 「设置 → 判分规则」可改为「严格规则：必须全对才得分」

## 已知限制

- IndexedDB 单库 ~50MB 配额；图片题多时建议只导入少量
- 扫描版 PDF（无文本层）需要 OCR 才能识别，本版本不支持
- 浏览器内无法直接生成完整外链到 GitHub Pages，需从 GitHub 仓库设置页面获取

## 目录结构

```
.
├── .github/workflows/deploy.yml   # GitHub Pages 自动部署
├── app/                           # Vite + React 前端
│   ├── public/data/seed-bank.json # 内置种子题库（随 build 进入 dist）
│   ├── public/data/img/           # 题目配图
│   └── src/                       # 源码
├── build_seed_bank.py             # 离线构建种子题库的 Python 脚本
└── 需求规格说明书.md               # v0.1 需求文档
```