// WillyBeLate – kleines Basis-Skript. Die Seite funktioniert auch ohne JavaScript.
document.querySelectorAll("[data-year]").forEach((el) => {
  el.textContent = new Date().getFullYear();
});
