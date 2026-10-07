import type { ReactElement } from "react";
import type { Route } from "../../app/router";
import { CommandBar } from "./command-bar/CommandBar";
import { DefinitionPicker } from "./definitions/DefinitionPicker";
import { FileViewer } from "./file-viewer/FileViewer";
import { QaPanel } from "./qa/QaPanel";
import { SettingsPanel } from "./settings/SettingsPanel";

export interface ShellOverlaysProps {
  readonly route: Route;
}

/** Mount point for every web-shell overlay. Each overlay must be position: fixed so it never affects page layout. */
export const ShellOverlays = ({ route }: ShellOverlaysProps): ReactElement => (
  <>
    <FileViewer route={route} />
    <DefinitionPicker route={route} />
    <QaPanel route={route} />
    <CommandBar route={route} />
    <SettingsPanel route={route} />
  </>
);
