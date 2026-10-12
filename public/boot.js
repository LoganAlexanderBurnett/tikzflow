// Runs before the first paint on every page (a classic script: the Content-Security-Policy allows
// no inline script). Plain JavaScript, served as is from public/.
//
// 1. The theme (D91): the visitor's choice ("light" or "dark", kept in localStorage by the theme
//    switch), else the system's, followed live while nothing is chosen.
// 2. Share links made before the editor moved to /editor/ (D89): on the home page, a fragment that
//    carries code (#tf1=…) is sent on to the editor. The fragment never reaches a server.
(function () {
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function chosen() {
    try {
      var t = localStorage.getItem("tikzflow.theme");
      return t === "light" || t === "dark" ? t : null;
    } catch (e) {
      return null;
    }
  }
  function apply() {
    root.setAttribute("data-theme", chosen() || (media && media.matches ? "dark" : "light"));
  }
  apply();
  if (media && media.addEventListener) media.addEventListener("change", apply);
  window.addEventListener("storage", function (e) {
    if (e.key === "tikzflow.theme") apply();
  });

  if (root.getAttribute("data-page") === "home" && /(^#|&)tf1=/.test(location.hash)) {
    location.replace(new URL("editor/" + location.hash, document.baseURI).href);
  }
})();
