import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// GitHub Pages 部署在子路径时可设置 GITHUB_PAGES_BASE=/<repo-name>/
// 默认 './' 兼容 GitHub Pages 子路径 + 任意其它静态托管（用户自建 Nginx 子路径等）
const base = process.env.GITHUB_PAGES_BASE || './'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
