// Screen switcher + fit-to-width scaling for the concept mock windows.
(function () {
  const W = 1360, H = 820;

  function fit() {
    document.querySelectorAll(".c-viewport").forEach((vp) => {
      const win = vp.querySelector(".c-window");
      const scale = Math.min(1, vp.clientWidth / W);
      win.style.transform = `scale(${scale})`;
      vp.style.height = `${H * scale}px`;
    });
  }

  function show(stage, id) {
    stage.querySelectorAll(".c-screen").forEach((s) => s.classList.toggle("is-on", s.dataset.screen === id));
    stage.querySelectorAll(".c-screens button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.target === id)));
  }

  document.querySelectorAll(".c-stage").forEach((stage) => {
    const buttons = [...stage.querySelectorAll(".c-screens button")];
    buttons.forEach((b) => b.addEventListener("click", () => show(stage, b.dataset.target)));
    // In-mock links: any element with data-go jumps to that screen.
    stage.querySelectorAll("[data-go]").forEach((el) => {
      el.style.cursor = "pointer";
      el.addEventListener("click", (e) => { e.preventDefault(); show(stage, el.dataset.go); });
    });
    if (buttons[0]) show(stage, buttons[0].dataset.target);
  });

  // Number keys 1-9 and 0 switch screens of the first stage.
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, [contenteditable]")) return;
    const stage = document.querySelector(".c-stage");
    if (!/^[0-9]$/.test(e.key)) return;
    const idx = e.key === "0" ? 9 : Number(e.key) - 1;
    const btn = stage && stage.querySelectorAll(".c-screens button")[idx];
    if (btn) btn.click();
  });

  window.addEventListener("resize", fit);
  fit();
})();
