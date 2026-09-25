// Morrow Workplace Care — concept site
// Small, dependency-free enhancements. Form logic is added in a later step.

document.addEventListener("DOMContentLoaded", () => {
  // Keep the footer year current
  const year = document.querySelector("[data-year]");
  if (year) year.textContent = new Date().getFullYear();
});
