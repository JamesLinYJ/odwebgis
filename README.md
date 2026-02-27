# WebGIS OD 流向系统（简体中文）

一个包含前端交互与后端 API 的完整 WebGIS OD 应用，提供：

- OD 地图探索端（亮色风格）
- 管理员后台（用户管理 + 可视化分析）
- 独立注册/登录页面（`/auth`）
- 手动录入（支持坐标或 O/D 代码）
- CSV 批量上传入库
- 一键导出美观 OD 图（PNG / SVG）
- 枢纽节点管理
- 实时统计、区域负载、告警与趋势图
- 用户数据 CSV 导出

前端技术：

- React 18（本地静态文件）
- Tailwind CSS（本地编译生成 CSS）
- Leaflet 地图与热力图插件
- MiSans（本地字体文件）

## 1. 环境要求

- Python 3.10+
- 可访问外网（仅用于底图瓦片；前端库与头像资源均本地化）
- 天地图 Key（仅后端读取，不在前端暴露）

## 2. 安装依赖

```bash
pip install -r requirements.txt
```

## 3. 启动

先配置天地图 Key（推荐环境变量）：

```powershell
$env:TIANDITU_API_KEY="你的天地图Key"
```

也可在项目根目录写入 `./.tianditu_key`（文件内容仅一行 key）。

```bash
python app.py
```

默认地址：`http://127.0.0.1:5000`

- 注册/登录：`/auth`
- 地图探索端：`/`（需先登录）
- 管理员后台：`/admin`（学生端不显式展示入口）

底图说明：前端仅访问 `/api/map/tile/...`，真实天地图 key 只在后端代理请求中使用。

### 3.1 命令行配置天地图 Key（推荐）

```bash
python manage_map_key.py show
python manage_map_key.py set --key "你的天地图Key"
python manage_map_key.py check
python manage_map_key.py clear
```

Windows 可用：

```bat
manage_map_key.bat set --key "你的天地图Key"
```

Linux 可用：

```bash
./manage_map_key.sh set --key "你的天地图Key"
```

一键自动启动、自动打开页面并调试：

```bash
python run_local.py
```

## 4. 系统后台管理账号（无默认管理员）

系统不再自动创建默认管理员账户。后台登录建议使用部署环境变量配置的系统后台账号：

- `WEBGIS_SYSTEM_ADMIN_ACCOUNT`
- `WEBGIS_SYSTEM_ADMIN_PASSWORD` 或 `WEBGIS_SYSTEM_ADMIN_PASSWORD_SHA256`

示例（Windows PowerShell）：

```powershell
$env:WEBGIS_SYSTEM_ADMIN_ACCOUNT="SYS_ROOT"
$env:WEBGIS_SYSTEM_ADMIN_PASSWORD="Your#Strong#Pass123!"
python app.py
```

## 5. 命令行账户管理（系统后台无需网页登录）

可直接操作数据库账户（增删改查、重置密码、改角色）：

```bash
python manage_accounts.py list
python manage_accounts.py create --name 张三 --username zhangsan --user-type student --password "Abc!2345"
python manage_accounts.py set-role --username zhangsan --user-type admin
python manage_accounts.py reset-password --username zhangsan --password "XyZ#998877"
python manage_accounts.py delete --username zhangsan
```

Windows 也可用：

```bat
manage_accounts.bat list
```

## 6. 主要接口

- `GET /api/routes` 查询路线
- `POST /api/routes` 新增路线
- `DELETE /api/routes/{id}` 删除路线
- `POST /api/routes/batch` 批量 CSV 导入
- `GET /api/routes/template` 下载 CSV 模板
- `GET /api/nodes` 枢纽节点列表
- `POST /api/nodes` 新增节点
- `GET /api/users` 用户查询
- `POST /api/auth/register` 注册
- `POST /api/auth/login` 登录
- `POST /api/auth/logout` 退出
- `GET /api/auth/me` 当前登录用户
- `POST /api/students/register` 学生注册（兼容接口）
- `GET /api/users/{id}/summary` 用户详情与路线
- `GET /api/stats/overview` 总览统计
- `GET /api/admin/overview` 管理员全局总览
- `GET /api/admin/region-load` 区域负载
- `GET /api/admin/hourly` 小时趋势
- `GET /api/alerts` 告警列表
- `GET /api/export/users-csv` 导出用户 CSV

## 7. CSV 模板字段

`origin_code,origin_name,origin_lat,origin_lon,destination_code,destination_name,destination_lat,destination_lon,flow_weight,category,user_id`

说明：

- 起点和终点均支持“代码或坐标”任意一种方式。
- 当填写代码时，会从 `nodes` 节点表自动解析坐标。
- `flow_weight` 必须大于 0。

## 8. 数据存储

程序首次启动会自动创建 `webgis.db`，默认不写入任何预设数据。

## 9. 本地前端依赖说明（无 CDN）

- 第三方前端依赖全部位于 `static/vendor/`
- Tailwind 通过本地二进制编译，输出文件：`static/css/tailwind.generated.css`
- MiSans 字体位于 `static/fonts/misans/`，样式文件为 `static/css/misans.css`
- 重新生成 Tailwind CSS：

```bash
tools/tailwindcss.exe -i static/css/tailwind.input.css -o static/css/tailwind.generated.css --minify
```

## 10. Linux 一键脚本

首次一键安装依赖并启动：

```bash
chmod +x setup_linux.sh start_linux.sh cleanup_linux.sh manage_map_key.sh
./setup_linux.sh
```

仅启动（已安装依赖后）：

```bash
./start_linux.sh
```

一键清理：

```bash
./cleanup_linux.sh runtime   # 停进程 + 清日志/缓存
./cleanup_linux.sh all       # 额外清理 .venv / webgis.db / .tianditu_key
```
