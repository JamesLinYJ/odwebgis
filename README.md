# WebGIS OD 平台（简体中文）

一个用于教学与演示的 WebGIS OD 系统，包含：

- 账户体系（注册、登录、访客）
- OD 线路录入与可视化
- 管理后台（账户管理、线路管理、统计与导出）
- 天地图底图（通过后端代理，前端不直出 API Key）

本仓库已统一脚本命名（`.sh` / `.bat` 同名），支持 Windows、Linux、WSL。

---

## 1. 功能概览

### 1.1 前台（普通用户 / 访客）

- 地图点选 O/D
- 十进制度与度分秒输入
- GCJ-02 / WGS84 互转录入（内部统一存储 WGS84）
- OD 线路保存与查看

### 1.2 后台（管理员）

- 账户列表与筛选
- 账户增删改、重置密码、查看登录 IP 记录
- 按账户筛选线路，支持批量操作
- 导出账户列表与 OD 图

### 1.3 角色模型（当前版本）

- `normal_user`：普通用户
- `admin`：管理员（受限管理）
- `super_admin`：超级管理员
- 系统后台账号（环境变量控制，不入库）

权限规则（已实现）：

- 普通管理员不能删除管理员/超级管理员账户
- 普通管理员看不到同权限与更高权限账户
- 普通管理员导出仅包含可管理账户

---

## 2. 技术栈

- 后端：Flask + SQLite
- 前端：React（浏览器端）+ Tailwind CSS + Leaflet
- 字体：MiSans（本地文件）
- 脚本：`webgisctl.py` + 同名 `.sh/.bat` 包装器

---

## 3. 目录说明

主要目录/文件：

- `app.py`：Flask 主程序（路由、权限、数据库初始化）
- `webgisctl.py`：统一控制器（setup/build/start/stop/deploy）
- `manage_accounts.py`：账户命令行管理
- `manage_map_key.py`：天地图 Key 命令行管理
- `static/`：前端资源
- `templates/`：页面模板
- `webgis.db`：SQLite 数据库
- `.env.webgis`：运行时环境变量
- `.tianditu_key`：天地图 Key 本地文件

---

## 4. 环境要求

- Python 3.10+
- Node.js + npm（用于 Tailwind 构建）
- Linux/WSL 建议具备 `python3`, `pip`, `npm`

---

## 5. 快速开始（推荐）

### 5.1 一键部署

```bash
python webgisctl.py deploy \
  --host 0.0.0.0 \
  --port 5000 \
  --map-key "你的天地图Key" \
  --admin-username admin \
  --admin-password "12345678"
```

或使用包装脚本：

- Linux/WSL：`./webgis_deploy.sh ...`
- Windows：`webgis_deploy.bat ...`

部署会自动执行：

1. 建立虚拟环境并安装依赖
2. 构建前端样式
3. 写入运行环境
4. 启动服务
5. 创建默认 Web 管理账户（角色为 `super_admin`）

### 5.2 启动与停止

```bash
python webgisctl.py start
python webgisctl.py stop
python webgisctl.py restart
python webgisctl.py check
```

对应同名脚本：

- `webgis_start.sh` / `webgis_start.bat`
- `webgis_build.sh` / `webgis_build.bat`
- `webgis_setup.sh` / `webgis_setup.bat`
- `webgis_clean.sh` / `webgis_clean.bat`
- `webgis_uninstall.sh` / `webgis_uninstall.bat`

---

## 6. 访问地址

默认端口 `5000`：

- 登录页：`/auth`
- 普通页：`/`
- 管理后台：`/admin`
- 账户管理：`/admin/accounts`

示例：

- 本机：`http://127.0.0.1:5000/auth`
- 服务器：`http://<你的服务器IP>:5000/auth`

---

## 7. 天地图 Key 管理

### 7.1 命令行管理

```bash
python manage_map_key.py show
python manage_map_key.py set --key "你的天地图Key"
python manage_map_key.py check
python manage_map_key.py clear
```

### 7.2 读取优先级

1. 环境变量 `TIANDITU_API_KEY`
2. 本地文件 `.tianditu_key`

---

## 8. 账户命令行管理

### 8.1 常用命令

