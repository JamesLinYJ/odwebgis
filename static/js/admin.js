(function () {
    // Legacy entry kept only to avoid 404 in old pages.
    // Use the React admin app at /admin.
    if (window.location.pathname === "/admin-legacy") {
        window.location.replace("/admin");
    }
})();
