# 覆雪手记

**线上地址：<https://gevenchou.github.io>**

一个不需要租服务器、不需要数据库、几乎不需要维护的个人网站。
纯静态页面，文章写在 Markdown 文件里，托管在 GitHub Pages 上，**完全免费**。

---

## 一、先看结构

```
my-site/
├── content/                  ← 你唯一需要天天碰的地方
│   ├── posts/                ← 文章（一篇 = 一个 .md 文件）
│   ├── works/                ← 作品 / 项目
│   └── about.md              ← 「关于」页
├── assets/                   ← 图片放这里（头像、文中配图）
├── theme/                    ← 样式（配色、字体、间距都在这）
│   ├── style.css
│   ├── favicon.svg
│   └── admin.*               ← 管理后台的页面、样式、脚本
├── lib/                      ← 渲染逻辑（不用动）
├── site.config.json          ← 站名、署名、简介、导航
├── build.mjs                 ← 构建：把 md 变成网页
├── serve.mjs                 ← 本地预览用的小服务器
└── test.mjs                  ← 自检
```

构建出来的网页在 `dist/`，**不要手动改 dist 里的东西**，每次构建会整个重写。

---

## 二、本地预览（改完想先看一眼）

在这个目录下开一个终端，跑两条命令：

```powershell
node build.mjs      # 生成网页
node serve.mjs      # 起一个本地预览服务
```

然后打开 <http://127.0.0.1:4321> 。

改完内容后，重新跑 `node build.mjs`，刷新浏览器就能看到。预览服务不用关。

---

## 三、写一篇新文章

1. 在 `content/posts/` 里新建一个文件，文件名建议用 `日期-英文短名.md`，例如：
   `2026-12-01-diyicixue.md`
2. 文件开头必须有一段「front matter」，用三条横线包起来：

```markdown
---
title: 第一场雪
date: 2026-12-01
tags: 随笔, 冬天
summary: 一句摘要，会显示在列表和搜索结果里。
---

正文从这里开始。空一行就是一个新段落。
```

3. 写正文，支持这些写法：

| 写法 | 效果 |
| --- | --- |
| `## 标题` | 小节标题（左边带一道朱红竖线） |
| `**加粗**` | **加粗** |
| `*强调*` | 强调（底下有一道淡红笔痕） |
| `> 一段话` | 引用块 |
| `- 项目` | 列表 |
| `[文字](网址)` | 链接 |
| `![说明](assets/图片.jpg)` | 图片（单独一行时会变成带图注的图） |
| `---` | 分隔线 |
| ` ```js ` … ` ``` ` | 代码块 |
| `\| 甲 \| 乙 \|` | 表格 |

> 一行一段最稳。同一段里换行会被合并成一行，中文之间不会插空格。

4. 保存 → 跑 `node build.mjs` → 刷新预览。

**不想让它上线**：在 front matter 里加一行 `draft: true`，正式构建时会自动跳过。

---

## 四、加图片

把图片放进 `assets/`，然后在文章里这样引用：

```markdown
![冬天的窗](assets/2026-12-01-chuang.jpg)
```

只写 `assets/xxx.jpg` 就够了，不需要写斜杠或完整网址，构建时会自动补全地址。
图片建议压到 300KB 以内，加载更快。

---

## 五、改站名、署名、简介

全部在 `site.config.json` 里，改完重新构建即可：

```json
{
  "siteTitle": "覆雪手记",        // 浏览器标签页、页头左上角
  "author": "七年覆雪",           // 首页大字、页脚版权
  "tagline": "把日子折成一页，等雪落下",
  "bio": "夜里写字的人。这里存放读书、行走，和一些没说完的话。",
  "seal": "覆雪",                 // 页脚那枚朱红印章，两个字最合适
  "avatar": "assets/avatar.png",  // 换成自己的照片也行
  "links": [ { "label": "GitHub", "url": "https://github.com/你的用户名" } ]
}
```

---

## 六、发布上线

站点通过 GitHub Pages 免费托管。发布流程是：**本地 commit → push 到 GitHub → 自动构建上线**。

第一次发布需要准备：

