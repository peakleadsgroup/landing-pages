import bathrooms from "./bathrooms.js";
import roofing from "./roofing.js";
import solar from "./solar.js";
import floorCoating from "./floor-coating.js";
import windows from "./windows.js";
import kitchenReface from "./kitchen-reface.js";
import kitchens from "./kitchens.js";
import concretePolishing from "./concrete-polishing.js";

const NICHE_CONTEXT = {
  Bathrooms: bathrooms,
  Roofing: roofing,
  Solar: solar,
  "Floor Coating": floorCoating,
  Windows: windows,
  "Kitchen Reface": kitchenReface,
  Kitchens: kitchens,
  "Concrete Polishing": concretePolishing,
};

export function getNicheContext(niche) {
  const key = String(niche || "").trim();
  return NICHE_CONTEXT[key] || "";
}

export function listNicheKeys() {
  return Object.keys(NICHE_CONTEXT);
}
