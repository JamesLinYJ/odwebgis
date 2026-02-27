(function () {
    // Legacy entry kept only to avoid 404 in old pages.
    // Use the React explorer app at /.
    if (window.location.pathname === "/explorer-legacy") {
        window.location.replace("/");
    }
})();