1. 一个 GitHub 账号
2. 一个仓库，建议就叫 `你的用户名.github.io`，这样网址是 `https://你的用户名.github.io`
3. 本机有 git（这个项目里自带便携版：`.tools/git/cmd/git.exe`，不需要另外安装）
4. 仓库 Settings → Pages → **Source 必须选 `GitHub Actions`**

> ⚠️ 第 4 条是关键。如果 Source 是 `Deploy from a branch`，GitHub 会把仓库里的 README
> 当成网页渲染，你看到的就不是这个站了。设置页：<https://github.com/gevenchou/gevenchou.github.io/settings/pages>

**日常发布，最省事的办法**是用项目里的脚本（在项目目录下运行）：

```powershell
.\publish.ps1                      # 自动生成提交说明
.\publish.ps1 "新文章：第一场雪"     # 自己写提交说明
```

它会把「构建 → 提交 → 推送」三步一起做完。

也可以手动执行：

```powershell
node build.mjs
.tools\git\cmd\git.exe add -A
.tools\git\cmd\git.exe commit -m "新文章：第一场雪"
.tools\git\cmd\git.exe push
```

推上去以后，GitHub 会自动跑构建（大约一分钟），刷新网页就能看到。
每次发布的状态可以在仓库的 **Actions** 标签页里看。

---

## 七、常见问题

**问：构建后网站没变化？**
先确认你真的跑了 `node build.mjs`；再看浏览器是不是缓存了，按 `Ctrl+F5` 强制刷新。

**问：日期格式写错了会怎样？**
构建时会打印提示，页面照常生成，但排序和年份分组可能不对。正确格式是 `2026-12-01`。

**问：两个文件的 slug 撞了？**
slug 默认取文件名去掉日期前缀的部分。撞了会在构建时提示，改个文件名即可。

**问：想让更多人搜到？**
发布后到 GitHub 仓库的 Settings → Pages，确认已开启；再到 Google/Bing 网站管理员工具里提交网址。静态站没有后台，收录靠时间和外链。

**问：以后能换域名吗？**
可以。买个域名，在仓库根目录建一个叫 `CNAME` 的文件，里面写域名，再到域名商那边把解析指向 GitHub Pages 即可。

---

## 八、管理后台（在网站上直接发布）

网站右上角有一个「管理」小按钮，点进去是 <https://gevenchou.github.io/admin/>。

### 为什么是令牌，不是账号密码

这个站是纯静态托管，**没有服务器**。如果密码存在网页里，任何人按 F12 就能看到，
绕过之后也发布不了任何东西——因为没有一个后台在等着接收内容。

所以登录用 GitHub 访问令牌：由 GitHub 服务端验证，绕不过去，
而且这个令牌只能动这一个仓库，出不了大事。

### 第一次登录

1. 打开 <https://github.com/settings/personal-access-tokens/new>
2. Token name 随便填，比如 `覆雪手记-管理`
3. Expiration 建议 90 天（到期重新生成一个就行）
4. Repository access → **Only select repositories** → 勾选 `gevenchou.github.io`
5. Permissions → Repository permissions → **Contents** → 改成 **Read and write**
6. 点 Generate token，复制 `github_pat_…` 那一串
7. 回到站点的 /admin/，账号填 `gevenchou`，令牌粘进去，登录

令牌会存在你自己的浏览器里，下次打开不用再输。点「退出」就会清除。

### 登录后能做什么

- **文章 / 作品**两个标签页，列出全部内容
- 「＋ 写一篇」新建，标题、日期、文件名（决定网址）、标签、摘要、正文
- 右边是**实时预览**，用的是和线上完全同一个渲染器，所见即所得
- 「存为草稿」勾上就不会出现在网站上
- 点列表里的标题可以编辑，右侧「删除」移除
- 保存 = 直接提交到仓库 → GitHub 自动构建 → **约 1 分钟上线**

### 安全提醒

令牌等于一把钥匙，只是这把钥匙只能开这一个仓库的门。

- 别把令牌贴到聊天记录、截图、公开文档里
- 公共电脑上用完点「退出登录」，并去 GitHub 把那个令牌 Revoke 掉
- 如果怀疑泄露，立刻到 GitHub 撤销，再生成新的

---

## 九、自检

改过渲染逻辑（`lib/` 里的文件）之后，跑一下：

```powershell
node test.mjs
```

全绿说明 Markdown 解析、front matter、阅读时长这些基础功能都还正常。
