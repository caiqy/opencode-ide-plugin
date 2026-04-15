import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App.tsx"
import { ideBridge } from "./lib/ideBridge"
import { installTooltipPolyfillBridge } from "./lib/tooltipPolyfill"
import { SessionProvider } from "./state/SessionContext.tsx"
import { ToastProvider } from "./state/ToastContext.tsx"
import { ErrorBoundary } from "./components/ErrorBoundary.tsx"
import { ProjectProvider } from "./state/ProjectContext.tsx"
import { IdeBridgeProvider } from "./state/IdeBridgeContext"
import { ProvidersProvider } from "./state/ProvidersContext"
import { UISettingsProvider } from "./state/UISettingsContext"
import { initGlobalDnD } from "./lib/dnd"
import { VersionGate } from "./components/VersionGate"
import { TabStoreProvider } from "./state/tabStore"
import { UpdateProvider } from "./state/UpdateContext"

ideBridge.init()
installTooltipPolyfillBridge()
initGlobalDnD()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <VersionGate>
        <ProjectProvider>
          <SessionProvider>
            <TabStoreProvider>
              <ToastProvider>
                <IdeBridgeProvider>
                  <ProvidersProvider>
                    <UpdateProvider>
                      <UISettingsProvider>
                        <App />
                      </UISettingsProvider>
                    </UpdateProvider>
                  </ProvidersProvider>
                </IdeBridgeProvider>
              </ToastProvider>
            </TabStoreProvider>
          </SessionProvider>
        </ProjectProvider>
      </VersionGate>
    </ErrorBoundary>
  </StrictMode>,
)
