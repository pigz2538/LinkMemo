# 拾链 LinkMemo

把微信聊天中值得保留的链接、公众号文章和文字内容，快速收集并长期整理。

微信原生小程序 + CloudBase 云开发实现，包含收集、归档、分类标签、检索排序、详情编辑、回收站、帮助与账号数据管理。

## 功能

- 批量粘贴微信聊天内容，按「发送人 + 时间 + 正文」自动拆分
- 识别公众号、网页、文本、文件线索、图片线索、小程序线索
- 公众号/网页标题关联、`jobTitle` 参数提取、域名兜底
- 收藏去重、失败兜底、原始内容保留
- 归档搜索、内容类型筛选、时间/首字母排序、日期范围、分类与标签组合筛选
- 详情、编辑、复制、打开、软删除、回收站恢复
- 自定义分类与标签管理（新建、重命名、改色、删除、计数）
- 我的：微信登录、账号统计、数据导出、退出登录
- 使用帮助：三步教程、可识别示例、限制说明、FAQ、反馈

## 目录结构

```
miniprogram/            小程序前端
  pages/                页面
  components/           公共组件
  utils/                解析引擎、数据层、云调用封装
cloudfunctions/api/     CloudBase 云函数（登录、解析、CRUD、抓取）
tests/                  解析引擎测试
docs/                   设计参考
```

## 本地运行

1. 安装微信开发者工具，导入项目根目录。
2. 使用测试号或填写自己的 AppID（`project.config.json`）。
3. 默认使用 **本地模式**（`miniprogram/config.js` 中 `cloudEnabled: false`），无需云环境即可体验完整流程，数据保存在本地 Storage。
4. 点击「收集」页的「读取剪贴板」或粘贴 `链接样例.txt` 内容，点击「开始解析」。

## 启用 CloudBase

1. 在开发者工具中开通云开发，记录环境 ID。
2. 修改 `miniprogram/config.js`：

```js
module.exports = {
  cloudEnabled: true,
  cloudEnv: 'your-env-id'
}
```

3. 右键 `cloudfunctions/api` → 上传并部署（云端安装依赖）。
4. 在云开发控制台创建集合：`users`、`archive_items`、`user_categories`、`user_tags`、`parse_batches`。
5. 配置数据库权限为「仅创建者可读写」，实际读写均经云函数校验 openid。
6. 建议索引：
   - `archive_items`: `user_id + saved_at`、`user_id + content_type + saved_at`、`user_id + title_initial`
   - `user_categories`: `user_id + name` 唯一
   - `user_tags`: `user_id + name` 唯一
   - `users`: `openid` 唯一

## 测试

```bash
node tests/parser.test.js
```

## 说明

- 小程序不读取微信聊天记录，只处理用户主动粘贴或读取的剪贴板文本。
- 网页抓取失败时仍会保存原始链接与文本。
- 云函数抓取做 SSRF 防护：仅 HTTP/HTTPS、禁止私网/环回/链路本地/云元数据地址、每次跳转重新校验、限制超时/体积/跳转次数。
- 图片、文件、小程序等分享线索只保存可见文本，不包含图片/文件二进制。

产品需求见 `产品_PRD.docx`，界面参考见 `界面1.png`、`界面2.png`、`界面3.png`。
