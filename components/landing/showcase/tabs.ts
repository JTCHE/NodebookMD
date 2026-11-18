import type { ComponentType } from "react";
import { AgentDemo } from "@/components/landing/showcase/AgentDemo";
import type { Driver } from "@/components/landing/showcase/driver";
import { F1Demo, pane } from "@/components/landing/showcase/F1Demo";
import { full, type AppBox, type Base, type DemoProps } from "@/components/landing/showcase/layout";
import { customizationScene, navigationScene, searchScene } from "@/components/landing/showcase/scenes";
import { SpeedDemo } from "@/components/landing/showcase/SpeedDemo";

export interface Tab {
  id: string;
  label: string;
  /** The label on a phone, where all the tabs share one row. */
  short?: string;
  /** How long the tab stays before the next, when nobody picks one. A tab
      with a scene moves on when its scene ends. */
  ms: number;
  scene?: (d: Driver) => Promise<void>;
  /** Drawn in the frame. A tab with no demo is the app on its own. */
  demo?: ComponentType<DemoProps>;
  /** Where the app is in this tab. No box, no app. */
  app?: (base: Base) => AppBox;
}

export const TABS: Tab[] = [
  { id: "navigation", label: "Navigation", ms: 18500, scene: navigationScene, app: full },
  { id: "search", label: "Search", ms: 10000, scene: searchScene, app: full },
  { id: "customization", label: "Customization", short: "Customize", ms: 16000, scene: customizationScene, app: full },
  { id: "f1", label: "Houdini Integration", short: "Integration", ms: 10000, demo: F1Demo, app: pane },
  { id: "agents", label: "Agents", ms: 14000, demo: AgentDemo },
  { id: "speed", label: "Speed", ms: 10000, demo: SpeedDemo },
];
