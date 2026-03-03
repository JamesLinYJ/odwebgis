/* 【中文注释】
 * 文件说明：admin.js 为前端自研脚本，负责页面交互或业务能力。
 * 维护约定：修改前请确认对应后端接口与页面行为。
 */

(function () {
    // Legacy entry kept only to avoid 404 in old pages.
    // Use the React admin app at /admin.
    if (window.location.pathname === "/admin-legacy") {
        window.location.replace("/admin");
    }
})();