```bash
python manage_accounts.py list
python manage_accounts.py show --username admin
python manage_accounts.py create --name 管理员 --username admin --user-type super_admin --password "12345678"
python manage_accounts.py update --username admin --status online
python manage_accounts.py set-role --username user01 --user-type normal_user
python manage_accounts.py reset-password --username user01 --password "new_password"
python manage_accounts.py unlock --username user01
python manage_accounts.py delete --username user01
python manage_accounts.py stats --json
```

### 8.2 角色参数

`--user-type` 仅支持：

- `normal_user`
- `admin`
- `super_admin`

当前版本不兼容旧参数 `student`。

---

## 9. 环境变量

常用环境变量：

- `WEBGIS_HOST`
- `WEBGIS_PORT`
- `WEBGIS_SECRET_KEY`（强烈建议生产环境设置）
- `TIANDITU_API_KEY`
- `WEBGIS_SYSTEM_ADMIN_ACCOUNT`
- `WEBGIS_SYSTEM_ADMIN_PASSWORD`
- `WEBGIS_SYSTEM_ADMIN_PASSWORD_SHA256`

说明：

- `WEBGIS_SYSTEM_ADMIN_*` 为系统后台账号（不写入数据库）。
- Web 登录账户（admin 等）仍在数据库中管理。

---

## 10. 数据库与数据重建说明（重要）

本项目当前处于快速迭代阶段，数据库结构版本不兼容旧版本。

当 `SCHEMA_VERSION` 变化时，服务启动会重建表结构并清空旧数据。

如需手动重建：

```bash
python manage_accounts.py reset-schema
```

正式上线前请务必接入备份策略。

---

## 11. API 清单（核心）

### 11.1 认证

- `GET /api/auth/me`
- `POST /api/auth/register`
- `POST /api/auth/guest-login`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/change-password`

### 11.2 路线与节点

- `GET /api/routes`
- `POST /api/routes`
- `DELETE /api/routes/<id>`
- `POST /api/routes/batch`
- `GET /api/routes/template`
- `GET /api/nodes`
- `POST /api/nodes`

### 11.3 管理与统计

- `GET /api/admin/overview`
- `GET /api/admin/accounts`
- `POST /api/admin/accounts`
- `DELETE /api/admin/accounts/<id>`
- `DELETE /api/admin/accounts/<id>/routes`
- `POST /api/admin/accounts/<id>/reset-password`
- `GET /api/admin/accounts/<id>/login-history`
- `GET /api/admin/region-load`
- `GET /api/admin/hourly`
- `GET /api/stats/overview`

### 11.4 导出

- `GET /api/export/accounts-csv`
- `GET /api/export/users-csv`（兼容别名）

### 11.5 地图瓦片代理

- `GET /api/map/tile/<layer>/<z>/<x>/<y>`

---

## 12. 服务器更新流程（GitHub 拉取）

```bash
cd /opt/odwebgis
git fetch origin main
git checkout main
git pull --ff-only origin main

./webgis_setup.sh
./webgis_build.sh
./webgis_start.sh --restart
```

若需重置管理员：

```bash
python manage_accounts.py create --name 管理员 --username admin --user-type super_admin --password "12345678" || true
python manage_accounts.py update --username admin --user-type super_admin
python manage_accounts.py reset-password --username admin --password "12345678"
```

---

## 13. 故障排查

### 13.1 登录报“密码加密格式无效”

- 前端需发送 `sha256:<64位hex>` 格式密码摘要。
- 页面脚本未加载完整时会触发此问题，先清浏览器缓存并检查控制台。

### 13.2 页面空白或样式错乱

- 先执行：
  - `python webgisctl.py build`
  - `python webgisctl.py restart`
- 检查静态资源是否 200：
  - `/static/js/*`
  - `/static/css/*`

### 13.3 服务端口被占用

```bash
python webgisctl.py stop
python webgisctl.py start --port 5001
```

### 13.4 天地图不显示

- 确认 Key 有效：`python manage_map_key.py check`
- 检查服务端网络可访问天地图

---

## 14. 安全建议（生产）

- 设置强随机 `WEBGIS_SECRET_KEY`
- 使用 HTTPS（Nginx/Caddy 反代）
- 限制数据库文件读写权限
- 周期性备份 `webgis.db`
- 管理员密码不要使用弱口令

---

## 15. 许可证与说明

本仓库用于教学演示与研究开发。上线生产前，请完成安全评估、压测与审计。

