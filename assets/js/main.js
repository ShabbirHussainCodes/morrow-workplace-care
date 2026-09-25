// Morrow Workplace Care — concept site
// Small, dependency-free enhancements. Form logic is added in a later step.

document.addEventListener("DOMContentLoaded", () => {
  // Keep the footer year current
  const year = document.querySelector("[data-year]");
  if (year) year.textContent = new Date().getFullYear();

  // Image slots: if an image file is not added yet, show a calm placeholder
  document.querySelectorAll(".media img").forEach((img) => {
    const markMissing = () => img.closest(".media").classList.add("is-missing");
    if (img.complete && img.naturalWidth === 0) markMissing();
    img.addEventListener("error", markMissing);
  });
});
