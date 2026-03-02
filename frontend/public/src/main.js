import { renderShell, wireNavigation } from "./shared/app-shell.js";
import { mountFeature1 } from "./features/feature-1/index.js";
import { mountFeature2 } from "./features/feature-2/index.js";
import { mountFeature3 } from "./features/feature-3/index.js";
import { mountFeature4 } from "./features/feature-4/index.js";
import { mountFeature5 } from "./features/feature-5/index.js";
import { mountFeature6 } from "./features/feature-6/index.js";
import { mountFeature7 } from "./features/feature-7/index.js";
import { mountFeature8 } from "./features/feature-8/index.js";

const features = [
  { id: "feature-1", label: "Feature 1: Immediate Doubt Answer", mount: mountFeature1 },
  { id: "feature-2", label: "Feature 2: Highlight Vault", mount: mountFeature2 },
  { id: "feature-3", label: "Feature 3: Visualize + Audio", mount: mountFeature3 },
  { id: "feature-4", label: "Feature 4: Time Management", mount: mountFeature4 },
  { id: "feature-5", label: "Feature 5: Personalized Agent", mount: mountFeature5 },
  { id: "feature-6", label: "Feature 6: Agenda + Progress", mount: mountFeature6 },
  { id: "feature-7", label: "Feature 7: Practice Analyzer", mount: mountFeature7 },
  { id: "feature-8", label: "Feature 8: Project Evaluation", mount: mountFeature8 },
];

const app = document.getElementById("app");
app.innerHTML = renderShell();

const container = document.getElementById("feature-content");

function showFeature(id) {
  const feature = features.find((x) => x.id === id) || features[0];
  container.innerHTML = "";
  feature.mount(container);
}

wireNavigation(features, showFeature);
showFeature(features[0].id);
